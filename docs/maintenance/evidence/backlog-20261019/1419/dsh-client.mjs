// Actual published DeepSeek Harness adapter, serializer, parser and assembler.
// Run an exact copy from the owned tooling directory for standard ESM resolution.
import {PiAiAdapter} from '@deepseek-ai/dsh-llm-pi-ai';
import {InMemoryCredentialStore,defaultProviderAuthContext} from '@earendil-works/pi-ai';
import {anthropicMessagesApi} from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import {BlockAssembler} from '@deepseek-ai/dsh-llm';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const [tooling,baseUrl,output,modelId,mode]=process.argv.slice(2);
if(!tooling||!baseUrl||!output||!modelId||!['fresh','tools'].includes(mode))throw new Error('tooling-root base-url output model fresh|tools required');
const version=name=>JSON.parse(readFileSync(join(tooling,'node_modules',name,'package.json'),'utf8')).version;
const provider='meridian-owned-dsh-proof';
const protocol=anthropicMessagesApi();
const model={id:modelId,name:modelId,provider,baseUrl,api:'anthropic-messages',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:200_000,maxTokens:1024};
const piProvider={id:provider,name:provider,baseUrl,auth:{apiKey:{name:'owned loopback fixture',resolve:async()=>({auth:{apiKey:'fixture'},source:'owned fixture'})}},getModels:()=>[model],stream:(...args)=>protocol.stream(...args),streamSimple:(...args)=>protocol.streamSimple(...args)};
const session=randomUUID();
const profile={provider,displayName:provider,api:'anthropic-messages',baseURL:baseUrl,piProvider,modelErrors:new Map(),configuredMaxTokens:new Map(),headers:{'x-session-affinity':session},streamIdleTimeoutMs:90_000,maxRequestImageBytes:20*1024*1024,requestImagePixelBudget:4*1024*1024,requestImageMaxBytes:1024*1024,retryPolicy:{mode:'none',maxRetries:0}};
const profiles=new Map([[provider,profile]]);
const adapter=new PiAiAdapter({profiles:()=>profiles,resolveApiKey:async()=> 'fixture',auth:{credentials:new InMemoryCredentialStore(),authContext:defaultProviderAuthContext()}});
const report={client:'@deepseek-ai/dsh-llm-pi-ai',version:version('@deepseek-ai/dsh-llm-pi-ai'),piAi:version('@earendil-works/pi-ai'),node:process.version,model:modelId,mode,session,turns:[],wireRequests:[]};
if(process.argv.includes('--prepare-only')){report.resolved=await adapter.resolveModel(provider,modelId);writeFileSync(output,JSON.stringify(report,null,2)+'\n');process.exit(0);}
const fetchReal=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const request=new Request(input,init);
  if(new URL(request.url).origin!==new URL(baseUrl).origin)throw new Error('DSH request escaped the owned proxy origin');
  const text=await request.clone().text();
  report.wireRequests.push({path:new URL(request.url).pathname,sessionAffinity:request.headers.get('x-session-affinity'),body:JSON.parse(text)});
  return fetchReal(input,init);
};
const user=text=>({id:randomUUID(),role:'user',content:[{type:'text',text}],source:{kind:'user'}});
async function generate(messages,tools){
  const chunks=[],assembler=new BlockAssembler();
  for await(const chunk of adapter.stream({provider,model:modelId,messages,tools,maxTokens:1024,sessionId:session,signal:AbortSignal.timeout(90_000)})){chunks.push(chunk);assembler.push(chunk);}
  const message=assembler.message({provider,model:modelId});
  const result={chunks,message,finish:assembler.finish};report.turns.push(result);return result;
}
try{
  if(mode==='fresh'){
    const nonce='receipt_'+randomUUID().replaceAll('-','');report.nonce=nonce;
    await generate([user('Background marker: AAA.'),user('Reply with exactly '+nonce+'.'),user('Runtime context marker: CCC; time 14:31.')]);
  }else{
    const nonce='receipt_'+randomUUID().replaceAll('-','');report.nonce=nonce;
    const tools=[{name:'lookup_receipt',description:'Look up the secret receipt for the current request. The receipt cannot be guessed.',parameters:{type:'object',properties:{},additionalProperties:false}}];
    const initial=[user('Use lookup_receipt exactly once, then return its receipt verbatim. Do not guess the receipt.')];
    const first=await generate(initial,tools);
    const call=first.message.content.find(block=>block.type==='tool-call');
    if(!call)throw new Error('Actual model did not return the required lookup tool');
    const result={id:randomUUID(),role:'tool',toolCallId:call.id,content:[{type:'text',text:nonce}],source:{kind:'tool',callId:call.id}};
    await generate([...initial,first.message,result,user('<system-reminder>Be concise. Return the receipt already supplied; do not repeat the tool.</system-reminder>')],tools);
  }
}catch(error){report.error=String(error);throw error;}
finally{writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
