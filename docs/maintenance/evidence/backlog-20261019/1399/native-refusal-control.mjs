#!/usr/bin/env bun
// Credentialless native control. All refusals below are fixture SSE events,
// never a real provider refusal or an attempt to evade one.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [repoArg,nativeArg,outArg]=process.argv.slice(2);assert(repoArg&&nativeArg&&outArg);
const repo=resolve(repoArg),native=realpathSync(nativeArg),out=resolve(outArg);mkdirSync(out,{recursive:true});
const {observeChildClosure,stopAndJoinChild}=await import(pathToFileURL(join(repo,'scripts/lib/e2eProcessCustody.mjs')).href);
const version=spawnSync(native,['--version'],{encoding:'utf8',timeout:5000});assert.equal(version.status,0);assert.equal(version.stdout.trim(),'2.1.302 (Claude Code)');
const hash=createHash('sha256').update(readFileSync(native)).digest('hex');assert.equal(hash,'5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37');
const report={scope:'Actual pinned native CLI with owned loopback SSE refusal fixtures; no paid model or production-change acceptance',native:{version:version.stdout.trim(),sha256:hash},platform:process.platform,variants:[],passed:false};
try{
  for(const [name,flags] of [['default',{}],['no-model-fallback',{CLAUDE_CODE_NO_MODEL_FALLBACK:'1'}],['no-fallback-or-refusal-retry',{CLAUDE_CODE_NO_MODEL_FALLBACK:'1',CLAUDE_CODE_DISABLE_REFUSAL_RETRY:'1'}]]){
    const root=realpathSync(mkdtempSync(join(tmpdir(),'meridian-native-refusal-control-')));for(const dir of ['home','config','project','cache','data','state'])mkdirSync(join(root,dir));
    const row={name,flags,requests:[],events:[],joined:false};report.variants.push(row);let child,witness;
    const server=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
      const url=new URL(request.url);if(url.pathname.endsWith('/count_tokens'))return Response.json({input_tokens:10});if(!url.pathname.endsWith('/messages'))return Response.json({});
      const body=await request.json();row.requests.push({model:body.model});
      if(row.requests.length>6)return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned fixture request bound'}},{status:400});
      const message={id:'msg_owned_refusal_'+row.requests.length,type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:1}};
      const events=[{type:'message_start',message},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'Owned fixture refusal.'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'refusal',stop_sequence:null},usage:{output_tokens:1}},{type:'message_stop'}];
      return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
    }});
    try{
      const env={PATH:process.env.PATH,HOME:join(root,'home'),USERPROFILE:join(root,'home'),CLAUDE_CONFIG_DIR:join(root,'config'),XDG_CACHE_HOME:join(root,'cache'),XDG_DATA_HOME:join(root,'data'),XDG_STATE_HOME:join(root,'state'),ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.port}`,ANTHROPIC_API_KEY:'owned-loopback-not-a-credential',ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_OAUTH_TOKEN:'',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',DISABLE_TELEMETRY:'1',DISABLE_ERROR_REPORTING:'1',...flags};
      child=spawn(native,['--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','-p','Return the word fixture.','--model','claude-opus-5-5','--tools','','--max-turns','1','--output-format','stream-json','--verbose','--include-partial-messages'],{cwd:join(root,'project'),env,stdio:['ignore','pipe','pipe']});witness=observeChildClosure(child);let pending='',bytes=0;
      child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>512*1024){child.kill('SIGTERM');return;}pending+=chunk.toString();let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);let value;try{value=JSON.parse(line);}catch{continue;}if(value.type==='system')row.events.push({type:value.type,subtype:value.subtype,model:value.model,originalModel:value.originalModel,fallbackModel:value.fallbackModel,direction:value.direction});if(value.type==='assistant')row.events.push({type:value.type,model:value.message?.model,stopReason:value.message?.stop_reason,isApiErrorMessage:value.isApiErrorMessage});if(value.type==='result')row.result={subtype:value.subtype,isError:value.is_error,models:Object.keys(value.modelUsage??{})};}});child.stderr.resume();
      const term=setTimeout(()=>child.kill('SIGTERM'),20_000),kill=setTimeout(()=>child.kill('SIGKILL'),23_000);await witness.joined;clearTimeout(term);clearTimeout(kill);row.exitCode=witness.state.exitCode;row.signal=witness.state.signal;
    }finally{if(child&&witness){row.cleanup=await stopAndJoinChild(child,witness,{graceMs:1000,forceMs:3000});row.joined=row.cleanup.joined;}await server.stop(true);if(row.joined)rmSync(root,{recursive:true,force:true});}
  }
  assert(report.variants.every(row=>row.joined));
  const last=report.variants.at(-1);assert.equal(last.requests.length,1,'Explicit no-fallback/no-refusal-retry must make exactly one fixture request');assert.equal(last.requests[0].model,'claude-opus-5-5');assert.equal(last.result?.isError,true,'Refusal must remain an error');
  report.passed=true;
}catch(error){report.failure=String(error);process.exitCode=1;}
writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,variants:report.variants.map(row=>({name:row.name,requests:row.requests,joined:row.joined,result:row.result})),failure:report.failure}));
