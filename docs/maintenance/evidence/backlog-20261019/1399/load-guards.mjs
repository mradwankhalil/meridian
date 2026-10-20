// Safety controls for the manual evidence harness, independent of any SDK/model.
import {realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';

export function stopLoad(state,reason){state.stopped??=reason;}

export function admitGeneration(state,model,expectedModel,maxGenerations,context1mBeta=false){
  const attempt=++state.generationAttempts;
  if(model!==expectedModel)stopLoad(state,`Unexpected provider-request model: ${model}`);
  if(expectedModel==='claude-opus-5-5'&&context1mBeta)stopLoad(state,'Unexpected 1m beta on explicit 200k load route');
  if(state.generations>=maxGenerations)stopLoad(state,'Explicit provider-generation budget reached');
  if(state.stopped){state.blockedGenerations++;return {attempt,admitted:false};}
  return {attempt,admitted:true,generation:++state.generations};
}

export function observeProviderStop(state,stopReason){
  if(stopReason==='refusal')stopLoad(state,'Provider refusal: no retry, fallback or further inference permitted');
}

// Canonicalize only an already-existing fixture; a matching basename or an
// arbitrary file under the project is insufficient. /tmp aliases are valid,
// while a symlink outside the worker's project remains forbidden.
export function validateOwnedToolCalls(blocks,allowedFiles,project){
  const projectRoot=realpathSync(project),allowed=new Set([...allowedFiles].map(file=>realpathSync(file)));
  for(const block of blocks.filter(value=>value.type==='tool_use')){
    const path=block.input?.file_path;
    let canonical;
    try{if(typeof path==='string')canonical=realpathSync(resolve(path));}catch{canonical=undefined; /* Missing paths are forbidden. */}
    if(block.name!=='Read'||!canonical||!allowed.has(canonical)||!canonical.startsWith(projectRoot+sep)){
      const error=new Error('Refuse any tool or path outside owned fixtures before native execution');
      error.diagnostic={name:typeof block.name==='string'?block.name:null,inputKeys:block.input&&typeof block.input==='object'?Object.keys(block.input).sort():[],pathSha256:typeof path==='string'?createHash('sha256').update(path).digest('hex'):null,existingPath:canonical!==undefined};
      throw error;
    }
  }
}
