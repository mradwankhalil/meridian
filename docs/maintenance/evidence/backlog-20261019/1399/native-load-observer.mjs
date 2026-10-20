// Real provider/native observation for the owned native-client load harness.
// Metadata is append-only to avoid rewriting an expanding report during load.
import assert from 'node:assert/strict';
import {loadContext} from './load-context.mjs';
import {mock} from 'bun:test';
import {createRequire} from 'node:module';
import {appendFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {admitGeneration,observeProviderStop} from './load-guards.mjs';
export async function installLoadObserver(root,out,expectedModel,maxGenerations){
  const require=createRequire(join(root,'package.json'));
  const sdkPath=require.resolve('@anthropic-ai/claude-agent-sdk'),sdk=await import(sdkPath),realQuery=sdk.query;
  const sdkVersion=JSON.parse(readFileSync(join(dirname(sdkPath),'package.json'),'utf8')).version;assert.equal(sdkVersion,'0.2.141');
  const state={queries:0,generationAttempts:0,generations:0,blockedGenerations:0,children:0,closedChildren:0,models:new Set(),stopped:null,queryTimes:[],queryStarts:new Map(),sessions:[]};
  const log=row=>appendFileSync(join(out,'model-metadata.jsonl'),JSON.stringify({at:Date.now(),...row})+'\n',{mode:0o600});
  const guard=(where,model)=>{
    if(typeof model!=='string')return;
    const identity=['native-init','native-usage'].includes(where)?model.replace(/\[1m\]$/,''):model;
    state.models.add(model);if(identity!==expectedModel)state.stopped??=`Unexpected ${where} model: ${model}`;
  };
  const relay=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:120,async fetch(request){
    const incoming=new URL(request.url),target=new URL('https://api.anthropic.com');target.pathname=incoming.pathname;target.search=incoming.search;
    const generation=request.method==='POST'&&incoming.pathname==='/v1/messages';
    const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
    const headers=new Headers(request.headers);for(const name of ['host','connection','content-length','accept-encoding','transfer-encoding'])headers.delete(name);
    let index;
    if(generation){const payload=JSON.parse(Buffer.from(body).toString());const context1mBeta=(request.headers.get('anthropic-beta')??'').split(',').some(beta=>beta.trim().startsWith('context-1m'));const admission=admitGeneration(state,payload.model,expectedModel,maxGenerations,context1mBeta);state.models.add(payload.model);index=admission.generation;log({where:'provider-request',...admission,model:payload.model,maxTokens:payload.max_tokens,context1mBeta});
      if(!admission.admitted)return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned native load guard stopped further inference'}},{status:400});}
    const response=await fetch(target,{method:request.method,headers,body,signal:request.signal,redirect:'error'});
    if(generation&&!response.ok){state.stopped??=`Provider HTTP ${response.status}`;log({where:'provider-status',generation:index,status:response.status});}
    const responseHeaders=new Headers(response.headers);for(const name of ['content-length','content-encoding','transfer-encoding','connection'])responseHeaders.delete(name);
    if(generation&&response.ok&&response.headers.get('content-type')?.includes('application/json')){const value=await response.clone().json();observeProviderStop(state,value.stop_reason);guard('provider-response',value.model);log({where:'provider-json',generation:index,id:value.id,model:value.model,stopReason:value.stop_reason});}
    if(!generation||!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))return new Response(response.body,{status:response.status,headers:responseHeaders});
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    return new Response(new ReadableStream({async start(controller){
      try{for(;;){const {done,value}=await reader.read();if(done){controller.close();return;}controller.enqueue(value);pending+=decoder.decode(value,{stream:true}).replaceAll('\r','');assert(pending.length<2*1024*1024);let end;
        while((end=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,end);pending=pending.slice(end+2);const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');let event;try{event=JSON.parse(data);}catch{continue; /* non-data frame */}
          if(event.type==='message_start'){guard('provider-response',event.message?.model);log({where:'provider-response',generation:index,id:event.message?.id,model:event.message?.model});}
          if(event.type==='message_delta'){observeProviderStop(state,event.delta?.stop_reason);log({where:'provider-stop',generation:index,stopReason:event.delta?.stop_reason,usage:event.usage});}
          if(event.type==='error'){state.stopped??='Provider in-band error';log({where:'provider-error',generation:index,errorType:event.error?.type});}
        }
      }}catch(error){state.stopped??=`Provider transport ${error.name}`;controller.error(error);}
    },cancel(reason){return reader.cancel(reason);}}),{status:response.status,headers:responseHeaders});
  },error(error){state.stopped??=`Provider relay ${error.name}`;log({where:'relay-error',errorType:error.name});return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned relay stopped further inference'}},{status:400});}});
  mock.module(sdkPath,()=>({...sdk,query(params){
    assert(!state.stopped,'Owned native load stopped: '+state.stopped);
    const original=params.options?.spawnClaudeCodeProcess;assert.equal(typeof original,'function','Production SDK process gate required');
    const query=++state.queries,at=Date.now(),requestId=loadContext.getStore()?.requestId;state.sessions.push({query,sessionId:params.options.sessionId,configDir:params.options.env?.CLAUDE_CONFIG_DIR,projectDir:params.options.cwd});state.queryTimes.push(at);if(requestId&&!state.queryStarts.has(requestId))state.queryStarts.set(requestId,at);log({where:'query',query,requestId,model:params.options.model,fallbackModel:params.options.fallbackModel??null,resume:params.options.resume??null,fork:params.options.forkSession??false});
    params.options.env={...params.options.env,ANTHROPIC_BASE_URL:`http://127.0.0.1:${relay.port}`};
    params.options.spawnClaudeCodeProcess=options=>{
      const child=original(options);state.children++;let pending='';
      child.stdout.on('data',bytes=>{pending+=Buffer.from(bytes).toString('utf8');if(pending.length>=2*1024*1024){state.stopped??='Native metadata observation bound exceeded';pending='';return;}let end;
        while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);let value;try{value=JSON.parse(line);}catch{continue; /* native diagnostic */}
          if(value.type==='system'&&value.subtype==='init'){guard('native-init',value.model);log({where:'native-init',query,model:value.model});}
          if(value.type==='system'&&['model_refusal_fallback','model_refusal_no_fallback'].includes(value.subtype)){state.stopped??='Native refusal/fallback boundary';log({where:'native-refusal',query,subtype:value.subtype,originalModel:value.originalModel,fallbackModel:value.fallbackModel,direction:value.direction});}
          if(value.type==='assistant'){guard('native-assistant',value.message?.model);log({where:'native-assistant',query,id:value.message?.id,uuid:value.uuid,model:value.message?.model,blocks:value.message?.content?.map(block=>({type:block.type,...(block.type==='tool_use'?{id:block.id,name:block.name}:{})}))});}
          if(value.type==='stream_event'&&value.event?.type==='message_start'){guard('native-stream',value.event.message?.model);log({where:'native-stream',query,id:value.event.message?.id,model:value.event.message?.model});}
          if(value.type==='result'){if(value.is_error&&value.subtype!=='error_max_turns')state.stopped??=`Native result ${value.subtype}`;for(const model of Object.keys(value.modelUsage??{}))guard('native-usage',model);log({where:'native-result',query,subtype:value.subtype,isError:value.is_error,models:Object.keys(value.modelUsage??{})});}
        }
      });child.once('close',()=>{state.closedChildren++;log({where:'native-close',query});});return child;
    };return realQuery(params);
  }}));
  return {state,sdk,sdkVersion,async close(){await relay.stop(true);}};
}
