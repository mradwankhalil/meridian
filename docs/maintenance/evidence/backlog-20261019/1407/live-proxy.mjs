// Instrument the real SDK's existing spawn hook; never synthesize SDK events.
import { mock } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {createHash} from 'node:crypto';
const [rootArg, outArg, mode, nativeExecutable] = process.argv.slice(2);
if (!rootArg || !outArg || !nativeExecutable || !['healthy','fault','truncated','observe'].includes(mode)) throw new Error('source-root output-root healthy|fault|truncated|observe pinned-native-executable required');
const root = resolve(rootArg), out = resolve(outArg);
mkdirSync(out, {recursive:true});
for (const key of Object.keys(process.env)) {
  if (key.startsWith('MERIDIAN_') || key.startsWith('CLAUDE_PROXY_')) delete process.env[key];
}
Object.assign(process.env, {
  MERIDIAN_CONFIG_DIR:join(out,'config'), MERIDIAN_SESSION_DIR:join(out,'sessions'),
  MERIDIAN_WORKDIR:join(out,'work'), MERIDIAN_CREDENTIALS_READONLY:'1',
  MERIDIAN_PASSTHROUGH:'1', MERIDIAN_SILENT:'1', MERIDIAN_SHUTDOWN_GRACE_MS:'5000',
  MERIDIAN_OPUS_MODEL:'opus',
  MERIDIAN_CLAUDE_PATH:nativeExecutable,
});
for (const key of ['MERIDIAN_CONFIG_DIR','MERIDIAN_SESSION_DIR','MERIDIAN_WORKDIR']) mkdirSync(process.env[key],{recursive:true});
if(mode==='truncated')process.env.MERIDIAN_ENFORCE_MAX_TOKENS='1';
const require = createRequire(join(root,'package.json'));
const sdkPath = require.resolve('@anthropic-ai/claude-agent-sdk');
const sdk = await import(sdkPath);
const realQuery = sdk.query;
const witness = {mode,sourceRoot:root,processGateDisabled:false,queries:[],children:[],models:[],promptSummaries:[],providerRequests:[],providerStops:[],nativeAssistants:[],nativeResults:[],textDeltas:0,upstreamGenerations:0,retryRefusals:0,faultInjected:false,closed:false};
// The native CLI talks through a loopback relay to the fixed real provider.
// Only an actual streaming generation may be cut; tokens/headers are never logged.
const relay=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
  const incoming=new URL(request.url);
  const target=new URL('https://api.anthropic.com');
  target.pathname=incoming.pathname;target.search=incoming.search;
  const generation=request.method==='POST' && incoming.pathname==='/v1/messages';
  const generationLimit=mode==='truncated'?3:1;
  if(generation && witness.upstreamGenerations>=generationLimit){
    witness.retryRefusals++;
    return Response.json({type:'error',error:{type:'invalid_request_error',message:mode==='truncated'?'Owned transport E2E: bounded native output-cap recovery budget exceeded.':'Owned transport E2E: retry refused after the single real generation was interrupted.'}},{status:400});
  }
  if(generation)witness.upstreamGenerations++;
  const headers=new Headers(request.headers);
  for(const name of ['host','connection','content-length','accept-encoding','transfer-encoding'])headers.delete(name);
  const payload=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
  if(generation){const body=JSON.parse(Buffer.from(payload).toString());witness.providerRequests.push({model:body.model,maxTokens:body.max_tokens,thinking:body.thinking?.type});}
  const upstream=await fetch(target,{method:request.method,headers,body:payload,signal:request.signal,redirect:'error'});
  const responseHeaders=new Headers(upstream.headers);
  for(const name of ['content-length','content-encoding','transfer-encoding','connection'])responseHeaders.delete(name);
  if(!generation || !upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.includes('text/event-stream'))return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
  const reader=upstream.body.getReader(),decoder=new TextDecoder();
  let pending='',ended=false;
  return new Response(new ReadableStream({async start(controller){
    try{
      for(;;){
        const {done,value}=await reader.read();
        if(done){ended=true;controller.close();return;}
        controller.enqueue(value);
        pending+=decoder.decode(value,{stream:true}).replaceAll('\r','');
        if(pending.length>1024*1024)throw new Error('Provider SSE observation exceeded bound');
        let end;
        while((end=pending.indexOf('\n\n'))>=0){
          const frame=pending.slice(0,end);pending=pending.slice(end+2);
          const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
          let event;
          try{event=JSON.parse(data);}catch{continue; /* non-data frame */}
          if(event.type==='message_start')model('provider-message-start',event.message?.model);
          if(event.type==='message_delta' && event.delta?.stop_reason)witness.providerStops.push({generation:witness.upstreamGenerations,stopReason:event.delta.stop_reason});
          if(mode==='fault' && event.type==='content_block_delta' && event.delta?.type==='text_delta' && event.delta.text){
            witness.faultInjected=true;
            await reader.cancel('Owned real-stream transport interruption');
            // Let the genuine partial text cross the native SDK boundary first.
            await Bun.sleep(100);
            ended=true;controller.error(new Error('Owned real-stream connection reset'));
            return;
          }
        }
      }
    }catch(error){if(!ended){ended=true;controller.error(error);}}
  },async cancel(){if(!ended){ended=true;await reader.cancel();}}}),{status:upstream.status,headers:responseHeaders});
}});
const model = (where,value) => { if(typeof value==='string') witness.models.push({where,value}); };
mock.module(sdkPath, () => ({...sdk, query(params) {
  const originalSpawn = params.options?.spawnClaudeCodeProcess;
  if (typeof originalSpawn !== 'function') throw new Error('Real production SDK process gate missing');
  if(mode!=='observe')params.options.env={...params.options.env,ANTHROPIC_BASE_URL:`http://127.0.0.1:${relay.port}`};
  if(mode==='observe'){
    const summarize=text=>witness.promptSummaries.push({chars:text.length,sha256:createHash('sha256').update(text).digest('hex'),historyClose:text.lastIndexOf('</conversation_history>'),receiptOffsets:[...text.matchAll(/receipt_[a-f0-9]{32}/g)].map(match=>match.index),hasAAA:text.includes('AAA'),hasCCC:text.includes('CCC')});
    const originalPrompt=params.prompt;
    if(typeof originalPrompt==='string')summarize(originalPrompt);
    else params.prompt=(async function*(){for await(const message of originalPrompt){summarize(JSON.stringify(message.message?.content??message));yield message;}})();
  }
  witness.queries.push({model:params.options.model,executable:params.options.pathToClaudeCodeExecutable,outputTokenCap:params.options.env?.CLAUDE_CODE_MAX_OUTPUT_TOKENS,partial:params.options.includePartialMessages,settingSources:params.options.settingSources,spawnGate:true});
  params.options.spawnClaudeCodeProcess = (options) => {
    const child = originalSpawn(options);
    const entry = {command:options.command,pid:child.pid,closed:false};
    witness.children.push(entry);
    let pending = '';
    child.stdout.on('data', bytes => {
      pending += Buffer.from(bytes).toString('utf8');
      if (pending.length > 1024*1024) throw new Error('Native observation line exceeded bound');
      let end;
      while ((end=pending.indexOf('\n')) >= 0) {
        const line=pending.slice(0,end); pending=pending.slice(end+1);
        let value;
        try { value=JSON.parse(line); } catch { continue; /* native non-JSON diagnostic, not a model event */ }
        if(value.type==='system' && value.subtype==='init') model('native-init',value.model);
        if(value.type==='assistant'){witness.nativeAssistants.push({id:value.message?.id,uuid:value.uuid,model:value.message?.model,stopReason:value.message?.stop_reason});}
        if(value.type==='result'){witness.nativeResults.push({subtype:value.subtype,isError:value.is_error});for(const name of Object.keys(value.modelUsage??{})) model('native-result-usage',name);}
        const event=value.type==='stream_event'?value.event:undefined;
        if(event?.type==='message_start') model('native-message-start',event.message?.model);
        if(event?.type==='content_block_delta' && event.delta?.type==='text_delta' && event.delta.text) {
          witness.textDeltas++;
        }
      }
    });
    child.once('close',(code,signal)=>{entry.closed=true;entry.code=code;entry.signal=signal;});
    return child;
  };
  // The real Query, native parser, network, model and errors remain untouched.
  return realQuery(params);
}}));
const {startProxyServer}=await import(join(root,'src/proxy/server.ts'));
const instance=await startProxyServer({host:'127.0.0.1',port:0,silent:true,maxConcurrent:1});
const port=instance.server.address().port;
writeFileSync(join(out,'ready.json'),JSON.stringify({port}));
let stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  try { await instance.close();await relay.stop(true);witness.closed=true; }
  finally {writeFileSync(join(out,'native-witness.json'),JSON.stringify(witness,null,2)+'\n');}
}
process.once('SIGTERM',()=>{void stop().then(()=>process.exit(0),error=>{console.error(String(error));process.exit(1);});});
process.once('SIGINT',()=>{void stop().then(()=>process.exit(0),error=>{console.error(String(error));process.exit(1);});});
