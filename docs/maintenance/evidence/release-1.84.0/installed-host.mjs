// Native Node host for independently installed artifacts. No SDK/model mocks.
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [rootArg,outArg,mode,native,grant]=process.argv.slice(2);
assert(rootArg&&outArg&&['healthy','fault','ui'].includes(mode));
const root=resolve(rootArg),out=resolve(outArg),model='claude-opus-5-5';
mkdirSync(out,{recursive:true});
for(const key of Object.keys(process.env)) if(key.startsWith('MERIDIAN_')||key.startsWith('CLAUDE_PROXY_')||key.startsWith('ANTHROPIC_')||key.startsWith('CLAUDE_CODE_'))delete process.env[key];
for(const dir of ['home','config','sessions','work'])mkdirSync(join(out,dir),{recursive:true,mode:0o700});
Object.assign(process.env,{HOME:join(out,'home'),MERIDIAN_CONFIG_DIR:join(out,'config'),MERIDIAN_SESSION_DIR:join(out,'sessions'),MERIDIAN_WORKDIR:join(out,'work'),MERIDIAN_CREDENTIALS_READONLY:'1',MERIDIAN_PASSTHROUGH:'1',MERIDIAN_SILENT:'1',MERIDIAN_SHUTDOWN_GRACE_MS:'5000',MERIDIAN_OPUS_MODEL:'opus',MERIDIAN_CLAUDE_PATH:native||'/usr/bin/false',MERIDIAN_TELEMETRY_PERSIST:'0',MERIDIAN_NO_UPDATE_CHECK:'1'});
const report={mode,version:JSON.parse(readFileSync(join(root,'package.json'))).version,node:process.version,platform:process.platform,arch:process.arch,provider:[],native:[],children:[],attempts:0,admitted:0,blocked:0,refusal:false,faultInjected:false,closed:false};
let stopped=false;
const relay=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const b of req)chunks.push(b);const payload=Buffer.concat(chunks);
  const url=new URL(req.url,'https://api.anthropic.com');
  assert(url.origin==='https://api.anthropic.com');
  const generation=req.method==='POST'&&url.pathname==='/v1/messages';
  if(generation){
   const body=JSON.parse(payload);report.attempts++;
   if(stopped||report.admitted>=1||body.model!==model){report.blocked++;res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Owned release probe: generation/model boundary reached'}}));return;}
   report.admitted++;report.provider.push({where:'request',model:body.model});
  }
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(v&&!['host','connection','content-length','accept-encoding','transfer-encoding'].includes(k))headers.set(k,Array.isArray(v)?v.join(','):v);
  const response=await fetch(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:payload,redirect:'error',signal:AbortSignal.timeout(90000)});
  const rh={};for(const [k,v] of response.headers)if(!['content-length','content-encoding','transfer-encoding','connection'].includes(k))rh[k]=v;
  res.writeHead(response.status,rh);
  if(!generation||!response.ok||!response.body||!response.headers.get('content-type')?.includes('text/event-stream')){res.end(Buffer.from(await response.arrayBuffer()));return;}
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
  for(;;){const {done,value}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true}).replaceAll('\r','');assert(pending.length<1048576);let end;
   while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');let event;try{event=JSON.parse(data)}catch{continue;}
    if(event.type==='message_start'){report.provider.push({where:'response',model:event.message?.model,id:event.message?.id});if(event.message?.model!==model){stopped=true;throw Error('Unexpected provider model');}}
    if(event.type==='message_delta'&&event.delta?.stop_reason){report.provider.push({where:'stop',reason:event.delta.stop_reason});if(event.delta.stop_reason==='refusal'){report.refusal=true;stopped=true;}}
    res.write(frame+'\n\n');
    if(mode==='fault'&&event.type==='content_block_delta'&&event.delta?.type==='text_delta'&&event.delta.text){report.faultInjected=true;stopped=true;await reader.cancel();await new Promise(r=>setTimeout(r,100));res.destroy();return;}
   }
  }res.end();
 }catch(error){stopped=true;if(!res.headersSent)res.writeHead(400);res.end();report.relayError=error.name;}
});
await new Promise(r=>relay.listen(0,'127.0.0.1',r));
if(mode!=='ui'){
 // Replace this owned Node trampoline in-place with the pinned real native CLI.
 // execve retains the production gate PID/stdio and every native option/auth env.
 const trampoline=join(out,'native-relay.cjs');
 writeFileSync(trampoline,'#!/usr/bin/env node\nprocess.execve('+JSON.stringify(native)+',['+JSON.stringify(native)+',...process.argv.slice(2)],{...process.env,ANTHROPIC_BASE_URL:'+JSON.stringify(`http://127.0.0.1:${relay.address().port}`)+'});\n',{mode:0o700});
 chmodSync(trampoline,0o700);process.env.MERIDIAN_CLAUDE_PATH=trampoline;
 report.redirect='Owned Node execve trampoline; same gate PID/stdio, exact pinned native binary';
}
const originalSpawn=cp.spawn;
cp.spawn=function(...args){
 const child=originalSpawn.apply(this,args),entry={pid:child.pid,closed:false,stdoutClosed:!child.stdout,stderrClosed:!child.stderr};report.children.push(entry);
 child.once('close',(code,signal)=>Object.assign(entry,{closed:true,code,signal}));child.stdout?.once('close',()=>entry.stdoutClosed=true);child.stderr?.once('close',()=>entry.stderrClosed=true);
 let pending='';child.stdout?.on('data',bytes=>{pending+=bytes.toString();if(pending.length>1048576){stopped=true;child.kill('SIGTERM');return;}let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);let v;try{v=JSON.parse(line)}catch{continue;}
  if(v.type==='assistant')report.native.push({type:'assistant',id:v.message?.id,model:v.message?.model,stop:v.message?.stop_reason});
  if(v.type==='stream_event'&&v.event?.type==='message_start')report.native.push({type:'message_start',model:v.event.message?.model,id:v.event.message?.id});
  if(v.type==='result')report.native.push({type:'result',subtype:v.subtype,isError:v.is_error});
 }});return child;
};syncBuiltinESMExports();
const {startProxyServer}=await import(pathToFileURL(join(root,'dist/server.js')));
const profiles=mode==='ui'?[{id:'owned-ui',type:'api',apiKey:'owned-loopback-fixture',baseUrl:`http://127.0.0.1:${relay.address().port}`}]:JSON.parse(readFileSync(grant));
assert(profiles.length===1);
const proxy=await startProxyServer({host:'127.0.0.1',port:0,silent:true,profiles,defaultProfile:profiles[0].id,maxConcurrent:1});
if(!proxy.server.listening)await once(proxy.server,'listening');
const base=`http://127.0.0.1:${proxy.server.address().port}`;
let gateway;
if(mode==='ui'){
 const profiles={profiles:[{id:'c1',label:'Synthetic Claude',type:'claude-max',loggedIn:true,isActive:true},{id:'g1',label:'Synthetic ChatGPT',provider:'chatgpt',type:'chatgpt',seat:'fixture-seat',loggedIn:true,isActive:true}],routing:'active'};
 gateway=createServer(async(req,res)=>{const url=new URL(req.url,base);if(['/', '/profiles'].includes(url.pathname)){const r=await fetch(base+url.pathname);res.writeHead(r.status,{'content-type':'text/html; charset=utf-8'});res.end(await r.text());return;}res.setHeader('content-type','application/json');res.end(JSON.stringify(url.pathname==='/profiles/list'?profiles:url.pathname==='/health'?{status:'healthy',auth:{loggedIn:true},build:{version:report.version}}:url.pathname==='/settings/api/routing'?{routing:'active',order:['c1','g1']}:url.pathname==='/v1/usage/quota/all'?{profiles:[]}:{totalRequests:0,tokenUsage:{},totalDuration:{}}));});
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
}
writeFileSync(join(out,'ready.json'),JSON.stringify({base:gateway?`http://127.0.0.1:${gateway.address().port}`:base,version:report.version}));
let closing=false;
async function close(){if(closing)return;closing=true;await proxy.close();gateway?.closeAllConnections();if(gateway)await new Promise(r=>gateway.close(r));relay.closeAllConnections();await new Promise(r=>relay.close(r));report.closed=true;writeFileSync(join(out,'host-report.json'),JSON.stringify(report,null,2)+'\n');process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
