#!/usr/bin/env node
// Paid actual DSH/Haiku flow. Node run.mjs baseline candidate tooling NEW-output pinned-bun pinned-native exact-model
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,copyFileSync,openSync,closeSync,realpathSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
const [baseArg,candidateArg,toolingArg,outArg,bun,nativeArg,model]=process.argv.slice(2);
assert(baseArg&&candidateArg&&toolingArg&&outArg&&bun&&nativeArg&&model,'Seven explicit paths/model arguments required');
const baseline=resolve(baseArg),candidate=resolve(candidateArg),tooling=resolve(toolingArg),out=resolve(outArg),native=realpathSync(nativeArg);
assert(!existsSync(out),'Retain earlier attempts; output must be new');mkdirSync(out,{recursive:true});
const here=dirname(fileURLToPath(import.meta.url));
const client=join(tooling,'owned-client.mjs');copyFileSync(join(here,'dsh-client.mjs'),client);
const git=(root,...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'}).stdout.trim();
const report={baseline:git(baseline,'rev-parse','HEAD'),candidate:git(candidate,'rev-parse','HEAD'),model,native:{path:native,version:spawnSync(native,['--version'],{encoding:'utf8'}).stdout.trim(),sha256:createHash('sha256').update(readFileSync(native)).digest('hex')},node:process.version,cases:[],passed:false};
async function runCase(label,root,mode){
  const dir=join(out,label);mkdirSync(dir);
  const fd=openSync(join(dir,'proxy.log'),'w');
  const proxy=spawn(bun,[join(here,'../1407/live-proxy.mjs'),root,dir,'observe',native],{cwd:root,stdio:['ignore',fd,fd]});closeSync(fd);
  const exited=new Promise((resolveExit,reject)=>{proxy.once('error',reject);proxy.once('close',(code,signal)=>resolveExit({code,signal}));});
  try{
    const deadline=Date.now()+30_000;
    while(!existsSync(join(dir,'ready.json'))){assert(proxy.exitCode===null,'Proxy exited before ready');assert(Date.now()<deadline,'Proxy readiness deadline');await delay(50);}
    const {port}=JSON.parse(readFileSync(join(dir,'ready.json')));
    const child=spawn(process.execPath,[client,tooling,`http://127.0.0.1:${port}`,join(dir,'client.json'),model,mode],{cwd:tooling,stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',bytes=>stderr+=bytes);
    let escalation;const timer=setTimeout(()=>{child.kill('SIGTERM');escalation=setTimeout(()=>child.kill('SIGKILL'),5000);},120_000);
    const code=await new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('close',resolveExit);});clearTimeout(timer);clearTimeout(escalation);
    assert.equal(code,0,stderr);
  }finally{
    proxy.kill('SIGTERM');const timer=setTimeout(()=>proxy.kill('SIGKILL'),15_000);const exit=await exited;clearTimeout(timer);assert.equal(exit.code,0,'Proxy must join its owned children');
  }
  const nativeWitness=JSON.parse(readFileSync(join(dir,'native-witness.json'))),clientWitness=JSON.parse(readFileSync(join(dir,'client.json')));
  const value={label,native:nativeWitness,client:clientWitness};report.cases.push(value);
  assert(nativeWitness.closed && nativeWitness.children.every(child=>child.closed));
  assert(nativeWitness.models.some(entry=>entry.where==='native-message-start'));
  assert(nativeWitness.models.every(entry=>entry.value===model),'Actual native model differs: '+JSON.stringify(nativeWitness.models));
  return value;
}
const textOf=turn=>turn.message.content.filter(block=>block.type==='text').map(block=>block.text).join('');
try{
  const after=await runCase('candidate-fresh',candidate,'fresh');
  assert.equal(after.client.wireRequests.length,1);assert.deepEqual(after.client.wireRequests[0].body.messages.map(message=>message.role),['user','user','user']);
  assert(textOf(after.client.turns[0]).includes(after.client.nonce));
  assert(after.native.promptSummaries.some(prompt=>prompt.hasAAA&&prompt.hasCCC&&prompt.receiptOffsets.length>0&&prompt.historyClose<0),'All three user messages must be live SDK input');
  const before=await runCase('baseline-fresh',baseline,'fresh');
  assert(before.native.promptSummaries.some(prompt=>prompt.historyClose>=0&&prompt.receiptOffsets.some(offset=>offset<prompt.historyClose)),'Baseline must frame the question as old history');
  report.baselineReceiptSeen=textOf(before.client.turns[0]).includes(before.client.nonce);
  const tools=await runCase('candidate-tools',candidate,'tools');
  assert.equal(tools.client.turns.length,2);assert.equal(tools.client.wireRequests.length,2);
  assert.equal(tools.client.turns[0].finish.kind,'tool-calls');assert.equal(tools.client.turns[1].finish.kind,'stop');
  assert(textOf(tools.client.turns[1]).includes(tools.client.nonce));
  assert(!tools.client.turns[1].message.content.some(block=>block.type==='tool-call'),'Supplied result plus reminder must not cause a repeated tool call');
  assert.equal(tools.native.queries.length,2);assert.equal(tools.native.children.length,2);
  report.passed=true;
}catch(error){report.failure=String(error);throw error;}
finally{writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,report:join(out,'report.json')}));
