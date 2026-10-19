#!/usr/bin/env node
// Assemble a regular-file-only sanitized handoff; never copy runtime deps/secrets/raw client output.
import assert from 'node:assert/strict'
import {readdirSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from 'node:fs'
import {join,dirname,relative,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=dirname(fileURLToPath(import.meta.url)),destination=resolve(process.argv[2]??'/tmp/meridian-1410-live-evidence-escrow')
assert(!existsSync(destination),'Choose a fresh escrow destination')
mkdirSync(destination,{mode:0o755})
const files=[],excluded=[]
function visit(directory){for(const entry of readdirSync(directory,{withFileTypes:true})){
 const source=join(directory,entry.name),name=relative(root,source)
 if(entry.isSymbolicLink()){excluded.push({path:name,reason:'symbolic link'});continue}
 if(entry.isDirectory()){
  if(['node_modules','baseline','current'].includes(entry.name)){excluded.push({path:name,reason:'generated compile/runtime directory'});continue}
  visit(source);continue
 }
 if(!/\.(json|mjs|md|log|txt|ts)$/.test(name)||/\.(stdout|stderr)$/.test(name)||/(?:^|\/)(?:grant|profiles|credentials|opencode-turn)\.(?:json|key)$/.test(name)){
  excluded.push({path:name,reason:'raw output or non-escrow file'});continue
 }
 const bytes=readFileSync(source),text=bytes.toString('utf8')
 assert(!/sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{40,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY/.test(text),`Potential secret in ${name}`)
 const target=join(destination,name);mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target)
 files.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
}}
visit(root)
const result='/tmp/meridian-1410-live-result.md',bytes=readFileSync(result)
copyFileSync(result,join(destination,'RESULT.md'))
files.push({path:'RESULT.md',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
writeFileSync(join(destination,'escrow-manifest.json'),JSON.stringify({source:root,destination,scope:'Temporary sanitized transfer for separate maintainer evidence PR; not durable publication',files,excluded},null,2)+'\n')
console.log(JSON.stringify({destination,regularFiles:files.length,bytes:files.reduce((sum,file)=>sum+file.bytes,0),excludedEntries:excluded.length}))
