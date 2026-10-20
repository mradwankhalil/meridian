// Offline regression controls: no model, credential store or SDK is accessed.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {admitGeneration,observeProviderStop,validateOwnedToolCalls} from './load-guards.mjs';
const model='claude-opus-5-5';
const fresh=()=>({generationAttempts:0,generations:0,blockedGenerations:0,stopped:null});
const state=fresh();
assert(admitGeneration(state,model,model,10).admitted);
observeProviderStop(state,'refusal');
assert(!admitGeneration(state,model,model,10).admitted,'Same-model retry must stop after HTTP-200 refusal');
assert(!admitGeneration(state,'claude-opus-4-8',model,10).admitted,'Fallback must also stop');
assert.deepEqual([state.generationAttempts,state.generations,state.blockedGenerations],[3,1,2]);
assert.match(state.stopped,/Provider refusal/,'Preserve the initiating failure');
const wrong=fresh();assert(!admitGeneration(wrong,'claude-opus-4-8',model,10).admitted);assert.equal(wrong.generations,0);
const budget=fresh();assert(admitGeneration(budget,model,model,1).admitted);assert(!admitGeneration(budget,model,model,1).admitted);
const context=fresh();assert(!admitGeneration(context,model,model,10,true).admitted);
const healthy=fresh();for(const stop of ['tool_use','end_turn','max_tokens'])observeProviderStop(healthy,stop);assert(admitGeneration(healthy,model,model,10).admitted);
const root=mkdtempSync(join(tmpdir(),'meridian-owned-tool-control-'));
try{
  const project=join(root,'project');mkdirSync(project);const owned=join(project,'owned.txt'),other=join(project,'unlisted.txt'),outside=join(root,'outside.txt');
  for(const file of [owned,other,outside])writeFileSync(file,'synthetic');
  const alias=join(project,'owned-alias');symlinkSync(owned,alias);const escape=join(project,'escape');symlinkSync(outside,escape);
  const read=file_path=>[{type:'tool_use',name:'Read',input:{file_path}}];
  validateOwnedToolCalls(read(owned),new Set([owned]),project);validateOwnedToolCalls(read(alias),new Set([owned]),project);
  for(const path of [other,outside,escape,join(project,'missing')])assert.throws(()=>validateOwnedToolCalls(read(path),new Set([owned]),project));
  assert.throws(()=>validateOwnedToolCalls([{type:'tool_use',name:'Bash',input:{command:'never run'}}],new Set([owned]),project));
  try{validateOwnedToolCalls(read(outside),new Set([owned]),project);}catch(error){assert.equal(error.diagnostic.pathSha256.length,64);assert(!JSON.stringify(error.diagnostic).includes(root));}
}finally{rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify({passed:true,scope:'Offline refusal latch, exact-model/budget/context controls and canonical owned-tool whitelist; no actual model proof'}));
