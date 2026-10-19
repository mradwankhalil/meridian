#!/usr/bin/env bun
// Opt-in actual native Claude Code -> tested build -> real SDK/Claude path.
// Only allowlisted summaries are written; request/SDK bodies stay in memory.
// No raw/private SDK transcript files, grant files, refresh or account writes.
import assert from 'node:assert/strict'
import * as cp from 'node:child_process'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {isDeepStrictEqual} from 'node:util'
import {spyOn} from 'bun:test'

const source=realpathSync(resolve(process.env.E2E_SOURCE_ROOT||'.'))
const output=resolve(process.env.E2E_OUTPUT||'/tmp/meridian-1396-live-evidence/candidate')
const live=process.env.E2E_ALLOW_LIVE_MODEL==='1'
const MODEL='claude-fable-5-1'
const REMINDER="First privately list what you need next; then request every item that doesn't depend on another's result in this one response."
mkdirSync(output,{recursive:true,mode:0o700})
const at=p=>pathToFileURL(join(source,p)).href
const require=createRequire(join(source,'package.json'))
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex')
const git=(...args)=>cp.spawnSync('git',['-C',source,...args],{encoding:'utf8'}).stdout.trim()
const sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')).href)
const client=join(source,'node_modules/.bin/claude')
const {observeChildClosure,stopAndJoinChild}=await import(at('scripts/lib/e2eProcessCustody.mjs'))
const report={source:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),base:'095b4869b5fe386e2f3a273cc5b60ec3853c8659',model:MODEL,
 platform:`${process.platform}/${process.arch}`,osRelease:cp.spawnSync('uname',['-r'],{encoding:'utf8'}).stdout.trim(),node:process.version,bun:Bun.version,
 sdk:JSON.parse(readFileSync(join(source,'node_modules/@anthropic-ai/claude-agent-sdk/package.json'))).version,
 clientPackage:JSON.parse(readFileSync(join(source,'node_modules/@anthropic-ai/claude-code/package.json'))).version,
 nativeClientIntegration:'documented native Claude Code adapter; owner clarified plugins apply to supported OpenCode/Pi integrations',
 live,result:'PREPARED',requests:[],queries:[],checks:[],processes:[],errors:[]}
const save=()=>writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
const check=(ok,name)=>{report.checks.push({name,ok:Boolean(ok)});return Boolean(ok)}
if(!live){save();console.log(JSON.stringify({result:report.result,source:report.source,model:MODEL,modelCalls:0}));process.exit(0)}

