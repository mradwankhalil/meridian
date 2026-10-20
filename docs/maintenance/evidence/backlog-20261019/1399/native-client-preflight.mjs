#!/usr/bin/env bun
// Credentialless actual Claude Code transport/tool/resume qualification.
// Fixture provider only; no real model or owner configuration is accessed.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [repoArg,nativeArg,outArg]=process.argv.slice(2);
assert(repoArg&&nativeArg&&outArg,'source root, native executable and owned output required');
const repo=resolve(repoArg),native=realpathSync(nativeArg),out=resolve(outArg);
mkdirSync(out,{recursive:true});
const {observeChildClosure,stopAndJoinChild}=await import(pathToFileURL(join(repo,'scripts/lib/e2eProcessCustody.mjs')).href);
const root=realpathSync(mkdtempSync(join(tmpdir(),'meridian-gc-native-client-')));
for(const name of ['home','config','project','cache','data','state'])mkdirSync(join(root,name));
const version=spawnSync(native,['--version'],{encoding:'utf8'});assert.equal(version.status,0);assert.equal(version.stdout.trim(),'2.1.302 (Claude Code)');
const model=process.env.E2E_PREFLIGHT_MODEL??'claude-haiku-5-5';assert(['claude-haiku-5-5','claude-opus-5-5'].includes(model));
const receipt='owned_gc_'+randomUUID(),file=join(root,'project','receipt.txt');writeFileSync(file,receipt);
const report={scope:'Actual native client against owned fixture provider; no paid model or Meridian acceptance',native:{version:version.stdout.trim(),sha256:createHash('sha256').update(readFileSync(native)).digest('hex')},platform:process.platform,arch:process.arch,bun:Bun.version,requests:[],children:[],passed:false};
const actors=[];
const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const url=new URL(request.url);
  if(url.pathname.endsWith('/count_tokens'))return Response.json({input_tokens:4000});
  if(!url.pathname.endsWith('/messages'))return Response.json({});
  assert.equal(request.method,'POST');assert(report.requests.length<4,'Bound native client requests');
  const body=await request.json();
  const blocks=body.messages.flatMap(message=>Array.isArray(message.content)?message.content:[]);
  const hasResult=blocks.some(block=>block.type==='tool_result');
  report.requests.push({model:body.model,thinking:body.thinking??null,outputConfig:body.output_config??null,roles:body.messages.map(message=>message.role),tools:body.tools?.map(tool=>tool.name),toolResults:blocks.filter(block=>block.type==='tool_result').map(block=>({id:block.tool_use_id,hasReceipt:JSON.stringify(block.content).includes(receipt)})),userAgent:request.headers.get('user-agent'),metadataKeys:Object.keys(body.metadata??{})});
  const content=hasResult?[{type:'text',text:receipt}]:[{type:'tool_use',id:'toolu_owned_gc_preflight',name:'Read',input:{file_path:file}}];
  const stop=hasResult?'end_turn':'tool_use';
  const message={id:'msg_owned_'+report.requests.length,type:'message',role:'assistant',model:body.model,content,stop_reason:stop,stop_sequence:null,usage:{input_tokens:4000,output_tokens:100}};
  if(!body.stream)return Response.json(message);
  const events=[{type:'message_start',message:{...message,content:[],stop_reason:null}}];
  for(const [index,block] of content.entries()){
    events.push({type:'content_block_start',index,content_block:block.type==='text'?{type:'text',text:''}:{...block,input:{}}});
    events.push({type:'content_block_delta',index,delta:block.type==='text'?{type:'text_delta',text:block.text}:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
    events.push({type:'content_block_stop',index});
  }
  events.push({type:'message_delta',delta:{stop_reason:stop,stop_sequence:null},usage:{output_tokens:100}},{type:'message_stop'});
  return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}});
const env={PATH:process.env.PATH,HOME:join(root,'home'),USERPROFILE:join(root,'home'),CLAUDE_CONFIG_DIR:join(root,'config'),XDG_CACHE_HOME:join(root,'cache'),XDG_DATA_HOME:join(root,'data'),XDG_STATE_HOME:join(root,'state'),ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.port}`,ANTHROPIC_API_KEY:'owned-loopback-not-a-credential',ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN:'',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_FORCE_MID_CONVERSATION_SYSTEM:'1',DISABLE_AUTOUPDATER:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1'};
async function run(prompt,resume){
  const args=['--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',...(resume?['--resume',resume]:[]),'-p',prompt,'--model',model,'--tools','Read','--allowedTools','Read','--max-turns','3','--output-format','json'];
  const child=spawn(native,args,{cwd:join(root,'project'),env,stdio:['ignore','pipe','pipe']});
  const witness=observeChildClosure(child);actors.push({child,witness});
  let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;assert(stdout.length<256*1024);});child.stderr.on('data',chunk=>{stderr+=chunk;assert(stderr.length<256*1024);});
  const timer=setTimeout(()=>child.kill('SIGTERM'),30_000),escalation=setTimeout(()=>child.kill('SIGKILL'),35_000);
  await witness.joined;clearTimeout(timer);clearTimeout(escalation);
  assert.equal(witness.state.exitCode,0,stderr);const value=JSON.parse(stdout);assert(value.result.includes(receipt),'Real client must execute Read and retain its receipt');return value;
}
try{
  const first=await run(`Read ${file} exactly once and return its content.`);
  assert.equal(report.requests.length,2,'One real read must take two client requests');
  assert(report.requests[1].toolResults.some(row=>row.hasReceipt),'Actual client must return the file receipt');
  const second=await run('Repeat the receipt just read. Do not call tools.',first.session_id);
  assert.equal(second.session_id,first.session_id);assert.equal(report.requests.length,3,'Resume must take one ordinary follow-up request');
  assert(report.requests.every(row=>row.model===model));
  assert(report.requests.some(row=>row.roles.at(-1)==='system'),'Require actual trailing-system client shape');
  report.passed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{
  for(const {child,witness} of actors)report.children.push(await stopAndJoinChild(child,witness,{graceMs:1000,forceMs:3000}));
  await server.stop(true);report.joined=report.children.every(child=>child.joined);if(!report.joined){report.passed=false;process.exitCode=1;}
  writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({passed:report.passed,joined:report.joined,requests:report.requests.length,report:join(out,'report.json')}));
