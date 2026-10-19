#!/usr/bin/env node
// Offline production-Node proof. No query(), native Claude, network or credentials.
import assert from 'node:assert/strict'
import {readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join, resolve, dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {getHeapStatistics} from 'node:v8'
import {execFileSync} from 'node:child_process'

const [rootArg, compiledArg, fixtureArg, mode, output, action = 'heap'] = process.argv.slice(2)
const root=resolve(rootArg), compiled=resolve(compiledArg), fixturePath=resolve(fixtureArg)
assert(['baseline','current'].includes(mode))
assert(!process.versions.bun, 'Run measured workers with production Node')
const require=createRequire(join(root,'package.json'))
const module=await import(pathToFileURL(join(compiled,'passthrough.mjs')))
const {LRUMap}=await import(pathToFileURL(join(compiled,'lru.mjs')))
const build=mode==='baseline'?module.createPassthroughMcpServer:module.sharedPassthroughMcpServer
assert.equal(typeof build,'function')
const bytes=readFileSync(fixturePath), parsed=JSON.parse(bytes)
const fixture=Array.isArray(parsed)?parsed:parsed.tools
assert.equal(fixture.length,230)
const core=['bash','read','edit','write','glob','grep','task','todowrite']
const sha=value=>createHash('sha256').update(value).digest('hex')
function packageVersion(name){return JSON.parse(readFileSync(join(dirname(require.resolve(name)),'package.json'),'utf8')).version}
const report={result:'RUNNING',scope:'Real SDK/Zod offline catalog/heap proof; zero model calls',action,mode,
 source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 runtime:{node:process.version,platform:process.platform,arch:process.arch,heapLimitBytes:getHeapStatistics().heap_size_limit},
 versions:{sdk:packageVersion('@anthropic-ai/claude-agent-sdk'),zod:packageVersion('zod')},
 fixture:{sha256:sha(bytes),bytes:bytes.length,tools:fixture.length},modelCalls:0,samples:[],assertions:{}}
const tick=()=>new Promise(resolve=>setImmediate(resolve))
async function settle(rounds=4){for(let i=0;i<rounds;i++){await tick();global.gc();await tick()}}
function sample(label,extra={}){const m=process.memoryUsage();const row={label,heapUsed:m.heapUsed,heapTotal:m.heapTotal,rss:m.rss,external:m.external,...extra};report.samples.push(row);assert(m.heapUsed<480*1024*1024,'Soft retained heap bound 480 MiB exceeded');return row}

async function heap(){
 assert.equal(typeof global.gc,'function','--expose-gc required')
 const capacity=12
 let evictions=0
 const cache=new LRUMap(capacity,()=>evictions++),raw=new LRUMap(capacity)
 const uniqueCount=()=>new Set([...cache.values()].map(v=>v.mcp)).size
 function add(i,tools=structuredClone(fixture),namespace='oc'){
  const mcp=build(tools,core,namespace,true)
  raw.set(`session-${i}`,tools)
  cache.set(`session-${i}`,{key:module.computeToolSetKey(tools),mcp})
 }
 await settle();sample('fixture-loaded')
 for(let i=0;i<capacity;i++){
  add(i)
  if([0,1,3,7,11].includes(i)){await settle();sample(`retained-${i+1}`,{retainedSessions:cache.size,uniqueBuiltSets:uniqueCount(),evictions})}
 }
 assert.equal(uniqueCount(),mode==='current'?1:capacity)
 report.assertions.retainedSharing=true
 // Keep twelve strong session owners while admitting thirty-six more clones.
 for(let batch=0;batch<3;batch++){
  for(let n=0;n<capacity;n++){add(capacity+batch*capacity+n);await tick();if(n%2===1)await settle(1)}
  await settle();sample(`identical-churn-${batch+1}`,{retainedSessions:cache.size,uniqueBuiltSets:uniqueCount(),evictions})
  assert.equal(cache.size,capacity);assert.equal(uniqueCount(),mode==='current'?1:capacity)
 }
 assert.equal(evictions,36);report.assertions.identicalChurnBoundedOwners=true
 // Only weak handles leave this function; no retained array of built sets.
 function release(){const refs=[...new Set([...cache.values()].map(v=>v.mcp))].map(v=>new WeakRef(v));cache.clear();raw.clear();return refs}
 const releasedRefs=release()
 await settle(8)
 sample('all-session-owners-released',{retainedSessions:cache.size,weakTargetsStillObserved:releasedRefs.filter(r=>r.deref()).length})
 await tick()
 // Distinct-content churn cannot share. Bound it separately to four owners.
 let distinctEvictions=0
 const variants=new LRUMap(4,()=>distinctEvictions++)
 for(let batch=0;batch<3;batch++){
  for(let n=0;n<12;n++){
   const id=batch*12+n,tools=structuredClone(fixture)
   tools[0].description=`${tools[0].description??tools[0].name} Owned schema revision ${id}`
   variants.set(`variant-${id}`,{key:module.computeToolSetKey(tools),tools,mcp:build(tools,core,'oc',true)})
   await tick();if(n%2===1)await settle(1)
  }
  await settle();sample(`distinct-churn-${batch+1}`,{retainedSessions:variants.size,uniqueBuiltSets:new Set([...variants.values()].map(v=>v.mcp)).size,evictions:distinctEvictions})
  assert.equal(variants.size,4)
 }
 assert.equal(distinctEvictions,32);variants.clear();await settle(8);sample('distinct-owners-released')
 report.assertions.distinctChurnBoundedOwners=true
 report.limits={retainedSessionCapacity:capacity,totalIdenticalAdmissions:48,distinctCapacity:4,totalDistinctAdmissions:36,
  gc:'Explicit GC across event-loop turns; no assertion depends on immediate WeakRef/finalizer timing',
  notTested:['1000 simultaneously retained baseline sessions','Reporter private 230-tool catalog','Native CLI/model inference','Whole proxy/process session/transcript memory','Global weak-index size or exact finalizer latency']}
}

async function catalogs(){
 const {Client}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')))
 const {InMemoryTransport}=await import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/inMemory.js')))
 const original=JSON.stringify(fixture)
 const first=build(fixture,core,'oc',true),clone=build(structuredClone(fixture),core,'oc',true)
 const variantTools=structuredClone(fixture)
 // A changed description represents an independently built fork catalog.
 variantTools[0].description=`${variantTools[0].description??variantTools[0].name} Owned fork catalog`
 const variant=build(variantTools,core,'oc',true),fresh=module.createPassthroughMcpServer(variantTools,core,'oc',true)
 const servers=[first.createServer(),clone.createServer(),variant.createServer(),fresh.createServer()]
 const clients=[]
 try{
  for(const server of servers){const client=new Client({name:'owned-heap-catalog-control',version:'1'});clients.push(client);const [a,b]=InMemoryTransport.createLinkedPair();await server.instance.connect(b);await client.connect(a)}
  const catalogs=await Promise.all(clients.map(async c=>(await c.listTools()).tools))
  for(const c of catalogs)assert.equal(c.length,230)
  assert.equal(JSON.stringify(catalogs[0]),JSON.stringify(catalogs[1]))
  assert.equal(JSON.stringify(catalogs[2]),JSON.stringify(catalogs[3]))
  assert.notEqual(JSON.stringify(catalogs[0]),JSON.stringify(catalogs[2]))
  assert.equal(new Set(servers.map(s=>s.instance)).size,4)
  assert.notEqual(first,variant)
  assert.equal(first===clone,mode==='current')
  await clients[0].close();await clients[2].close()
  assert.equal(JSON.stringify((await clients[1].listTools()).tools),JSON.stringify(catalogs[1]))
  const read=catalogs[1].find(t=>t.name==='read')
  assert(read,'Client-derived fixture must include actual read schema')
  const call=await clients[1].callTool({name:read.name,arguments:{filePath:'/owned/receipt.txt',offset:0,limit:10}})
  assert(!call.isError,'Real MCP call failed validation')
  assert.equal(JSON.stringify(fixture),original)
  report.assertions={allCatalogs230:true,cloneCatalogMatch:true,forkFreshCatalogMatch:true,forkCatalogIndependent:true,
   independentTransports:true,survivedOtherCloses:true,realMcpCallSucceeded:true,inputImmutable:true,
   cloneDefinitionsReused:first===clone}
  report.catalogs=catalogs.map((c,i)=>({index:i,count:c.length,serializedSha256:sha(JSON.stringify(c))}))
 }finally{for(const c of clients)await c.close();for(const s of servers)await s.instance.close()}
 report.limits={fork:'Independent in-memory SDK MCP catalog; does not establish native session/fork history or E41 cache reuse'}
}
try{if(action==='heap')await heap();else if(action==='catalogs')await catalogs();else assert.fail('Unknown action');report.result='PASS'}
catch(error){report.result='FAIL';report.failure={name:error.name,message:error.message};process.exitCode=1}
finally{writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,action,mode,output,failure:report.failure,maxSampleHeapMiB:Math.max(0,...report.samples.map(s=>s.heapUsed))/1048576}))}
