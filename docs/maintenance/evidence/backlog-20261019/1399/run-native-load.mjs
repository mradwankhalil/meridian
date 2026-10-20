#!/usr/bin/env bun
// Actual native Claude Code -> Meridian -> real SDK/native Claude -> pinned model.
// Explicit live opt-in, access-only grant, generation/time/quota bounds required.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import * as cp from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,realpathSync,renameSync,appendFileSync,rmSync,statSync} from 'node:fs';
import {join,resolve,sep,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,createHash} from 'node:crypto';
import {spyOn} from 'bun:test';
import {installLoadObserver} from './native-load-observer.mjs';
import {loadContext} from './load-context.mjs';
import {validateOwnedToolCalls} from './load-guards.mjs';
const [repoArg,nativeArg,outArg,durationArg,seedArg,maxGenerationsArg]=process.argv.slice(2);
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL,'1');assert.equal(process.env.E2E_ALLOW_NATIVE_LOAD,'1');
assert(repoArg&&nativeArg&&outArg&&durationArg&&seedArg&&maxGenerationsArg);
const grantFile=process.env.E2E_LIVE_PROFILE_FILE,expectedHead=process.env.E2E_EXPECT_HEAD;
assert(grantFile&&expectedHead,'Explicit access-only grant and exact head required');
const model=process.env.E2E_LOAD_MODEL;assert(['claude-opus-5-5','claude-haiku-5-5'].includes(model),'Explicit qualified model required');
const concurrency=Number(process.env.E2E_LOAD_CLIENTS??4);assert([2,4].includes(concurrency),'Two or four owned native clients');
const repo=realpathSync(repoArg),native=realpathSync(nativeArg),duration=Number(durationArg),seedCount=Number(seedArg),maxGenerations=Number(maxGenerationsArg);
assert([60,3600].includes(duration),'Only one-minute pilot or one-hour load');
assert(Number.isInteger(seedCount)&&seedCount>=0&&seedCount<=19800);assert(Number.isInteger(maxGenerations)&&maxGenerations>=3&&maxGenerations<=4000);
assert(duration!==3600||concurrency===4,'Full-hour pressure requires four clients at the 25-second cycle cadence');
assert(duration!==3600||seedCount===19800,'Full-hour large-store gate requires the full owned fixture seed');
assert(!existsSync(outArg),'New output directory required');mkdirSync(outArg,{recursive:true,mode:0o700});const out=realpathSync(outArg);
const git=(...args)=>spawnSync('git',args,{cwd:repo,encoding:'utf8'}).stdout.trim();assert.equal(git('rev-parse','HEAD'),expectedHead);assert.equal(git('status','--porcelain'),'','Do not run against changing source');
const nativeVersion=spawnSync(native,['--version'],{encoding:'utf8',timeout:5000});assert.equal(nativeVersion.status,0);assert.equal(nativeVersion.stdout.trim(),'2.1.302 (Claude Code)');assert.equal(createHash('sha256').update(readFileSync(native)).digest('hex'),'5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37');
assert.equal(statSync(grantFile).mode&0o077,0);const profiles=JSON.parse(readFileSync(grantFile,'utf8'));assert(profiles.length===1&&profiles[0].type==='oauth-token'&&profiles[0].oauthToken&&profiles[0].refreshToken===undefined);
for(const key of Object.keys(process.env))if(/^(MERIDIAN_|CLAUDE_PROXY_|ANTHROPIC_|CLAUDE_)/.test(key))delete process.env[key];
Object.assign(process.env,{MERIDIAN_CONFIG_DIR:join(out,'proxy-config'),MERIDIAN_SESSION_DIR:join(out,'proxy-sessions'),MERIDIAN_WORKDIR:join(out,'proxy-work'),MERIDIAN_CLAUDE_PATH:native,MERIDIAN_PASSTHROUGH:'1',MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1',MERIDIAN_SILENT:'1',MERIDIAN_SESSION_GC_INTERVAL_MS:'0',MERIDIAN_SHUTDOWN_GRACE_MS:'5000',MERIDIAN_OPUS_MODEL:'opus'});
for(const key of ['MERIDIAN_CONFIG_DIR','MERIDIAN_SESSION_DIR','MERIDIAN_WORKDIR'])mkdirSync(process.env[key],{recursive:true,mode:0o700});
profiles[0].claudeConfigDir=join(out,'profile');mkdirSync(profiles[0].claudeConfigDir,{recursive:true,mode:0o700});
const here=dirname(fileURLToPath(import.meta.url));
const observer=await installLoadObserver(repo,out,model,maxGenerations);
const {observeChildClosure,stopAndJoinChild}=await import(pathToFileURL(join(repo,'scripts/lib/e2eProcessCustody.mjs')).href);
const allActors=[],processSpies=[];
for(const name of ['spawn','execFile']){const original=cp[name];processSpies.push(spyOn(cp,name).mockImplementation((...args)=>{const child=Reflect.apply(original,cp,args);allActors.push({child,witness:observeChildClosure(child)});return child;}));}
const {parseAssistantResponse}=await import(pathToFileURL(join(repo,'scripts/lib/e41-assistant-response.ts')).href);
const {lifecycleLockQueue}=await import(pathToFileURL(join(repo,'src/proxy/session/lifecycleLockQueue.ts')).href);
const lifecycle=await import(pathToFileURL(join(repo,'src/proxy/sessionLifecycle.ts')).href);
const store=await import(pathToFileURL(join(repo,'src/proxy/sessionStore.ts')).href);
const logger=await import(pathToFileURL(join(repo,'src/logger.ts')).href);
const realLogContext=logger.withClaudeLogContext;
const contextSpy=spyOn(logger,'withClaudeLogContext').mockImplementation((context,fn)=>realLogContext(context,()=>loadContext.run(context,fn)));
const {telemetryStore}=await import(pathToFileURL(join(repo,'src/telemetry/index.ts')).href);
const {startProxyServer}=await import(pathToFileURL(join(repo,'src/proxy/server.ts')).href);
const report={head:expectedHead,scope:'Actual parallel native clients and real provider model; public-SDK fork fixtures create owned large-store pressure',durationSeconds:duration,seedCount,maxGenerations,concurrency,minimumWorkerCycleMs:25000,model,context:'200k for Opus; explicit alias opus',native:{version:nativeVersion.stdout.trim(),sha256:createHash('sha256').update(readFileSync(native)).digest('hex')},sdk:observer.sdkVersion,bun:Bun.version,platform:process.platform,arch:process.arch,periodicGcDisabled:true,publicationGcUnchanged:true,cycles:0,clientRequests:0,capacityRefusal:null,failure:null,passed:false};
const actors=[],allowedFiles=new Set(),admission=[],locks=[],snapshots=[],fronts=new Map(),workerRequests=new Map();let instance,stopping=false,loadStartedAt=0,nextQuotaAt=0,quotaPromise;
const record=row=>appendFileSync(join(out,'requests.jsonl'),JSON.stringify({at:Date.now(),...row})+'\n',{mode:0o600});
let stopSignalSent=false;
const stopTimer=setInterval(()=>{if(observer.state.stopped&&!stopSignalSent){stopSignalSent=true;stopping=true;for(const {child,witness} of actors)if(!witness.state.exitSeen)child.kill('SIGTERM');}},100);
stopTimer.unref();
const sidecar=join(process.env.MERIDIAN_SESSION_DIR,'session-gc.json');
function stateSnapshot(){
  if(!existsSync(sidecar))return {at:Date.now(),resources:0,counts:{}};
  const state=JSON.parse(readFileSync(sidecar,'utf8')),counts={};for(const value of Object.values(state.resources))counts[value.state]=(counts[value.state]??0)+1;
  return {at:Date.now(),resources:Object.keys(state.resources).length,counts};
}
const realRun=lifecycleLockQueue.run.bind(lifecycleLockQueue);
const lockSpy=spyOn(lifecycleLockQueue,'run').mockImplementation((path,signal,operation)=>{
  const queued=performance.now();return realRun(path,signal,async()=>{const start=performance.now();try{return await operation();}finally{if(path===sidecar+'.lock')locks.push({at:Date.now(),requestId:loadContext.getStore()?.requestId??null,queueWaitMs:start-queued,externalAcquireAndTransactionMs:performance.now()-start});}});
});
async function quota(){
  if(quotaPromise)return quotaPromise;
  quotaPromise=(async()=>{
    const dir=join(out,'quota');mkdirSync(dir,{recursive:true,mode:0o700});
    const child=spawn(process.execPath,[join(here,'read-only-load-usage-guard.mjs')],{cwd:repo,env:{...process.env,E2E_MERIDIAN_ROOT:repo,E2E_EVIDENCE_DIR:dir},stdio:['ignore','ignore','ignore']});
    const witness=observeChildClosure(child);actors.push({child,witness,kind:'quota'});
    const term=setTimeout(()=>child.kill('SIGTERM'),20_000),kill=setTimeout(()=>child.kill('SIGKILL'),25_000);await witness.joined;clearTimeout(term);clearTimeout(kill);
    assert.equal(witness.state.exitCode,0,'Read-only usage guard process failed');const result=JSON.parse(readFileSync(join(dir,'read-only-usage-guard.json'),'utf8'));
    record({phase:'quota',allowed:result.loadReserveAvailable===true,extraUsageEnabled:result.extraUsageEnabled});assert(result.loadReserveAvailable,'Stop at quota reserve or unknown usage; do not enable paid usage');nextQuotaAt=Date.now()+60_000;
  })();try{return await quotaPromise;}finally{quotaPromise=undefined;}
}
async function runClient(worker,prompt,resume){
  assert(!stopping&&!observer.state.stopped,'Load stopped before new native client');if(Date.now()>=nextQuotaAt)await quota();
  const root=join(out,'clients',String(worker));for(const name of ['home','config','project','cache','data','state'])mkdirSync(join(root,name),{recursive:true,mode:0o700});
  const env={PATH:process.env.PATH,HOME:join(root,'home'),USERPROFILE:join(root,'home'),CLAUDE_CONFIG_DIR:join(root,'config'),XDG_CACHE_HOME:join(root,'cache'),XDG_DATA_HOME:join(root,'data'),XDG_STATE_HOME:join(root,'state'),ANTHROPIC_BASE_URL:`http://127.0.0.1:${fronts.get(String(worker)).port}`,ANTHROPIC_API_KEY:'owned-loopback-not-a-credential',ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN:'',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM:'1',DISABLE_AUTOUPDATER:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};
  const args=['--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',...(resume?['--resume',resume]:[]),'-p',prompt,'--model',model,'--tools','Read','--allowedTools','Read','--max-turns','5','--output-format','json'];
  const child=spawn(native,args,{cwd:join(root,'project'),env,stdio:['ignore','pipe','pipe']});const witness=observeChildClosure(child);actors.push({child,witness,kind:'client'});let stdout='',stderr='';
  child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.length>=512*1024){stdout=stdout.slice(0,512*1024);child.kill('SIGTERM');}});child.stderr.on('data',chunk=>{stderr+=chunk;if(stderr.length>=512*1024){stderr=stderr.slice(0,512*1024);child.kill('SIGTERM');}});
  const term=setTimeout(()=>child.kill('SIGTERM'),180_000),kill=setTimeout(()=>child.kill('SIGKILL'),185_000);await witness.joined;clearTimeout(term);clearTimeout(kill);
  if(witness.state.exitCode!==0)throw Error(report.capacityRefusal?'Observed lifecycle ownership capacity refusal':`Native client exit ${witness.state.exitCode}`);
  const value=JSON.parse(stdout);assert(value.result&&!value.is_error,'Native client must complete');return value;
}
async function cycle(worker){
  const receipt='receipt_'+randomUUID().replaceAll('-',''),dir=join(out,'clients',String(worker),'project');mkdirSync(dir,{recursive:true});
  const files=Array.from({length:3},()=>join(dir,randomUUID()+'.txt'));for(const file of files)allowedFiles.add(file);
  writeFileSync(files[2],receipt);writeFileSync(files[1],'NEXT_FILE='+files[2]);writeFileSync(files[0],'NEXT_FILE='+files[1]);
  const before=workerRequests.get(String(worker))??0,first=await runClient(worker,`Read ${files[0]}. If it contains NEXT_FILE, read that exact path next. Follow the chain until you reach a receipt_ value. Read each file once, in order. Reply with the final receipt only.`);
  assert(first.result.includes(receipt),'Actual native client must read the three dependent owned fixtures');
  const second=await runClient(worker,'Repeat the final receipt just read. Do not call tools.',first.session_id);assert(second.result.includes(receipt));assert.equal(first.session_id,second.session_id);
  assert.equal((workerRequests.get(String(worker))??0)-before,5,'Three dependent reads, answer and follow-up require exactly five client requests');report.cycles++;
}
async function seed(){
  if(seedCount===0)return;
  const source=Object.values(store.readSessionStoreSnapshot()).filter(row=>row.currentTranscript&&row.claudeSessionId).sort((a,b)=>b.lastAccess-a.lastAccess)[0];assert(source?.currentTranscript,'Need owned real SDK mapping before public forks');
  const locator=source.currentTranscript;assert(realpathSync(locator.configDir).startsWith(out+sep));assert(realpathSync(locator.projectDir).startsWith(out+sep));
  const previous=process.env.CLAUDE_CONFIG_DIR;process.env.CLAUDE_CONFIG_DIR=locator.configDir;const ids=[];
  try{
    const before=await observer.sdk.getSessionMessages(source.claudeSessionId,{dir:locator.projectDir});assert(before.length>0);assert(before.filter(row=>row.type==='assistant').every(row=>row.message?.model===model));
    const seedStarted=Date.now();
    for(let index=0;index<seedCount;index++){
      assert(Date.now()-seedStarted<300_000,'Public fork seed exceeded five-minute bound');
      const fork=await observer.sdk.forkSession(source.claudeSessionId,{dir:locator.projectDir,title:'Owned native GC load fixture'});ids.push(fork.sessionId);
      if(index%500===0)writeFileSync(join(out,'progress.json'),JSON.stringify({phase:'public-sdk-fork-seed',completed:index,total:seedCount}));
    }
    assert.deepEqual(await observer.sdk.getSessionMessages(source.claudeSessionId,{dir:locator.projectDir}),before,'Public fork source must remain unchanged');
  }finally{if(previous===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=previous;}
  await lifecycle.registerLiveTranscript({...locator,sessionId:ids[0]});
  // Initialize only this newly owned fixture's bookkeeping under its real
  // local lifecycle queue; no other process owns this isolated directory.
  await lifecycleLockQueue.run(sidecar+'.lock',undefined,async()=>{
    const state=JSON.parse(readFileSync(sidecar,'utf8')),now=Date.now();const seedRecord=Object.values(state.resources).find(row=>row.locator.sessionId===ids[0]);assert(seedRecord);
    for(const id of ids.slice(1)){
      const next={...locator,sessionId:id},key=lifecycle.getTranscriptResourceKey(next),slot=key.slice(0,4),counter=(state.meta.fenceSlots[slot]??0)+1;state.meta.fenceSlots[slot]=counter;
      state.resources[key]={key,generation:`r:${key}:${counter}`,locator:next,state:'live',createdAt:now,updatedAt:now,attempts:0};
    }
    writeFileSync(sidecar+'.fixture',JSON.stringify(state)+'\n',{mode:0o600});renameSync(sidecar+'.fixture',sidecar);
  });report.seeded=ids.length;writeFileSync(join(out,'seed-public-sdk-session-ids.json'),JSON.stringify(ids));
}
function percentile(values,q){if(!values.length)return null;const sorted=values.toSorted((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor(sorted.length*q))];}
try{
  await quota();instance=await startProxyServer({host:'127.0.0.1',port:0,silent:true,maxConcurrent:concurrency,profiles,defaultProfile:profiles[0].id});
  const port=instance.server.address().port;
  for(const worker of ['warmup',...Array.from({length:concurrency},(_,index)=>String(index))])fronts.set(worker,Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:240,async fetch(request){
    const url=new URL(request.url);if(url.pathname.endsWith('/count_tokens'))return Response.json({input_tokens:4000});if(!url.pathname.endsWith('/messages'))return Response.json({});
    if(stopping||observer.state.stopped)return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned load stopped'}},{status:400});
    const started=performance.now(),startedWall=Date.now(),requestId=randomUUID(),body=await request.arrayBuffer();const payload=JSON.parse(Buffer.from(body).toString());assert.equal(payload.model,model);report.clientRequests++;workerRequests.set(worker,(workerRequests.get(worker)??0)+1);const index=report.clientRequests;
    const headers=new Headers(request.headers);for(const name of ['host','connection','content-length','transfer-encoding'])headers.delete(name);headers.set('x-request-id',requestId);
    const response=await fetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`,{method:'POST',headers,body,signal:AbortSignal.any([request.signal,AbortSignal.timeout(170_000)])});
    const text=await response.text();assert(text.length<512*1024);const responseHeaders=new Headers(response.headers);for(const name of ['content-length','content-encoding','transfer-encoding','connection'])responseHeaders.delete(name);
    if(observer.state.stopped){stopping=true;record({request:index,requestId,phase:'load-stopped',reason:observer.state.stopped});return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned load stopped before returning any tool block'}},{status:400});}
    if(!response.ok){let error;try{const value=JSON.parse(text);error={type:value.error?.type,message:observer.state.queries===0&&response.status===400?value.error?.message:undefined,messageSha256:typeof value.error?.message==='string'?createHash('sha256').update(value.error.message).digest('hex'):undefined};}catch{error={type:'non-json'};}report.lastHttpError={status:response.status,...error};if(response.status===503&&text.includes('session transcript ownership capacity is full')){report.capacityRefusal={request:index,status:503,at:Date.now()};stopping=true;}record({request:index,requestId,status:response.status,elapsedMs:performance.now()-started,capacity:!!report.capacityRefusal,error});return new Response(text,{status:response.status,headers:responseHeaders});}
    const parsed=parseAssistantResponse(text,payload.stream===true);
    try{validateOwnedToolCalls(parsed.blocks,allowedFiles,join(out,'clients',worker,'project'));}catch(error){stopping=true;observer.state.stopped??='Owned tool/path guard rejected response';record({request:index,requestId,phase:'tool-guard-rejection',diagnostic:error.diagnostic??{errorType:error.name}});return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned fixture tool guard stopped this load'}},{status:400});}
    // Forward unchanged completed bytes after the owned-path guard. This
    // buffers model responses; it is not a streaming latency benchmark.
    const first=observer.state.queryStarts.get(requestId);assert(first,'Need exact existing request-ID correlation at real SDK admission');admission.push({at:startedWall,requestId,delayMs:first-startedWall});
    record({request:index,requestId,status:response.status,elapsedMs:performance.now()-started,model:payload.model,roles:payload.messages.map(message=>message.role),toolCalls:parsed.blocks.filter(block=>block.type==='tool_use').length});
    return new Response(text,{status:response.status,headers:responseHeaders});
  },error(error){stopping=true;observer.state.stopped??='Native front transport/validation error';record({phase:'front-error',errorType:error.name});return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned front guard stopped this load'}},{status:400});}}));
  await cycle('warmup');report.warmupAdapters=[...new Set(telemetryStore.getRecent({limit:20}).map(metric=>metric.adapter))];assert.deepEqual(report.warmupAdapters,['claude-code'],'Actual native client must use the real Claude Code adapter');await seed();report.beforeLoad=stateSnapshot();report.queriesBeforeLoad=observer.state.queries;loadStartedAt=Date.now();
  const hardStop=setTimeout(()=>{stopping=true;report.hardDeadline=true;for(const {child,witness} of actors)if(!witness.state.exitSeen)child.kill('SIGTERM');},(duration+120)*1000);
  const timer=setInterval(()=>{const snapshot=stateSnapshot();snapshots.push(snapshot);writeFileSync(join(out,'progress.json'),JSON.stringify({phase:'native-load',elapsedSeconds:(Date.now()-loadStartedAt)/1000,cycles:report.cycles,generations:observer.state.generations,...snapshot}));},30_000);
  try{await Promise.all(Array.from({length:concurrency},(_,index)=>index).map(async worker=>{while(!stopping&&!observer.state.stopped&&Date.now()-loadStartedAt<duration*1000){const started=Date.now();await cycle(worker);const pause=Math.min(Math.max(0,25000-(Date.now()-started)),Math.max(0,loadStartedAt+duration*1000-Date.now()));if(pause)await delay(pause);}}));}finally{clearInterval(timer);clearTimeout(hardStop);}
  report.elapsedSeconds=(Date.now()-loadStartedAt)/1000;
  assert(!observer.state.stopped,observer.state.stopped??'Model observer stopped');assert(!report.capacityRefusal,'Ownership capacity exhausted');assert(report.elapsedSeconds>=duration,'Full requested duration required');report.sdkQueriesPerMinute=(observer.state.queries-report.queriesBeforeLoad)/(report.elapsedSeconds/60);if(duration===3600)assert(report.sdkQueriesPerMinute>=28,'Need sustained native-client retirement pressure above the old 256/11-minute bound');report.passed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  clearInterval(stopTimer);
  stopping=true;for(const {child,witness} of actors)if(!witness.state.joined)await stopAndJoinChild(child,witness,{graceMs:2000,forceMs:3000});
  report.beforeClose=stateSnapshot();const closeStarted=Date.now();if(instance)try{await instance.close();}catch(error){report.closeFailure=String(error);report.passed=false;process.exitCode=1;}report.closeMs=Date.now()-closeStarted;report.afterClose=stateSnapshot();
  if(existsSync(sidecar)){const state=JSON.parse(readFileSync(sidecar,'utf8'));report.deletedAfterCloseStarted=Object.values(state.resources).filter(row=>row.state==='deleted'&&row.updatedAt>=closeStarted).length;if(report.deletedAfterCloseStarted>16||report.closeMs>35_000){report.closeBudgetFailure=true;report.passed=false;process.exitCode=1;}}
  for(const front of fronts.values())await front.stop(true);for(const {child,witness} of allActors)if(!witness.state.joined)await stopAndJoinChild(child,witness,{graceMs:2000,forceMs:3000});await observer.close();lockSpy.mockRestore();contextSpy.mockRestore();for(const spy of processSpies.reverse())spy.mockRestore();report.allSpawnedProcesses={started:allActors.length,joined:allActors.filter(actor=>actor.witness.state.joined).length};
  report.model={expected:model,observed:[...observer.state.models],queries:observer.state.queries,generationAttempts:observer.state.generationAttempts,generations:observer.state.generations,blockedGenerations:observer.state.blockedGenerations,stopped:observer.state.stopped};report.sdkChildren={started:observer.state.children,closed:observer.state.closedChildren};report.clientChildren={started:actors.filter(actor=>actor.kind==='client').length,joined:actors.filter(actor=>actor.kind==='client'&&actor.witness.state.joined).length};report.quotaChildren={started:actors.filter(actor=>actor.kind==='quota').length,joined:actors.filter(actor=>actor.kind==='quota'&&actor.witness.state.joined).length};
  report.joined=report.sdkChildren.started===report.sdkChildren.closed&&report.clientChildren.started===report.clientChildren.joined&&report.quotaChildren.started===report.quotaChildren.joined&&report.allSpawnedProcesses.started===report.allSpawnedProcesses.joined;if(!report.joined){report.passed=false;process.exitCode=1;}
  const loadAdmission=admission.filter(row=>row.at>=loadStartedAt),loadLocks=locks.filter(row=>row.at>=loadStartedAt);report.latency={requestPreSdkAdmissionMs:{p50:percentile(loadAdmission.map(row=>row.delayMs),.5),p95:percentile(loadAdmission.map(row=>row.delayMs),.95),p99:percentile(loadAdmission.map(row=>row.delayMs),.99)},lifecycleLocalQueueWaitMs:{p50:percentile(loadLocks.map(row=>row.queueWaitMs),.5),p95:percentile(loadLocks.map(row=>row.queueWaitMs),.95),p99:percentile(loadLocks.map(row=>row.queueWaitMs),.99)},externalAcquireAndTransactionMs:{p50:percentile(loadLocks.map(row=>row.externalAcquireAndTransactionMs),.5),p95:percentile(loadLocks.map(row=>row.externalAcquireAndTransactionMs),.95),p99:percentile(loadLocks.map(row=>row.externalAcquireAndTransactionMs),.99)}};
  writeFileSync(join(out,'lifecycle-lock-timings.json'),JSON.stringify(locks));writeFileSync(join(out,'request-admission-timings.json'),JSON.stringify(admission));writeFileSync(join(out,'lifecycle-snapshots.json'),JSON.stringify(snapshots));
  report.supportedModelSnapshots=[];
  const priorConfig=process.env.CLAUDE_CONFIG_DIR;
  try{for(const locator of observer.state.sessions.slice(-8)){
    if(!locator.sessionId||!locator.configDir||!locator.projectDir||!resolve(locator.configDir).startsWith(out+sep)){report.supportedModelSnapshots.push({query:locator.query,status:'missing-owned-locator'});continue;}
    process.env.CLAUDE_CONFIG_DIR=locator.configDir;
    try{const rows=await observer.sdk.getSessionMessages(locator.sessionId,{dir:locator.projectDir});report.supportedModelSnapshots.push({query:locator.query,sessionId:locator.sessionId,rows:rows.filter(row=>row.type==='assistant').map(row=>({id:row.message?.id,uuid:row.uuid,model:row.message?.model,blocks:row.message?.content?.map(block=>({type:block.type,...(block.type==='tool_use'?{id:block.id,name:block.name}:{})}))}))});}
    catch(error){report.supportedModelSnapshots.push({query:locator.query,status:error.name});}
  }}finally{if(priorConfig===undefined)delete process.env.CLAUDE_CONFIG_DIR;else process.env.CLAUDE_CONFIG_DIR=priorConfig;}
  if(report.joined){for(const name of ['proxy-config','profile','clients'])rmSync(join(out,name),{recursive:true,force:true});report.ownedCredentialAndClientConfigRemoved=true;}
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,joined:report.joined,cycles:report.cycles,failure:report.failure,report:join(out,'report.json')}));
