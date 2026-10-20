// Observe real SDK/native/provider metadata without reading private SDK files.
// The relay forwards bytes unchanged to a single fixed HTTPS origin.
import assert from 'node:assert/strict';
import {mock} from 'bun:test';
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export async function installModelObserver(root, output, expectedModel) {
  const require=createRequire(join(root,'package.json'));
  const sdkPath=require.resolve('@anthropic-ai/claude-agent-sdk');
  const sdk=await import(sdkPath), realQuery=sdk.query;
  const witness={scope:'Real provider/native/public-SDK metadata only; synthetic owned E41 sessions',expectedModel,queries:[],children:[],provider:[],native:[],stored:[],generationCount:0,stopped:null,closed:false};
  const save=()=>writeFileSync(output,JSON.stringify(witness,null,2)+'\n',{mode:0o600});
  const observeModel=(where,value)=>{
    if(typeof value==='string' && value!==expectedModel)witness.stopped??=`Unexpected ${where} model: ${value}`;
  };
  const safeEnv=env=>Object.fromEntries(['ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_MODEL','CLAUDE_CODE_MAX_OUTPUT_TOKENS'].filter(key=>typeof env?.[key]==='string').map(key=>[key,env[key]]));
  let relay;
  const createRelay=()=>Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:120,async fetch(request){
    const incoming=new URL(request.url),target=new URL('https://api.anthropic.com');
    target.pathname=incoming.pathname;target.search=incoming.search;
    const generation=request.method==='POST' && incoming.pathname==='/v1/messages';
    if(generation && (witness.stopped || witness.generationCount>=8)){
      witness.stopped??='Eight-generation diagnostic bound reached';save();
      return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned diagnostic stopped before another generation'}},{status:400});
    }
    const headers=new Headers(request.headers);
    for(const name of ['host','connection','content-length','accept-encoding','transfer-encoding'])headers.delete(name);
    const body=['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer();
    let row;
    if(generation){
      const payload=JSON.parse(Buffer.from(body).toString());
      row={generation:++witness.generationCount,query:witness.queries.length,requestModel:payload.model,maxTokens:payload.max_tokens,thinking:payload.thinking?.type,events:[]};
      witness.provider.push(row);observeModel('provider request',payload.model);save();
      if(witness.stopped)return Response.json({type:'error',error:{type:'invalid_request_error',message:'Owned diagnostic model guard'}},{status:400});
    }
    const response=await fetch(target,{method:request.method,headers,body,signal:request.signal,redirect:'error'});
    if(row){row.status=response.status;if(!response.ok){witness.stopped??=`Provider HTTP ${response.status}`;save();}}
    const responseHeaders=new Headers(response.headers);
    for(const name of ['content-length','content-encoding','transfer-encoding','connection'])responseHeaders.delete(name);
    if(!row || !response.body || !response.headers.get('content-type')?.includes('text/event-stream'))return new Response(response.body,{status:response.status,headers:responseHeaders});
    const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    return new Response(new ReadableStream({async start(controller){
      try{
        for(;;){
          const {done,value}=await reader.read();if(done){controller.close();save();return;}
          controller.enqueue(value);pending+=decoder.decode(value,{stream:true}).replaceAll('\r','');
          assert(pending.length<2*1024*1024,'Provider frame observation exceeded bound');
          let end;
          while((end=pending.indexOf('\n\n'))>=0){
            const frame=pending.slice(0,end);pending=pending.slice(end+2);
            const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');
            let event;try{event=JSON.parse(data);}catch{continue; /* non-data frame */}
            if(event.type==='message_start'){
              row.events.push({type:event.type,id:event.message?.id,model:event.message?.model});observeModel('provider response',event.message?.model);
            }
            if(event.type==='message_delta'){row.events.push({type:event.type,stopReason:event.delta?.stop_reason,usage:event.usage});if(event.delta?.stop_reason==='refusal')witness.stopped??='Provider refusal: no retry, fallback or further inference permitted';}
            if(event.type==='error'){row.events.push({type:event.type,errorType:event.error?.type});witness.stopped??='Provider in-band error';}
            save();
          }
        }
      }catch(error){witness.stopped??=error.name;save();controller.error(error);}
    },cancel(reason){return reader.cancel(reason);}}),{status:response.status,headers:responseHeaders});
  }});
  mock.module(sdkPath,()=>({...sdk,query(params){
    assert(!witness.stopped,'Model diagnostic already stopped: '+witness.stopped);
    assert(witness.queries.length<6,'Six-query diagnostic bound reached');
    const original=params.options?.spawnClaudeCodeProcess;
    assert.equal(typeof original,'function','Production SDK process gate must remain active');
    const query=witness.queries.length+1;
    witness.queries.push({query,model:params.options.model,fallbackModel:params.options.fallbackModel??null,env:safeEnv(params.options.env),betas:params.options.betas,settingSources:params.options.settingSources,executable:params.options.pathToClaudeCodeExecutable,resume:params.options.resume??null,forkSession:params.options.forkSession??false});
    relay??=createRelay();
    params.options.env={...params.options.env,ANTHROPIC_BASE_URL:`http://127.0.0.1:${relay.port}`};
    params.options.spawnClaudeCodeProcess=options=>{
      const child=original(options),record={query,pid:child.pid,closed:false,env:safeEnv(options.env)};witness.children.push(record);
      let pending='';
      child.stdout.on('data',bytes=>{
        pending+=Buffer.from(bytes).toString('utf8');assert(pending.length<2*1024*1024,'Native line observation exceeded bound');let end;
        while((end=pending.indexOf('\n'))>=0){
          const line=pending.slice(0,end);pending=pending.slice(end+1);let value;
          try{value=JSON.parse(line);}catch{continue; /* non-JSON native diagnostic */}
          let row;
          if(value.type==='system' && value.subtype==='init')row={type:'init',model:value.model,session:value.session_id};
          if(value.type==='assistant')row={type:'assistant',uuid:value.uuid,id:value.message?.id,model:value.message?.model,stopReason:value.message?.stop_reason,error:value.error??null,blocks:value.message?.content?.map(block=>({type:block.type,...(block.type==='tool_use'?{id:block.id,name:block.name}:{})}))};
          if(value.type==='stream_event' && value.event?.type==='message_start')row={type:'message_start',id:value.event.message?.id,model:value.event.message?.model};
          if(value.type==='result')row={type:'result',subtype:value.subtype,isError:value.is_error,models:Object.keys(value.modelUsage??{}),session:value.session_id};
          if(row){witness.native.push({query,...row});if(row.model)observeModel('native',row.type==='init'?row.model.replace(/\[1m\]$/,''):row.model);if(row.models)for(const model of row.models)observeModel('native result',model.replace(/\[1m\]$/,''));save();}
        }
      });
      child.once('close',(code,signal)=>{Object.assign(record,{closed:true,code,signal});save();});save();return child;
    };
    save();return realQuery(params);
  }}));
  return {
    witness,
    recordStored(source,rows){
      const metadata=rows.filter(row=>row.type==='assistant').map(row=>({uuid:row.uuid,id:row.message?.id,model:row.message?.model,timestamp:row.timestamp,blocks:row.message?.content?.map(block=>({type:block.type,...(block.type==='tool_use'?{id:block.id,name:block.name}:{})}))}));
      witness.stored.push({session:source?.claudeSessionId,rows:metadata});for(const row of metadata)observeModel('stored',row.model);save();
    },
    async close(){await relay?.stop(true);witness.closed=true;save();}
  };
}
