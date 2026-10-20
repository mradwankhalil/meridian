// Controller replaces only this import with the pinned, untouched AgentLink source.
import {streamOpenAiCompatibleCompletion} from 'AGENTLINK_COMPLETION_FACADE';
import {writeFileSync} from 'node:fs';
const [baseUrl,output,model,mode]=process.argv.slice(2);
const events:unknown[]=[];
let wire='',wireDone:Promise<void>|undefined;
const result:Record<string,unknown>={node:process.version,model,mode,events,requests:0};
const profile={providerId:'openai-compatible:meridian-proof',baseUrl,profile:'generic' as const,reasoningEffortMode:'none' as const,timeoutMs:90_000,authRequired:false,models:{proof:{id:'proof',model,capabilities:{supportsThinking:false,supportsCaching:true,supportsImages:false,supportsToolUse:true,contextWindow:200_000,maxOutputTokens:2048}}}};
try {
  for await(const event of streamOpenAiCompatibleCompletion({profile,request:{model:'proof',systemPrompt:'This is an isolated transport verification. Do not use tools.',messages:[{role:'user',content:mode==='healthy'?'Reply with exactly MERIDIAN_AGENTLINK_STREAM_OK.':mode==='truncated'?'Count from 1 to 10000, with one integer per line and no other text.':'Count from 1 to 100, with one integer per line and no other text.'}],maxTokens:mode==='truncated'?1024:512},fetch:async(input,init)=>{
    result.requests=Number(result.requests)+1;
    const response=await fetch(input,init);
    result.httpStatus=response.status;
    wireDone=response.clone().text().then(text=>{if(text.length>128*1024)throw new Error('Wire capture bound exceeded');wire=text;});
    return response;
  }})) events.push(event);
  result.outcome='completed';
} catch(error) {
  const value=error as Error & {providerCode?:string;providerType?:string;status?:number};
  result.outcome='error';result.error={name:value.name,message:value.message,providerCode:value.providerCode,providerType:value.providerType,status:value.status};
}
await wireDone;
result.wire=wire;
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
