#!/usr/bin/env node
// Usage: node run-heap-proof.mjs BASELINE_ROOT CURRENT_ROOT [OUTPUT_DIR]
// Requires frozen installs at both roots and Bun for TypeScript compilation only.
import assert from 'node:assert/strict'
import {mkdirSync,existsSync,symlinkSync,readFileSync,writeFileSync} from 'node:fs'
import {spawnSync,execFileSync} from 'node:child_process'
import {join,resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const here=dirname(fileURLToPath(import.meta.url)),out=resolve(process.argv[4]??here)
const roots={baseline:resolve(process.argv[2]),current:resolve(process.argv[3])}
const expected={baseline:'095b4869b5fe386e2f3a273cc5b60ec3853c8659',current:'423477f19812b08e15d332d4f7c9c91ebf4e8650'}
mkdirSync(out,{recursive:true})
const fixture=join(here,'client-derived-230-tools.json'),receipts=[]
for(const [mode,root]of Object.entries(roots)){
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),expected[mode])
 const compiled=join(out,mode);mkdirSync(compiled,{recursive:true})
 const modules=join(compiled,'node_modules');if(!existsSync(modules))symlinkSync(join(root,'node_modules'),modules,'dir')
 for(const [source,name]of [['src/proxy/passthroughTools.ts','passthrough.mjs'],['src/utils/lruMap.ts','lru.mjs']]){
  const args=['build',join(root,source),'--target=node','--packages=external',`--outfile=${join(compiled,name)}`]
  const r=spawnSync('bun',args,{cwd:root,encoding:'utf8'});writeFileSync(join(compiled,name+'.build.log'),r.stdout+r.stderr);assert.equal(r.status,0,'Offline compilation failed')
 }
 for(const action of ['catalogs','heap']){
  const output=join(out,`${mode}-${action}.json`),args=['--expose-gc','--max-old-space-size=512',join(here,'heap-worker.mjs'),root,compiled,fixture,mode,output,action]
  const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:2*1024*1024})
  writeFileSync(join(out,`${mode}-${action}.log`),r.stdout+r.stderr)
  receipts.push({mode,action,command:[process.execPath,...args],exitCode:r.status,signal:r.signal,error:r.error?.message})
  writeFileSync(join(out,'commands.json'),JSON.stringify(receipts,null,2)+'\n')
  console.log(r.stdout.trim());assert.equal(r.status,0,`${mode} ${action} failed; inspect preserved first failure`)
 }
}
const before=JSON.parse(readFileSync(join(out,'baseline-heap.json'))),after=JSON.parse(readFileSync(join(out,'current-heap.json')))
assert.equal(before.fixture.sha256,after.fixture.sha256)
const baselineCatalogs=JSON.parse(readFileSync(join(out,'baseline-catalogs.json'))),currentCatalogs=JSON.parse(readFileSync(join(out,'current-catalogs.json')))
assert.equal(baselineCatalogs.fixture.sha256,currentCatalogs.fixture.sha256)
for(let i=0;i<baselineCatalogs.catalogs.length;i++)assert.equal(baselineCatalogs.catalogs[i].serializedSha256,currentCatalogs.catalogs[i].serializedSha256,`Catalog ${i} changed across versions`)
writeFileSync(join(out,'catalog-comparison.json'),JSON.stringify({result:'PASS',fixtureSha256:baselineCatalogs.fixture.sha256,
 baselineSource:before.source,currentSource:after.source,allFourSerializedCatalogsMatch:true,
 catalogs:baselineCatalogs.catalogs},null,2)+'\n')
const byLabel=r=>Object.fromEntries(r.samples.map(s=>[s.label,s]))
const b=byLabel(before),a=byLabel(after),labels=Object.keys(b)
const rows=labels.map(label=>({label,baselineHeapMiB:b[label].heapUsed/1048576,currentHeapMiB:a[label].heapUsed/1048576,
 baselineRssMiB:b[label].rss/1048576,currentRssMiB:a[label].rss/1048576,baselineUniqueSets:b[label].uniqueBuiltSets,currentUniqueSets:a[label].uniqueBuiltSets}))
const comparison={result:'PASS',fixture:before.fixture,rows,measuredRetainedSessionCapacity:12,
 sameInput:true,stockNode:process.version,limits:before.limits,
 assertions:{retainedCurrentLower:a['retained-12'].heapUsed<b['retained-12'].heapUsed,
  identicalChurnCurrentLower:a['identical-churn-3'].heapUsed<b['identical-churn-3'].heapUsed}}
assert(comparison.assertions.retainedCurrentLower);assert(comparison.assertions.identicalChurnCurrentLower)
writeFileSync(join(out,'heap-comparison.json'),JSON.stringify(comparison,null,2)+'\n')
console.log(JSON.stringify(comparison,null,2))
