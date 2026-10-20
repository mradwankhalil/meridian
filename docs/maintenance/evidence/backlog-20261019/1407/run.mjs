#!/usr/bin/env bun
// Real paid model calls. Usage: bun run.mjs baseline-root candidate-root agentlink-root NEW-output-root exact-native-model-id native-cli-path
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync,openSync,closeSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const [baseArg,candidateArg,clientArg,outArg,model,nativeArg]=process.argv.slice(2);
assert(baseArg&&candidateArg&&clientArg&&outArg&&model&&nativeArg,'baseline, candidate, AgentLink, new output directory, exact model and native CLI path required');
const baseline=resolve(baseArg),candidate=resolve(candidateArg),agentlink=resolve(clientArg),out=resolve(outArg);
const nativeExecutable=realpathSync(nativeArg);
const nativeVersion=spawnSync(nativeExecutable,['--version'],{encoding:'utf8'});
assert.equal(nativeVersion.status,0,'Pinned native executable must identify itself');
const nativeSha256=createHash('sha256').update(readFileSync(nativeExecutable)).digest('hex');
assert(!existsSync(out),'Output directory must be new; retain all prior attempts');mkdirSync(out,{recursive:true});
const here=dirname(fileURLToPath(import.meta.url));
const git=(root,...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'}).stdout.trim();
const agentlinkHead=git(agentlink,'rev-parse','HEAD');
assert.equal(agentlinkHead,'ab98566573e893fc4667971a86573fb56beec677');
assert.equal(git(agentlink,'status','--porcelain'),'','AgentLink source must be untouched');
const facade=join(agentlink,'packages/core/src/openAiCompatible/completionFacade.ts');
const entry=join(out,'client.ts');
writeFileSync(entry,readFileSync(join(here,'client-template.ts'),'utf8').replace("'AGENTLINK_COMPLETION_FACADE'",JSON.stringify(facade)));
const build=await Bun.build({entrypoints:[entry],target:'node',format:'esm',outdir:out,naming:'agentlink-client.mjs'});
assert(build.success,JSON.stringify(build.logs));
const report={baseline:git(baseline,'rev-parse','HEAD'),candidate:git(candidate,'rev-parse','HEAD'),agentlinkHead,agentlinkVersion:JSON.parse(readFileSync(join(agentlink,'package.json'),'utf8')).version,sdk:JSON.parse(readFileSync(join(candidate,'node_modules/@anthropic-ai/claude-agent-sdk/package.json'),'utf8')).version,native:{path:nativeExecutable,version:nativeVersion.stdout.trim(),sha256:nativeSha256},model,context:'200k (MERIDIAN_OPUS_MODEL=opus)',platform:process.platform,arch:process.arch,bun:Bun.version,cases:[],passed:false};
if(process.argv.includes('--prepare-only')){writeFileSync(join(out,'prepared.json'),JSON.stringify(report,null,2)+'\n');console.log('Prepared actual AgentLink transport for Node; no proxy or model started.');process.exit(0);}
async function runCase(label,root,mode){
  const dir=join(out,label);mkdirSync(dir);
  const fd=openSync(join(dir,'proxy.log'),'w');
  const server=spawn(process.execPath,[join(here,'live-proxy.mjs'),root,dir,mode,nativeExecutable],{cwd:root,env:{...process.env},stdio:['ignore',fd,fd]});
  closeSync(fd);
  const exited=new Promise((resolveExit,reject)=>{server.once('error',reject);server.once('close',(code,signal)=>resolveExit({code,signal}));});
  let client;
  try{
    const deadline=Date.now()+30_000;
    while(!existsSync(join(dir,'ready.json'))){assert(server.exitCode===null,'Proxy exited before ready');assert(Date.now()<deadline,'Proxy readiness deadline');await delay(50);}
    const {port}=JSON.parse(readFileSync(join(dir,'ready.json'),'utf8'));
    const child=spawn('node',[join(out,'agentlink-client.mjs'),`http://127.0.0.1:${port}/v1`,join(dir,'client.json'),model,mode],{cwd:root,stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',b=>stderr+=b);
    let escalation;
    const timer=setTimeout(()=>{child.kill('SIGTERM');escalation=setTimeout(()=>child.kill('SIGKILL'),5_000);},100_000);
    const code=await new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('close',resolveExit);});clearTimeout(timer);clearTimeout(escalation);
    assert.equal(code,0,stderr);client=JSON.parse(readFileSync(join(dir,'client.json'),'utf8'));
  } finally {
    server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),15_000);
    const exit=await exited;clearTimeout(timer);assert.equal(exit.code,0,'Proxy must close and join its owned SDK process');
  }
  const native=JSON.parse(readFileSync(join(dir,'native-witness.json'),'utf8'));
  const result={label,client,native};report.cases.push(result);
  assert(native.closed && native.children.length===1 && native.children.every(c=>c.closed),'Owned SDK process must close');
  assert(native.models.some(m=>m.where==='native-message-start'),'Need native message-start model evidence');
  assert(native.models.every(m=>m.value===model),'Native model identities differ from exact requested model: '+JSON.stringify(native.models));
  assert(native.textDeltas>0,'Need genuine native text before failure/control');
  assert.equal(client.httpStatus,200);
  assert.equal(client.requests,1,'Actual AgentLink transport must not resend the failed partial turn');
  if(mode==='truncated')assert.equal(native.queries[0]?.outputTokenCap,'1024','Documented enforcement opt-in must reach native CLI');
  if(mode==='fault'){
    assert(native.faultInjected && native.upstreamGenerations===1,'Fault must cut a single actual provider generation after genuine text');
    assert(client.events.some(e=>e.type==='text_delta' && e.text),'Real partial text must reach AgentLink before failure');
    assert(client.wire.includes('"finish_reason":"length"'),'Need actual failure envelope');
  }
  return result;
}
try{
  if(!process.argv.includes('--only-truncated')){
  const healthy=await runCase('candidate-healthy',candidate,'healthy');
  assert.equal(healthy.client.outcome,'completed');assert(!healthy.client.wire.includes('"error":'));
  const before=await runCase('baseline-fault',baseline,'fault');
  assert.equal(before.client.outcome,'completed');assert(!before.client.wire.includes('"error":'));
  const after=await runCase('candidate-fault',candidate,'fault');
  assert.equal(after.client.outcome,'error');assert(after.client.wire.includes('"error":'));
  assert(after.client.error.providerCode && after.client.error.providerType,'Client must retain typed provider error');
  assert(!after.client.events.some(event=>event.type==='model_stop'),'Failed partial turn must not become a successful/truncated stop');
  }
  // The native CLI may recover a provider max_tokens stop internally. Compare
  // both roots and verify genuine provider caps; do not manufacture client
  // truncation or require a stop reason the native CLI did not return.
  for(const [label,root] of [['baseline-output-cap',baseline],['candidate-output-cap',candidate]]){
    const capped=await runCase(label,root,'truncated');
    assert.equal(capped.client.outcome,'completed');assert(!capped.client.wire.includes('"error":'));
    assert(capped.native.providerStops.some(event=>event.stopReason==='max_tokens'),'Need genuine provider output-cap stop');
    assert(capped.native.nativeResults.length===1 && capped.native.nativeResults[0].isError===false,'Native recovery must complete cleanly');
    assert.equal(capped.native.retryRefusals,0,'Owned recovery budget must not cause the result');
    assert(capped.client.events.some(event=>event.type==='model_stop' && ['max_tokens','end_turn'].includes(event.reason)),'Need actual successful terminal stop');
  }
  report.passed=true;
}catch(error){report.failure=String(error);throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,report:join(out,'report.json')}));
