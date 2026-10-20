// Real pinned AgentLink transport -> installed Meridian -> SDK/native -> provider.
// Single legitimate text generation per case; no replay of the refused load task.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
const [rootArg,outArg,grantArg,baselineArg]=process.argv.slice(2);
assert(rootArg&&outArg&&grantArg,'installed package, new output dir, private access-only grant required');
const root=resolve(rootArg),out=resolve(outArg),here=dirname(fileURLToPath(import.meta.url));
assert(!existsSync(out));mkdirSync(out,{recursive:true});
const native=process.env.E2E_NATIVE_BIN||'/tmp/meridian-overnight-20261019/native-pinned/claude-2.1.302';
const clientEntry=process.env.E2E_AGENTLINK_CLIENT||join(here,'agentlink-prepared/agentlink-client.mjs');
const require=createRequire(join(root,'package.json'));
const sdk=JSON.parse(readFileSync(join(dirname(require.resolve('@anthropic-ai/claude-agent-sdk')),'package.json'))).version;
const report={version:JSON.parse(readFileSync(join(root,'package.json'))).version,node:process.version,sdk,native:spawnSync(native,['--version'],{encoding:'utf8'}).stdout.trim(),nativeSha256:createHash('sha256').update(readFileSync(native)).digest('hex'),model:'claude-opus-5-5',client:'AgentLink 1.44.5',clientCommit:'ab98566573e893fc4667971a86573fb56beec677',cases:[],passed:false};
async function run(label,pkg,mode,expected){
 const dir=join(out,label);mkdirSync(dir);const fd=openSync(join(dir,'proxy.log'),'w');
 const server=spawn(process.execPath,[join(here,'installed-host.mjs'),pkg,dir,mode,native,resolve(grantArg)],{stdio:['ignore',fd,fd]});closeSync(fd);
 const done=new Promise((r,j)=>{server.once('error',j);server.once('close',(code,signal)=>r({code,signal}));});
 let client;
 try{
  const until=Date.now()+30000;while(!existsSync(join(dir,'ready.json'))){assert(server.exitCode===null,'Host exited before readiness');assert(Date.now()<until,'Host readiness deadline');await delay(50);}
  const {base}=JSON.parse(readFileSync(join(dir,'ready.json')));
  const result=spawn(process.execPath,[clientEntry,base+'/v1',join(dir,'client.json'),report.model,mode],{stdio:['ignore','pipe','pipe']});let stderr='';result.stderr.on('data',b=>stderr+=b);
  const timer=setTimeout(()=>result.kill('SIGTERM'),100000);const code=await new Promise((r,j)=>{result.once('error',j);result.once('close',r);});clearTimeout(timer);assert.equal(code,0,stderr);client=JSON.parse(readFileSync(join(dir,'client.json')));
 }finally{server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),20000);const exit=await done;clearTimeout(timer);assert.equal(exit.code,0,'Owned host must join cleanly');}
 const host=JSON.parse(readFileSync(join(dir,'host-report.json')));report.cases.push({label,client,host});
 assert(host.closed&&host.children.length>0&&host.children.every(c=>c.closed&&c.stdoutClosed&&c.stderrClosed),'All original children and pipes must close');
 assert(!host.refusal,'Refusal stops the release probe; never retry it');
 assert.equal(host.admitted,1,'Exactly one real provider generation');
 const ids=host.provider.filter(v=>v.model);assert(ids.length>=2&&ids.every(v=>v.model===report.model),'Exact requested provider model');
 const nativeModels=host.native.filter(v=>v.model&&v.model!=='<synthetic>');assert(nativeModels.length>0&&nativeModels.every(v=>v.model===report.model),'Exact native model');
 assert.equal(client.requests,1,'Actual AgentLink must not resend partial turn');assert.equal(client.httpStatus,200);assert.equal(client.outcome,expected);
 if(mode==='fault'){assert(host.faultInjected);assert(client.events.some(v=>v.type==='text_delta'&&v.text));if(expected==='error'){assert(client.error.providerCode&&client.error.providerType);assert(!client.events.some(v=>v.type==='model_stop'));}else assert(!client.wire.includes('"error":'));}
 else assert(!client.wire.includes('"error":'));
}
try{await run('candidate-healthy',root,'healthy','completed');if(baselineArg)await run('published-baseline-fault',resolve(baselineArg),'fault','completed');await run('candidate-fault',root,'fault','error');report.passed=true;}
catch(error){report.failure=String(error);throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,version:report.version,sdk:report.sdk}));
