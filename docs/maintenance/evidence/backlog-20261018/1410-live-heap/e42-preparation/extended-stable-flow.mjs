// Concrete extension for the guarded actual OpenCode 2.0.21 harness.
// No top-level inference or account access. Root must provide the guarded adapters
// described in E42-PREPARATION.md, and coordinate exclusive inference ownership.
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const parse=text=>text.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line))
const textOf=events=>events.filter(e=>e.type==='text').map(e=>e.part?.text??'').join('')
const sessionOf=events=>events.find(e=>e.sessionID)?.sessionID
const unwrap=result=>Array.isArray(result)?result:result?.data
function assertToolPairing(messages){
 const pending=new Set(),seen=new Set();let uses=0,results=0
 for(const message of messages??[]){
  for(const block of Array.isArray(message.content)?message.content:[]){
   if(block.type==='tool_use'){assert(!seen.has(block.id),'Duplicate tool_use id');seen.add(block.id);pending.add(block.id);uses++}
   if(block.type==='tool_result'){assert(pending.delete(block.tool_use_id),'Unpaired or duplicate tool_result');results++}
  }
 }
 return {uses,results,pending:pending.size}
}
export {assertToolPairing}
export async function runExtendedStableFlow(ctx){
 assert.equal(process.env.E2E_ALLOW_LIVE_MODEL,'1','Root must explicitly open the coordinated live gate')
 assert.equal(ctx.inferencePaused,false,'Global inference pause must be explicitly cleared by coordinator')
 assert.equal(ctx.modelIdentityQualified,true,'Exact actual served-model identity must be qualified before running E42')
 const {clientURL,project,proxyWorkdir,model,session,receipt,rows,report,api,run,latestTelemetry,restartProxy,observeRequestPhase}=ctx
 assert.notEqual(project,proxyWorkdir,'E42 separate CWD requires distinct configured proxy workdir')
 assert.equal(ctx.expectedClientVersion,'2.0.21')
 const outcomes=[];report.extended={result:'RUNNING',outcomes,stableApiRevision:'8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72',project,proxyWorkdir}
 const base=['run','--server',clientURL,'--auto','--format','json','--session',session,'--agent','build','--model','anthropic/'+model]
 async function turn(label,prompt,flags=base){
  observeRequestPhase(label)
  const result=await run([...flags,prompt],label)
  assert.equal(result.code,0,label+' client exit');const events=parse(result.stdout)
  assert(!events.some(e=>e.type==='error'),label+' client error')
  assert(events.some(e=>e.type==='text'),label+' missing answer')
  return {events,text:textOf(events),session:sessionOf(events)}
 }
 function record(label,details={}){outcomes.push({label,result:'PASS',...details})}
 function assertReceipt(result,label){assert(result.text.includes(receipt),label+' lost exact owned receipt')}
 async function context(){const result=unwrap(await api(`/api/session/${session}/context`));assert(Array.isArray(result),'Supported context API returned unexpected data');return result}
 function lastPrimary(){return rows.findLast(r=>r.session===session&&r.agent==='build'&&!r.source)}
 function primarySafety(){
  const primary=rows.filter(r=>r.session===session&&r.agent==='build'&&!r.source)
  assert(primary.every(r=>r.mode==='primary'&&r.attested),'Primary identity lost signed plugin witness')
  assert(primary.every(r=>r.clientCwd===project),'Actual client system CWD drifted')
 }
 async function verifyResume(prior,current,label){
  assert.equal(current.isResume,true,label+' did not resume')
  assert.equal(current.lineageType,'continuation',label+' did not preserve continuation lineage')
  assert.notEqual(current.sdkSessionId,prior.sdkSessionId,label+' did not publish distinct durable SDK fork')
  const currentRow=rows.find(r=>r.requestId===current.requestId),priorRow=rows.find(r=>r.requestId===prior.requestId)
  assert(currentRow&&priorRow,'Missing request-correlated telemetry witness')
  assert.equal(currentRow.clientSystemHash,priorRow.clientSystemHash,label+' client system changed; cache95 is unqualified')
  const cached=(prior.cacheReadInputTokens??0)+(prior.cacheCreationInputTokens??0)
  assert(cached>0&&(current.cacheReadInputTokens??0)>=cached*0.95,label+' lost previous cached prefix')
  record(label,{isResume:current.isResume,lineage:current.lineageType,priorSdk:prior.sdkSessionId,currentSdk:current.sdkSessionId,cachedPrefix:cached,cacheRead:current.cacheReadInputTokens,ratio:current.cacheReadInputTokens/cached})
 }
 // Ordinary and process-restart cache gates use stable system and catalog hashes.
 const ordinaryPrior=await latestTelemetry(session)
 const ordinary=await turn('extended-ordinary','Repeat the exact original fixture receipt from context without tools.')
 assertReceipt(ordinary,'ordinary');await verifyResume(ordinaryPrior,await latestTelemetry(session),'ordinary-cache95')
 const beforeRestart=await latestTelemetry(session)
 const restarted=await restartProxy()
 assert(restarted.previousPid&&restarted.currentPid&&restarted.previousPid!==restarted.currentPid,'Not a true proxy process restart')
 assert(restarted.previousJoined,'Previous proxy/SDK subprocess custody did not join')
 assert(restarted.sameConfig&&restarted.sameStore&&restarted.sameProfile&&restarted.sameWorkdir,'Restart changed durable identity')
 const afterRestart=await turn('extended-restart','Repeat the exact original fixture receipt from context without tools.')
 assertReceipt(afterRestart,'restart');await verifyResume(beforeRestart,await latestTelemetry(session),'restart-cache95')
 record('true-process-restart',restarted)
 // Read real disposable data; remove its exact turn using stable supported APIs.
 const undoMarker='OWNED_UNDO_'+randomUUID(),undoPath=join(project,'undo-owned.txt')
 writeFileSync(undoPath,undoMarker+'\n',{mode:0o600});ctx.registerMarker('undo',undoMarker)
 const disposable=await turn('extended-undo-read',`Use read exactly once on ${undoPath}. Return its exact text, with no other tools.`)
 assert(disposable.text.includes(undoMarker),'Undo fixture was never read')
 const beforeUndo=await context(),removed=beforeUndo.find(m=>m.type==='user'&&String(m.text??'').includes(undoPath))
 assert(removed?.id,'Missing removable user turn in supported context API')
 await api(`/api/session/${session}/revert/stage`,'POST',{messageID:removed.id,files:false})
 await api(`/api/session/${session}/revert/commit`,'POST')
 assert(!JSON.stringify(await context()).includes(undoMarker),'Committed undo retained removed result')
 const undone=await turn('extended-after-undo','Return the exact original fixture receipt from context without tools.')
 assertReceipt(undone,'undo');const undoTelemetry=await latestTelemetry(session)
 assert.equal(undoTelemetry.lineageType,'undo','Required lineage=undo missing')
 assert.equal(lastPrimary().hasUndoMarker,false,'Removed undo result reached model after commit')
 record('supported-undo',{lineage:undoTelemetry.lineageType,removedMessageId:removed.id})
 // A fork must not mutate the original supported client context.
 const forkMarker='OWNED_FORK_'+randomUUID(),originalSnapshot=await context(),originalHash=sha(originalSnapshot)
 ctx.registerMarker('fork',forkMarker)
 const forkStart=rows.length
 const fork=await turn('extended-fork',`Fork-only token ${forkMarker}. Return the original fixture receipt without tools.`,[...base,'--fork'])
 assertReceipt(fork,'fork');assert(fork.session&&fork.session!==session,'Client fork reused root session')
 const forkRows=rows.slice(forkStart).filter(r=>r.session===fork.session&&r.agent==='build')
 assert(forkRows.length&&forkRows.every(r=>!r.attested),'Fork wrongly attested as human root')
 assert.equal(sha(await context()),originalHash,'Fork changed original supported client context')
 const original=await turn('extended-original-after-fork','Return the exact original fixture receipt from context without tools.')
 assertReceipt(original,'original after fork');assert.equal(lastPrimary().hasForkMarker,false,'Fork marker leaked to original model history')
 record('independent-fork',{forkSession:fork.session,originalContextUnchangedBeforeContinuation:true})
 // Summary probe belongs to a disposable fork, never original primary history.
 const summaryMarker='OWNED_SUMMARY_'+randomUUID(),summaryStart=rows.length
 ctx.registerMarker('summary',summaryMarker)
 await turn('extended-summary',`Summarize the original fixture receipt in one sentence. Probe ${summaryMarker}`,[...base.slice(0,base.indexOf('--agent')),...base.slice(base.indexOf('--agent')+2),'--fork','--agent','summary'])
 const summaryRows=rows.slice(summaryStart).filter(r=>r.agent==='summary')
 assert(summaryRows.length&&summaryRows.every(r=>r.source==='subagent-summary'&&r.mode==='subagent'&&!r.session&&!r.attested),'Summary was not detached')
 assert(!JSON.stringify(await context()).includes(summaryMarker),'Summary probe changed root history')
 record('detached-summary')
 // This is intentionally one actual task-tool instruction, not injected children.
 const childrenStart=rows.length
 const children=await turn('extended-parallel-children','Launch exactly two general subagents concurrently using the task tool. Ask the first to return CHILD_ALPHA_ONLY and the second CHILD_BRAVO_ONLY, without tools. Wait for both, then return both exact tokens. Do not read files or run shell commands.')
 assert(children.text.includes('CHILD_ALPHA_ONLY')&&children.text.includes('CHILD_BRAVO_ONLY'),'Primary did not receive both child results')
 const childRows=rows.slice(childrenStart).filter(r=>r.agent==='general')
 assert(new Set(childRows.map(r=>r.session)).size>=2,'Missing independent child sessions')
 assert(childRows.every(r=>r.session&&r.mode==='subagent'&&!r.attested),'Child plugin identity invalid')
 assert(childRows.some((a,i)=>childRows.some((b,j)=>i!==j&&a.startedAt<b.completedAt&&b.startedAt<a.completedAt)),'Children did not overlap')
 record('overlapping-independent-children',{sessions:[...new Set(childRows.map(r=>r.session))]})
 // Stable API's wait lives under /api/experimental, unlike the beta gate.
 await turn('extended-preserve-before-compact','State the exact original fixture receipt and preserve it for the next turn. No tools.')
 const compactStart=rows.length
 observeRequestPhase('extended-compaction')
 await api(`/api/session/${session}/compact`,'POST',{})
 await api(`/api/experimental/session/${session}/wait`,'POST')
 const compactContext=await context()
 assert(compactContext.some(m=>m.type==='compaction'&&m.summary),'No durable compaction summary')
 const compactionRows=rows.slice(compactStart).filter(r=>r.source==='subagent-compaction')
 assert(compactionRows.length&&compactionRows.every(r=>r.session===session&&r.agent==='compaction'&&r.mode==='primary'&&!r.attested),'Compaction attachment/plugin classification wrong')
 const afterCompact=await turn('extended-after-compaction','Return the exact original fixture receipt from context without tools.')
 assertReceipt(afterCompact,'compaction');record('attached-compaction',{requests:compactionRows.length})
 primarySafety()
 assert(rows.length&&rows.every(r=>r.pairing&&r.historyHash),'Every request requires immutable sanitized history/pairing witnesses')
 assert(rows.every(r=>r.pairing.results<=r.pairing.uses),'Invalid tool/result envelope count')
 report.extended.result='PASS'
 return report.extended
}

// Relay helper: sanitized request facts only; never persist body/system text.
export function requestBodyWitness(body,markers={}){
 const system=typeof body.system==='string'?body.system:(body.system??[]).map(b=>b.text??'').join('\n')
 const messages=body.messages??[],text=JSON.stringify(messages)
 const uses=messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='tool_use')
 const results=messages.flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='tool_result')
 return {historyHash:sha(messages),messageHashes:messages.map(sha),toolCatalogHash:sha(body.tools??[]),clientSystemHash:sha(body.system??null),
  clientCwd:system.match(/Working directory:\s*([^\n]+)/i)?.[1]?.trim()??null,pairing:assertToolPairing(messages),
  toolPairs:uses.map(u=>({id:u.id,name:u.name,inputHash:sha(u.input),resultHash:results.find(r=>r.tool_use_id===u.id)?sha(results.find(r=>r.tool_use_id===u.id)):null})),
  hasUndoMarker:!!markers.undo&&text.includes(markers.undo),hasForkMarker:!!markers.fork&&text.includes(markers.fork),hasSummaryMarker:!!markers.summary&&text.includes(markers.summary)}
}
