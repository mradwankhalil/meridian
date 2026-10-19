#!/usr/bin/env node
// Actual stable OpenCode -> exact Meridian -> native Claude. No manual headers.
// No inference admitted until actual plugin catalog adoption + signed hook.
// Auxiliary requests are observed and refused locally in this bounded first arm.
import assert from 'node:assert/strict'
import cp from 'node:child_process'
import {syncBuiltinESMExports,createRequire} from 'node:module'
import {createServer} from 'node:http'
import {createHmac,createHash,randomUUID} from 'node:crypto'
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {once} from 'node:events'
import {observeChildClosure,stopAndJoinChild} from '/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/scripts/lib/e2eProcessCustody.mjs'
import {resolveOpenCodeScrub,configureOpenCodeScrub,verifyOpenCodeScrub} from '/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/scripts/lib-opencode-scrub-preflight.mjs'
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL,'1','Explicit live opt-in required')
const repo=realpathSync(process.env.E2E_MERIDIAN_ROOT??'/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe')
const executable=realpathSync(process.env.E2E_OPENCODE_BIN??'/tmp/meridian-1410-opencode-2021/node_modules/.bin/opencode')
const native=realpathSync(process.env.E2E_NATIVE_BIN??'/Users/rynfar/.local/bin/claude')
const evidence=process.env.E2E_EVIDENCE_DIR??'/tmp/meridian-1410-live-evidence',privateRoot=process.env.E2E_PRIVATE_DIR??'/tmp/meridian-1410-private-live'
const root=realpathSync(mkdtempSync(join(tmpdir(),'meridian-1410-actual-live-')))
for(const name of ['home','project','client','meridian','sessions','config','data','cache','state'])mkdirSync(join(root,name),{mode:0o700})
const model='claude-opus-5-5',marker='OWNED_RECEIPT_'+randomUUID(),project=join(root,'project')
writeFileSync(join(project,'receipt.txt'),marker+'\n',{mode:0o600})
const grant=join(privateRoot,'grant.json');assert.equal(statSync(grant).mode&0o077,0)
const profiles=JSON.parse(readFileSync(grant,'utf8'));assert(profiles.length===1&&profiles[0].type==='oauth-token'&&!profiles[0].refreshToken)
const usage=JSON.parse(readFileSync(join(evidence,'read-only-usage-guard.json'),'utf8'));assert(usage.canInfer&&usage.extraUsageEnabled===false)
const actors=[],nativeSpawn=cp.spawn,nativeExecFile=cp.execFile
for(const name of ['spawn','execFile']){
 const original=cp[name];cp[name]=function(...args){const child=Reflect.apply(original,this,args);actors.push({command:String(args[0]),child,witness:observeChildClosure(child)});return child}
}
syncBuiltinESMExports()
const report={result:'RUNNING',scope:'Actual OpenCode2.0.21 + exact correction built V2 plugin + real SDK/native Opus5.5; reporter client/model/platform unspecified',head:'423477f19812b08e15d332d4f7c9c91ebf4e8650',model,root,platform:process.platform+'/'+process.arch,node:process.version,paidExtraUsageDisabled:true,usageGuardTime:new Date(statSync(join(evidence,'read-only-usage-guard.json')).mtimeMs).toISOString(),requests:[],catalogRequests:[],inferenceAdmissions:0,auxiliaryBlocked:0}
let proxy,relay,host,hostWitness,active,guardClosed=false,catalogQualified=false,hostOutput='',hostErrors=''
const privateLogs=[];const originalConsole={}
for(const name of ['log','debug','error','warn']){originalConsole[name]=console[name];console[name]=(...args)=>{if(privateLogs.length<5000)privateLogs.push(args.map(String).join(' '))}}
for(const key of Object.keys(process.env))if(/^(MERIDIAN_|CLAUDE_|CLAUDE_PROXY_|ANTHROPIC_|OPENCODE_)/.test(key))delete process.env[key]
Object.assign(process.env,{HOME:join(root,'home'),PWD:project,INIT_CWD:project,MERIDIAN_CONFIG_DIR:join(root,'meridian'),MERIDIAN_SESSION_DIR:join(root,'sessions'),MERIDIAN_WORKDIR:project,MERIDIAN_PASSTHROUGH:'1',MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1',MERIDIAN_CLAUDE_PATH:native})
process.chdir(project)
const clientEnv={PATH:process.env.PATH,HOME:join(root,'home'),LANG:'en_US.UTF-8',PWD:project,INIT_CWD:project,OPENCODE_CONFIG_DIR:join(root,'client'),OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_SERVER_PASSWORD:'owned-local-live',OPENCODE_PASSWORD:'owned-local-live',MERIDIAN_CONFIG_DIR:join(root,'meridian')}
for(const kind of ['CONFIG','DATA','CACHE','STATE'])clientEnv['XDG_'+kind+'_HOME']=join(root,kind.toLowerCase())
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
async function invoke(command,args,label,allowFailure=false,timeoutMs=120000){
 const child=cp.spawn(command,args,{cwd:project,env:clientEnv,stdio:['ignore','pipe','pipe']});active=child
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c)
 const timer=setTimeout(()=>child.kill('SIGTERM'),timeoutMs),force=setTimeout(()=>child.kill('SIGKILL'),timeoutMs+5000)
 const [code,signal]=await once(child,'close').finally(()=>{clearTimeout(timer);clearTimeout(force);active=undefined})
 writeFileSync(join(privateRoot,label+'.stdout'),stdout,{mode:0o600});writeFileSync(join(privateRoot,label+'.stderr'),stderr,{mode:0o600})
 report[label]={code,signal}
 if(!allowFailure)assert.equal(code,0,label+' did not exit0')
 return {stdout,stderr,code,signal}
}
function signedTurn(headers){
 try{
 const parts=(headers.get('x-meridian-opencode-turn')??'').split('.');if(parts.length!==3||parts[0]!=='v1')return false
 const payload=Buffer.from(parts[1],'base64url').toString('utf8'),decoded=JSON.parse(payload)
 const key=Buffer.from(readFileSync(join(root,'meridian/opencode-turn.key'),'utf8').trim(),'base64url')
 return decoded.g==='oc2v2016'&&decoded.s===headers.get('x-opencode-session')&&decoded.a===headers.get('x-opencode-agent-name')&&parts[2]===createHmac('sha256',key).update('meridian.opencode.turn.v1\0').update(payload).digest('base64url')
 }catch{return false}
}
function firstOutcome(row){
 if(!report.firstOutcome){report.firstOutcome={route:row.route,status:row.status,model:row.responseModel??row.model,agent:row.agent,attested:row.attested,completed:row.messageStopped===true,error:row.error??null,diagnostic:row.diagnostic??null};writeFileSync(join(evidence,'live-first-outcome.json'),JSON.stringify(report.firstOutcome,null,2)+'\n',{mode:0o600})}
}
const pending=new Set(),controllers=new Set()
try{
 report.client=(await invoke(executable,['--version'],'version',false,30000)).stdout.trim();assert.equal(report.client,'opencode v2.0.21')
 report.native=(await invoke(native,['--version'],'native-version',false,30000)).stdout.trim()
 report.executable={path:executable,sha256:hash(executable),nativePath:native,nativeSha256:hash(native)}
 report.sdk=JSON.parse(readFileSync(join(repo,'node_modules/@anthropic-ai/claude-agent-sdk/package.json'),'utf8')).version
 const scrub=resolveOpenCodeScrub('/tmp/meridian-1410-scrub-consumer/node_modules/@rynfar/meridian-plugin-opencode-scrub/dist/index.js','0.2.3')
 const {startProxyServer}=await import(pathToFileURL(join(repo,'dist/server.js')))
 proxy=await startProxyServer({port:0,host:'127.0.0.1',silent:true,profiles,defaultProfile:profiles[0].id,...configureOpenCodeScrub(root,scrub)})
 if(!proxy.server.listening)await once(proxy.server,'listening')
 const proxyURL='http://127.0.0.1:'+proxy.server.address().port
 report.scrubPreflight=verifyOpenCodeScrub(await(await fetch(proxyURL+'/plugins/list')).json(),scrub)
 async function handle(req,res){
  const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),120000)
  try{
   const headers=new Headers();for(const[name,value]of Object.entries(req.headers))if(value!==undefined&&!['host','connection','content-length'].includes(name))headers.set(name,String(value))
   const chunks=[];let size=0;for await(const c of req){size+=c.length;assert(size<=4*1024*1024);chunks.push(c)}
   const body=chunks.length?Buffer.concat(chunks):undefined,path=new URL(req.url,'http://127.0.0.1').pathname
   let row
   if(req.method==='GET'&&path==='/v1/models')report.catalogRequests.push({method:'GET',route:path})
   else{
    assert.equal(req.method,'POST');assert.equal(path,'/v1/messages');const parsed=JSON.parse(body)
    const messages=JSON.stringify(parsed.messages??[])
    const toolResults=(parsed.messages??[]).flatMap(m=>Array.isArray(m.content)?m.content:[]).filter(b=>b.type==='tool_result')
    row={route:path,model:parsed.model,stream:parsed.stream===true,session:headers.get('x-opencode-session'),agent:headers.get('x-opencode-agent-name'),mode:headers.get('x-opencode-agent-mode'),source:headers.get('x-meridian-source'),attested:signedTurn(headers),toolCount:parsed.tools?.length??0,hasMarker:messages.includes(marker),resultIds:toolResults.map(b=>b.tool_use_id),hasOwnedResult:toolResults.some(b=>JSON.stringify(b.content).includes(marker))}
    report.requests.push(row)
    if(row.agent!=='build'||row.mode!=='primary'){row.localAuxiliaryBlocked=true;report.auxiliaryBlocked++;res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{type:'invalid_request_error',message:'Owned bounded arm does not admit auxiliary inference'}}));return}
    assert(catalogQualified,'No actual client discovery adoption before inference');assert(!guardClosed,'Inference blocked after first failed completion')
    assert.equal(parsed.model,model);assert(row.session&&row.attested&&!row.source,'Missing cryptographic signed primary/session/agent witness')
    row.pluginLoadedBeforeForward=true;report.inferenceAdmissions++
   }
   const upstream=await fetch(proxyURL+req.url,{method:req.method,headers,...(body?{body}:{}),signal:controller.signal})
   if(row)row.status=upstream.status
   res.writeHead(upstream.status,Object.fromEntries(upstream.headers))
   let text=''
   if(!upstream.body){res.end();return}
   for await(const chunk of upstream.body){
    const decoded=new TextDecoder().decode(chunk);text+=decoded
    if(row){
     const lines=text.split('\n');text=lines.pop()
     for(const line of lines)if(line.startsWith('data: ')){
      let event;try{event=JSON.parse(line.slice(6))}catch{continue}
      if(event.type==='message_start')row.responseModel=event.message?.model
      if(event.type==='error'||event.error){row.error=event.error?.type??'provider_error';const msg=String(event.error?.message??'');row.diagnostic=msg.replace(/sk-[A-Za-z0-9_-]+/g,'[redacted]').slice(0,600);guardClosed=true;report.providerRefusal={type:row.error,diagnostic:row.diagnostic};firstOutcome(row)}
      if(event.type==='message_stop'){row.messageStopped=true;firstOutcome(row)}
     }
    }
    res.write(chunk)
   }
   if(row&&upstream.status!==200){guardClosed=true;row.error??='http_'+upstream.status;firstOutcome(row)}
   res.end()
  }catch(error){guardClosed=true;report.relayFailure=String(error).slice(0,500);if(!res.headersSent)res.writeHead(502);res.end('Owned guarded relay refused request')}
  finally{clearTimeout(timeout);controllers.delete(controller)}
 }
 relay=createServer((req,res)=>{const promise=handle(req,res).finally(()=>pending.delete(promise));pending.add(promise)})
 await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve))
 const baseURL='http://127.0.0.1:'+relay.address().port+'/v1'
 writeFileSync(join(root,'client/opencode.json'),JSON.stringify({model:'anthropic/'+model,share:'disabled',providers:{anthropic:{settings:{apiKey:'owned-local-nonsecret',baseURL}}}},null,2),{mode:0o600})
 await invoke(process.execPath,[join(repo,'dist/cli.js'),'setup','--v2','--opencode-bin',executable],'setup',false,30000)
 const cfg=JSON.parse(readFileSync(join(root,'client/opencode.json'),'utf8')),plugin=realpathSync(join(repo,'dist/meridian-v2'))
 const resolvePlugin=p=>realpathSync(p.startsWith('file:')?fileURLToPath(p):p)
 assert.deepEqual(cfg.plugins.map(resolvePlugin),[plugin]);assert.equal(cfg.providers.anthropic.settings.baseURL,baseURL);assert(!cfg.plugin)
 report.plugin={path:plugin,package:JSON.parse(readFileSync(join(plugin,'package.json'),'utf8')).name,sha256:hash(join(plugin,'index.js')),ownerVersion:JSON.parse(readFileSync(join(repo,'package.json'),'utf8')).version,setupExit:0,canonicalField:'plugins',entries:1,providerBaseURL:baseURL,hardcodedModelWindow:false}
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve))
 host=cp.spawn(executable,['serve','--hostname','127.0.0.1','--port',String(port),'--print-logs','--log-level','debug'],{cwd:project,env:clientEnv,stdio:['ignore','pipe','pipe']});hostWitness=observeChildClosure(host);host.stdout.on('data',c=>hostOutput+=c);host.stderr.on('data',c=>hostErrors+=c)
 const clientURL='http://127.0.0.1:'+port,auth='Basic '+Buffer.from('opencode:owned-local-live').toString('base64')
 let selected
 for(let attempt=0;attempt<150;attempt++){if(host.exitCode!==null)throw Error('Client API exited');try{const r=await fetch(clientURL+'/api/model',{headers:{authorization:auth},signal:AbortSignal.timeout(1000)});if(r.ok){const catalog=await r.json();selected=catalog.data?.find(m=>m.providerID==='anthropic'&&m.id===model);if(selected&&report.catalogRequests.length)break}}catch{}await new Promise(r=>setTimeout(r,100))}
 assert(selected&&report.catalogRequests.length,'Actual client model discovery missing')
 assert.equal(selected.limit.context,1000000);assert(selected.variants.some(v=>v.id==='xhigh'))
 report.catalogAdoption={id:selected.id,providerID:selected.providerID,name:selected.name,context:selected.limit.context,variants:selected.variants.map(v=>v.id),actualPluginGet:report.catalogRequests.length>0,beforeInference:report.inferenceAdmissions===0}
 catalogQualified=true;writeFileSync(join(evidence,'live-pre-inference-preflight.json'),JSON.stringify({plugin:report.plugin,catalog:report.catalogAdoption,scrub:report.scrubPreflight},null,2)+'\n',{mode:0o600})
 const first=await invoke(executable,['run','--server',clientURL,'--auto','--format','json','--model','anthropic/'+model,'Use read exactly once on '+join(project,'receipt.txt')+'. Then repeat its receipt. Do not call any other tool.'],'first-read',true,180000)
 assert(!report.providerRefusal&&!guardClosed,'First arm refused or missing completion; all further account inference stopped')
 assert.equal(first.code,0)
 const events=first.stdout.split('\n').filter(l=>l.startsWith('{')).map(l=>JSON.parse(l))
 assert(!events.some(e=>e.type==='error'),'Client error event')
 assert(events.some(e=>e.part?.type==='tool'&&e.part.state?.status==='completed'&&JSON.stringify(e.part.state.output).includes(marker)),'Actual read result missing')
 assert(events.some(e=>e.type==='text'&&e.part?.text.includes(marker)),'Final client answer missing receipt')
 const session=events.find(e=>e.sessionID)?.sessionID;assert(session)
 assert(report.requests.some(r=>r.session===session&&r.hasOwnedResult),'No actual result round trip')
 report.firstReadComplete=true
 const resumed=await invoke(executable,['run','--server',clientURL,'--format','json','--session',session,'--model','anthropic/'+model,'Repeat the receipt from the previous user turn without any tools.'],'same-session-continuation',true,180000)
 assert(!report.providerRefusal&&!guardClosed);assert.equal(resumed.code,0);assert(resumed.stdout.includes(marker),'Continuation lost receipt')
 report.continuationComplete=true
 const require=createRequire(join(repo,'package.json')),sdk=await import(pathToFileURL(require.resolve('@anthropic-ai/claude-agent-sdk')))
 const rows=await(await fetch(proxyURL+'/telemetry/requests?limit=100')).json()
 report.telemetry=rows.map(r=>({model:r.model,isResume:r.isResume,lineageType:r.lineageType,cacheRead:r.cacheReadInputTokens,cacheCreation:r.cacheCreationInputTokens,sdkSessionId:r.sdkSessionId}))
 const models=new Set()
 for(const id of new Set(rows.map(r=>r.sdkSessionId).filter(Boolean))){process.env.CLAUDE_CONFIG_DIR=join(root,'meridian/profiles',profiles[0].id);for(const row of await sdk.getSessionMessages(id,{dir:project}))if(row.type==='assistant'&&typeof row.message?.model==='string')models.add(row.message.model)}
 report.observedModels=[...models];assert(models.has(model))
 report.scrubFinal=verifyOpenCodeScrub(await(await fetch(proxyURL+'/plugins/list')).json(),scrub,true)
 report.result='PASS'
}catch(error){report.result='FAIL';report.failure=String(error).slice(0,1000)}
finally{
 guardClosed=true
 if(active&&active.exitCode===null)active.kill('SIGTERM')
 if(host)report.clientClosure=await stopAndJoinChild(host,hostWitness,{graceMs:5000,forceMs:3000})
 if(proxy){try{report.scrubFinal??=verifyOpenCodeScrub(await(await fetch('http://127.0.0.1:'+proxy.server.address().port+'/plugins/list')).json(),resolveOpenCodeScrub('/tmp/meridian-1410-scrub-consumer/node_modules/@rynfar/meridian-plugin-opencode-scrub/dist/index.js','0.2.3'),report.inferenceAdmissions>0)}catch(error){report.scrubFinalFailure=error?.name}await proxy.close()}
 for(const controller of controllers)controller.abort()
 if(relay){relay.closeAllConnections();await new Promise(resolve=>relay.close(resolve))}
 await Promise.allSettled([...pending])
 report.children=[];for(const actor of actors)report.children.push({command:actor.command,...await stopAndJoinChild(actor.child,actor.witness)})
 report.joined=report.children.every(r=>r.joined)&&(!report.clientClosure||report.clientClosure.joined);if(!report.joined)report.result='FAIL'
 report.endExecutableHash=hash(executable);report.endNativeHash=hash(native);report.identityUnchanged=report.executable?.sha256===report.endExecutableHash&&report.executable?.nativeSha256===report.endNativeHash
 writeFileSync(join(privateRoot,'proxy-private.log'),privateLogs.join('\n'),{mode:0o600});writeFileSync(join(privateRoot,'client-server.stdout'),hostOutput,{mode:0o600});writeFileSync(join(privateRoot,'client-server.stderr'),hostErrors,{mode:0o600})
 writeFileSync(join(evidence,'actual-v2-live-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
 for(const name of Object.keys(originalConsole))console[name]=originalConsole[name]
 cp.spawn=nativeSpawn;cp.execFile=nativeExecFile;syncBuiltinESMExports()
 process.stdout.write(JSON.stringify({result:report.result,joined:report.joined,report:join(evidence,'actual-v2-live-report.json'),failure:report.failure,providerRefusal:report.providerRefusal})+'\n');process.exitCode=report.result==='PASS'?0:1
}

