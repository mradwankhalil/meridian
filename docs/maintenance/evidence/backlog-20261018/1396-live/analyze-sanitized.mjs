#!/usr/bin/env bun
// Offline assertions against sanitized wire summaries and supported SDK APIs.
// Does not start a server/client, query a model, or read private SDK files.
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {isDeepStrictEqual} from 'node:util'
const source=resolve(process.env.E2E_SOURCE_ROOT||'.'),root=resolve(process.argv[2])
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex')
const report=JSON.parse(readFileSync(join(root,'report.json')))
const known=hash({type:'text',text:"First privately list what you need next; then request every item that doesn't depend on another's result in this one response."})
const agents=[...new Set(report.requests.filter(r=>r.agent!=='main').map(r=>r.agent))]
const transitions=[]
for(const agent of agents){
 const requests=report.requests.filter(r=>r.agent===agent)
 for(let i=0;i<requests.length-1;i++){
  const before=requests[i],after=requests[i+1],position=before.skeleton.length-1,active=before.skeleton[position],historical=after.skeleton[position]
  if(active.role!=='system'||active.blocks.at(-1)?.digest!==known)continue
  const durable=active.blocks.slice(0,-1)
  const shape=durable.length>0?'retained-durable-prefix':'reminder-only'
  const ok=durable.length>0?historical?.role==='system'&&isDeepStrictEqual(durable,historical.blocks)
   :historical?.role==='assistant'&&isDeepStrictEqual(before.skeleton.slice(0,position),after.skeleton.slice(0,position))
  if(ok)transitions.push({agent,before:before.seq,after:after.seq,position,shape,durableDigest:hash(durable),knownExactReminderHash:known})
 }
}
const checkpointPairs=report.queries.filter(q=>q.resumeDigest).map(q=>{
 const prior=report.queries.find(p=>p.target===q.resumeDigest)
 return {prior:prior?.index,current:q.index,sourceMatches:Boolean(prior),checkpointMatches:Boolean(prior?.assistantUuids.includes(q.checkpoint)),fork:q.fork,replay:q.replay}
})
const cache=checkpointPairs.map(p=>{
 const prior=report.queries.find(q=>q.index===p.prior),current=report.queries.find(q=>q.index===p.current)
 const u=prior?.terminal?.usage||{},v=current?.terminal?.usage||{},priorCached=(u.cache_creation_input_tokens||0)+(u.cache_read_input_tokens||0),read=v.cache_read_input_tokens||0
 return {...p,priorCached,read,ratio:priorCached?read/priorCached:null,passes95Percent:priorCached>0&&read>=0.95*priorCached}
})
const served=[...new Set(report.queries.flatMap(q=>q.servedModels))]
const derived={scope:'Sanitized recorded native client probe; no additional inference',source:report.source,model:report.model,
 originalHarnessResult:report.result,providerHttpRefusal:report.requests.some(r=>r.status>=400||r.providerError),
 expectedCheckpointMaxTurns:report.queries.filter(q=>q.terminal?.subtype==='error_max_turns').map(q=>q.index),
 actualClientExit:report.clientExit,ownedReceiptObserved:report.clientReceiptObserved,allObservedChildrenJoined:report.allObservedChildrenJoined,
 actualSubagentCount:agents.length,subagentRequestCounts:agents.map(agent=>report.requests.filter(r=>r.agent===agent).length),
 requestedExactModel:report.requests.every(r=>r.model===report.model),servedModels:served,
 exactServedModelEveryRound:served.length>0&&served.every(m=>m===report.model),transitions,checkpointPairs,cache,
 unmet:['exact Fable served identity for every tool round','95% cache continuity','before-request immutable-source snapshots','separate live unchanged-tail negative control','all four E41 modes','exact reminder-only live shape unless observed'],
 publicSessionSummaries:[]}
// Supported product mapping lookup and public SDK session API only.
process.env.MERIDIAN_SESSION_DIR=join(root,'store')
process.env.MERIDIAN_CONFIG_DIR=join(root,'config')
const {readSessionStoreSnapshot}=await import(pathToFileURL(join(source,'src/proxy/sessionStore.ts')).href)
const require=createRequire(join(source,'package.json'))
const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href)
const {isForwardedDenial}=await import(pathToFileURL(join(source,'src/proxy/passthroughDenial.ts')).href)
for(const [key,mapping] of Object.entries(readSessionStoreSnapshot())){
 const locator=mapping.currentTranscript
 if(!locator?.configDir)continue
 process.env.CLAUDE_CONFIG_DIR=locator.configDir
 const rows=await sdk.getSessionMessages(mapping.claudeSessionId,{dir:locator.projectDir})
 const blocks=rows.flatMap(r=>Array.isArray(r.message?.content)?r.message.content:[])
 const calls=blocks.filter(b=>b.type==='tool_use').map(b=>({id:hash(b.id),name:b.name,fixturePathOwned:JSON.stringify(b.input).includes('/fixture/')}))
 const results=blocks.filter(b=>b.type==='tool_result').map(b=>({id:hash(b.tool_use_id),isError:b.is_error===true,forwardedDenial:isForwardedDenial(b),contentDigest:hash(b.content)}))
 const pendingIds=new Set(mapping.passthroughToolCallIds||[])
 derived.publicSessionSummaries.push({mappingKey:hash(key),session:hash(mapping.claudeSessionId),rowCount:rows.length,
  models:[...new Set(rows.filter(r=>r.type==='assistant').map(r=>r.message?.model).filter(Boolean))],calls,results,pendingToolCount:pendingIds.size,
  everyCallHasExactlyOneRealResult:calls.length>0&&calls.every(call=>results.filter(result=>result.id===call.id&&!result.forwardedDenial&&!result.isError).length===1),
  publishedTargetMatchesObservedQuery:report.queries.some(q=>q.target===hash(mapping.claudeSessionId))})
}
derived.result='LIVE_ACCEPTANCE_INCOMPLETE'
writeFileSync(join(root,'analysis.json'),JSON.stringify(derived,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({source:derived.source,result:derived.result,transitions:transitions.length,servedModels:served,cache:cache.map(c=>({prior:c.prior,current:c.current,read:c.read,priorCached:c.priorCached,passes95Percent:c.passes95Percent})),publicSessionCount:derived.publicSessionSummaries.length}))