// Read once through the supported store; retain only access token in memory.
process.env.MERIDIAN_CREDENTIALS_READONLY='1'
const {createPlatformCredentialStore}=await import(at('src/proxy/tokenRefresh.ts'))
const grant=await createPlatformCredentialStore().read()
const token=grant?.claudeAiOauth?.accessToken
report.readiness={storedAccessPresent:Boolean(token),accessExpired:grant?.claudeAiOauth?.expiresAt?grant.claudeAiOauth.expiresAt<Date.now():null,refreshUsed:false,grantWritten:false}
assert(token && report.readiness.accessExpired===false,'No current access-only credential: stop without login/refresh')
const sanitize=v=>String(v).replaceAll(token,'[REDACTED]').replace(/(?:sk-ant|sk-proj)-[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,1400)
for(const key of Object.keys(process.env))if(/^(MERIDIAN_|CLAUDE|ANTHROPIC_|OPENCODE_|ENABLE_TOOL_SEARCH)/.test(key))delete process.env[key]
const work=join(output,'fixture'),proxyWork=join(output,'proxy-work'),sdkConfig=join(output,'sdk-config'),clientConfig=join(output,'client-config')
for(const dir of [work,proxyWork,sdkConfig,clientConfig,join(output,'config'),join(output,'store')])mkdirSync(dir,{recursive:true,mode:0o700})
Object.assign(process.env,{MERIDIAN_CONFIG_DIR:join(output,'config'),MERIDIAN_SESSION_DIR:join(output,'store'),MERIDIAN_WORKDIR:proxyWork,
 MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_PASSTHROUGH:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1',
 CLAUDE_CONFIG_DIR:sdkConfig,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',DISABLE_AUTOUPDATER:'1'})
const receipt=randomUUID(),names=Array.from({length:3},()=>`step-${randomUUID()}.txt`)
for(let i=0;i<3;i++)writeFileSync(join(work,names[i]),i<2?`Next: ${join(work,names[i+1])}\n`:`Receipt: ${receipt}\n`)
const logs=[],spies=[],actors=[],queries=[],requests=[],sources=[]
const say=console.log.bind(console)
for(const name of ['log','warn','error','debug'])console[name]=(...args)=>logs.push(args.map(String).join(' '))
for(const name of ['spawn','execFile']){
 const original=cp[name]
 spies.push(spyOn(cp,name).mockImplementation((...args)=>{
  const child=Reflect.apply(original,cp,args)
  if(!actors.some(actor=>actor.child===child))actors.push({child,witness:observeChildClosure(child)})
  return child
 }))
}
const originalQuery=sdk.query
spies.push(spyOn(sdk,'query').mockImplementation(params=>{
 const opts=params.options||{}
 const row={index:queries.length+1,model:opts.model,sessionId:opts.sessionId,resume:opts.resume,resumeAt:opts.resumeSessionAt,
  target:digest(opts.sessionId||''),resumeDigest:opts.resume?digest(opts.resume):null,checkpoint:opts.resumeSessionAt?digest(opts.resumeSessionAt):null,
  fork:opts.forkSession===true,tools:Object.keys(opts.mcpServers||{}).length>0,
  grantMatched:opts.env?.CLAUDE_CODE_OAUTH_TOKEN===token,configOwned:opts.env?.CLAUDE_CONFIG_DIR===sdkConfig,cwdOwned:opts.cwd===proxyWork,
  replay:false,inputReminder:false,servedModels:[],assistantUuids:[],iteratorSettled:false,closeCalled:false}
 queries.push(row)
 const observe=v=>{const text=JSON.stringify(v);row.replay ||= text.includes('<conversation_history>');row.inputReminder ||= text.includes(REMINDER)}
 let prompt=params.prompt
 if(typeof prompt==='string')observe(prompt)
 else{const prior=prompt;prompt=(async function*(){for await(const v of prior){observe(v);yield v}})()}
 const actual=originalQuery({...params,prompt})
 return new Proxy(actual,{get(target,key){
  if(key==='close')return()=>{row.closeCalled=true;return target.close()}
  if(key===Symbol.asyncIterator)return async function*(){try{for await(const event of actual){
   if(event.type==='system'&&event.subtype==='init'){row.cliVersion=event.claude_code_version;row.initModel=event.model}
   if(event.type==='assistant'){
    if(event.message?.model&&!row.servedModels.includes(event.message.model))row.servedModels.push(event.message.model)
    if(event.uuid)row.assistantUuids.push(event.uuid)
    if(event.error)row.error={type:event.error,text:sanitize(JSON.stringify(event.message?.content||[]))}
   }
   if(event.type==='result'){row.terminal={subtype:event.subtype,isError:event.is_error,sessionMatched:event.session_id===opts.sessionId,usage:event.usage,modelUsage:event.modelUsage};row.sessionId=event.session_id}
   yield event
  }}finally{row.iteratorSettled=true}}
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value
 }})
}))
const blocks=m=>Array.isArray(m?.content)?m.content:typeof m?.content==='string'?[{type:'text',text:m.content}]:[]
const strip=({cache_control,...b})=>b
const exact=b=>b?.type==='text'&&b.text===REMINDER
let proxy,relay,outer
let seq=0,stopInference=false
try{
 const version=cp.spawnSync(client,['--version'],{encoding:'utf8'});report.clientVersion=sanitize(version.stdout.trim());assert.equal(version.status,0)
 const {startProxyServer}=await import(at('dist/server.js'))
 proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles:[{id:'owned-access-only',type:'oauth-token',oauthToken:token}],defaultProfile:'owned-access-only'})
 if(!proxy.server.listening)await new Promise(r=>proxy.server.once('listening',r))
 const proxyUrl=`http://127.0.0.1:${proxy.server.address().port}`
 report.route={proxy:'owned loopback port',adapterExpected:'claude-code',nativeHeaders:'observed from actual client; no manufactured session/agent headers',pluginApplicable:false}
 relay=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:255,async fetch(req){
  const url=new URL(req.url),headers=new Headers(req.headers)
  const raw=req.method==='GET'||req.method==='HEAD'?undefined:await req.text()
  let record
  if(req.method==='POST'&&url.pathname.endsWith('/messages')){
   if(stopInference)return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned probe stopped after first refusal/bound'}},{status:409})
   const body=JSON.parse(raw),id=`native-fable-${++seq}`
   headers.set('x-request-id',id)
   if(seq>12){stopInference=true;return Response.json({error:{message:'Owned probe 12-request bound'}},{status:409})}
   record={id,seq,agent:req.headers.get('x-claude-code-agent-id')||'main',body}
   requests.push(record)
  }
  const res=await fetch(proxyUrl+url.pathname+url.search,{method:req.method,headers,...(raw===undefined?{}:{body:raw}),signal:AbortSignal.timeout(120000)})
  if(!record)return res
  record.status=res.status
  if(res.status>=400){stopInference=true;record.providerError=sanitize(await res.clone().text())}
  let bodyText=''
  const stream=res.body?.pipeThrough(new TransformStream({transform(chunk,controller){bodyText+=new TextDecoder().decode(chunk);controller.enqueue(chunk)},flush(){
   try{const data=bodyText.startsWith('event:')?bodyText.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))):[JSON.parse(bodyText)]
    record.responseModels=[...new Set(data.flatMap(e=>e.message?.model?[e.message.model]:e.model?[e.model]:[]))]
    const content=data.flatMap(e=>e.content_block?[e.content_block]:e.content||[])
    record.toolUses=content.filter(b=>b.type==='tool_use').map(b=>({id:b.id,name:b.name,input:b.input}))
    const errs=data.filter(e=>e.type==='error'||e.error)
    if(errs.length){stopInference=true;record.providerError=sanitize(JSON.stringify(errs))}
   }catch(error){record.parseError=sanitize(error)}
  }}))
  return new Response(stream,{status:res.status,headers:res.headers})
 }})
 const env={...process.env}
 for(const key of Object.keys(env))if(/^(MERIDIAN_|CLAUDE|ANTHROPIC_|OPENCODE_|ENABLE_TOOL_SEARCH)/.test(key))delete env[key]
 Object.assign(env,{CLAUDE_CONFIG_DIR:clientConfig,ANTHROPIC_BASE_URL:`http://127.0.0.1:${relay.port}`,ANTHROPIC_AUTH_TOKEN:'owned-loopback-dummy',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',DISABLE_AUTOUPDATER:'1'})
 const agents={'fable-probe':{description:'Required isolated Fable file-chain test worker',prompt:'Use Read only. Follow exactly three linked fixture files, each in its own dependent Read round. Report the final receipt. Do not spawn agents or use background work.',model:MODEL,tools:['Read']}}
 const args=['-p',`Use the Agent tool once to launch fable-probe in the foreground. Have it Read ${join(work,names[0])}, follow each Next path with a separate Read, and return the final receipt. Wait for it and report its result. Do not read the files yourself.`,
  '--model',MODEL,'--agents',JSON.stringify(agents),'--tools','Agent,Read','--allowedTools','Agent','Read','--permission-mode','default',
  '--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--setting-sources','','--output-format','stream-json','--verbose','--max-turns','8']
 report.command={executable:client,args:args.map(a=>a.replaceAll(work,'<OWNED_FIXTURE>')),timeoutMs:240000,maxRequests:12,toolRounds:3,fallbackModel:false}
 outer=cp.spawn(client,args,{cwd:work,env,stdio:['ignore','pipe','pipe']})
 const outerActor=actors.find(a=>a.child===outer);assert(outerActor)
 let stdout='',stderr=''
 outer.stdout.on('data',v=>{stdout+=v});outer.stderr.on('data',v=>{stderr+=v})
 const timer=setTimeout(()=>outer.kill('SIGTERM'),240000)
 await Promise.race([outerActor.witness.joined,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Client join deadline')),250000).unref())])
 clearTimeout(timer)
 report.clientExit=outerActor.witness.state.exitCode
 report.clientReceiptObserved=stdout.includes(receipt)
 report.clientErrors=sanitize(stderr)
 report.providerRefusal=requests.some(r=>r.status>=400||r.providerError)||queries.some(q=>q.error||q.terminal?.isError)
 if(report.providerRefusal)report.result='BLOCKED_PROVIDER_REFUSAL'
 else{
  const agentsSeen=[...new Set(requests.filter(r=>r.agent!=='main').map(r=>r.agent))]
  check(report.clientExit===0,'actual client exits successfully')
  check(agentsSeen.length>=1,'actual native subagent header observed')
  check(report.clientReceiptObserved,'owned final receipt is delivered')
  let transitions=0,soleTransitions=0
  for(const agent of agentsSeen){
   const turns=requests.filter(r=>r.agent===agent)
   check(turns.length>=4,'subagent completes three tool rounds')
   check(turns.every(r=>r.body.model===MODEL),'every native subagent request uses exact model')
   for(let i=0;i<turns.length-1;i++){
    const before=turns[i].body.messages,after=turns[i+1].body.messages,position=before.length-1,tail=blocks(before[position])
    if(before[position]?.role!=='system'||!exact(tail.at(-1)))continue
    if(tail.length>=2&&after[position]?.role==='system'&&isDeepStrictEqual(tail.slice(0,-1).map(strip),blocks(after[position]).map(strip)))transitions++
    if(tail.length===1&&after[position]?.role==='assistant'&&isDeepStrictEqual(before.slice(0,-1),after.slice(0,position)))soleTransitions++
   }
  }
  report.reminderTransitions=transitions;report.reminderOnlyTransitions=soleTransitions
  check(transitions+soleTransitions>0,'actual exact reminder disappears with durable tail unchanged')
  check(queries.some(q=>q.servedModels.includes(MODEL))&&queries.every(q=>q.servedModels.every(m=>m===MODEL||m==='<synthetic>')),'actual served model is exact Fable')
  check(queries.filter(q=>q.tools).slice(1).every(q=>q.resume&&q.resumeAt&&!q.replay),'tool queries continue at SDK checkpoints without replay')
  report.result=report.checks.every(c=>c.ok)?'PARTIAL_LIVE_SUCCESS_ADDITIONAL_HISTORY_CACHE_GATES_REQUIRED':'INCOMPLETE_LIVE_ASSERTIONS'
 }
}catch(error){report.errors.push(sanitize(error?.stack||error));report.result='HARNESS_OR_RUNTIME_FAILURE'}
finally{
 stopInference=true
 if(proxy)try{await proxy.close()}catch(error){report.errors.push(sanitize(error))}
 if(relay)try{await relay.stop(true)}catch(error){report.errors.push(sanitize(error))}
 for(const actor of actors){const state=await stopAndJoinChild(actor.child,actor.witness,{graceMs:5000,forceMs:3000});report.processes.push(state)}
 for(const spy of spies.reverse())spy.mockRestore()
 report.requests=requests.map(r=>({seq:r.seq,id:r.id,agent:r.agent==='main'?'main':digest(r.agent),model:r.body.model,stream:r.body.stream,
  nativeAgentHeader:r.agent!=='main',status:r.status,providerError:r.providerError,models:r.responseModels,parseError:r.parseError,
  exactReminderBlocks:r.body.messages.reduce((n,m)=>n+blocks(m).filter(exact).length,0),
  skeleton:r.body.messages.map(m=>({role:m.role,blocks:blocks(m).map(b=>({type:b.type,digest:digest(strip(b)),...(b.type==='tool_result'?{toolId:digest(b.tool_use_id)}:{}),...(b.type==='tool_use'?{toolId:digest(b.id),name:b.name}:{})}))}))}))
 report.queries=queries.map(({sessionId,resume,resumeAt,assistantUuids,...q})=>({...q,assistantUuids:assistantUuids.map(digest)}))
 report.routeWitnesses=logs.filter(l=>l.startsWith('[PROXY] native-fable-')).map(sanitize)
 report.allObservedChildrenJoined=report.processes.every(p=>p.joined)
 save()
 say(JSON.stringify({result:report.result,requests:report.requests.length,queries:report.queries.length,providerRefusal:report.providerRefusal,allObservedChildrenJoined:report.allObservedChildrenJoined,output}))
}
process.exit(report.result==='PARTIAL_LIVE_SUCCESS_ADDITIONAL_HISTORY_CACHE_GATES_REQUIRED'?0:1)
