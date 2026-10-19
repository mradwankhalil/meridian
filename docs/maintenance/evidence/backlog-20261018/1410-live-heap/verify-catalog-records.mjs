#!/usr/bin/env node
// Recheck saved real protocol records without rerunning any measurement/model.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=dirname(fileURLToPath(import.meta.url))
const b=JSON.parse(readFileSync(join(root,'baseline-catalogs.json'))),a=JSON.parse(readFileSync(join(root,'current-catalogs.json')))
assert.equal(b.result,'PASS');assert.equal(a.result,'PASS')
assert.equal(b.fixture.sha256,a.fixture.sha256)
assert.equal(b.catalogs.length,4);assert.equal(a.catalogs.length,4)
for(let i=0;i<4;i++)assert.equal(b.catalogs[i].serializedSha256,a.catalogs[i].serializedSha256)
const report={result:'PASS',fixtureSha256:b.fixture.sha256,baselineSource:b.source,currentSource:a.source,
 allFourSerializedCatalogsMatch:true,catalogs:b.catalogs,scope:'Comparison of already saved real SDK MCP wire catalogs; no new calls'}
writeFileSync(join(root,'catalog-comparison.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
