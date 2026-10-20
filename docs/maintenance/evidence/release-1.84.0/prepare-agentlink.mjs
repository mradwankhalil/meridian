#!/usr/bin/env bun
// Builds the real pinned production transport. No server, credential or inference.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const [clientArg,outArg]=process.argv.slice(2);assert(clientArg&&outArg);
const client=resolve(clientArg),out=resolve(outArg),here=dirname(fileURLToPath(import.meta.url));
const git=(...args)=>{const r=spawnSync('git',args,{cwd:client,encoding:'utf8'});assert.equal(r.status,0);return r.stdout.trim();};
assert.equal(git('rev-parse','HEAD'),'ab98566573e893fc4667971a86573fb56beec677');assert.equal(git('status','--porcelain'),'');
assert(!existsSync(out));mkdirSync(out,{recursive:true});
const facade=join(client,'packages/core/src/openAiCompatible/completionFacade.ts');
const entry=join(out,'client.ts');
writeFileSync(entry,readFileSync(join(here,'client-template.ts'),'utf8').replace("'AGENTLINK_COMPLETION_FACADE'",JSON.stringify(facade)));
const build=await Bun.build({entrypoints:[entry],target:'node',format:'esm',outdir:out,naming:'agentlink-client.mjs'});assert(build.success,JSON.stringify(build.logs));
assert.equal(git('status','--porcelain'),'');
writeFileSync(join(out,'preparation.json'),JSON.stringify({client:'AgentLink',version:JSON.parse(readFileSync(join(client,'package.json'))).version,commit:git('rev-parse','HEAD'),compiledSha256:createHash('sha256').update(readFileSync(join(out,'agentlink-client.mjs'))).digest('hex'),bun:Bun.version,modelCalls:0},null,2)+'\n');
