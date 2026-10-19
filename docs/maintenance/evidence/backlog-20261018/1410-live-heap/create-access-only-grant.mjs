#!/usr/bin/env bun
// Supported credential-store read only. Never refreshes or writes owner credentials.
// Run the read-only usage guard immediately before this helper.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL,'1','Explicit live opt-in required')
process.env.MERIDIAN_CREDENTIALS_READONLY='1'
const repo=resolve(process.env.E2E_MERIDIAN_ROOT??'/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe')
const evidence=resolve(process.env.E2E_EVIDENCE_DIR??'/tmp/meridian-1410-live-evidence')
const privateRoot=resolve(process.env.E2E_PRIVATE_DIR??'/tmp/meridian-1410-private-live')
const guardPath=join(evidence,'read-only-usage-guard.json')
const guard=JSON.parse(readFileSync(guardPath,'utf8'))
assert(guard.canInfer&&guard.extraUsageEnabled===false&&guard.refreshCalls===0,'Read-only usage guard must establish disabled paid extra usage')
assert(Date.now()-statSync(guardPath).mtimeMs<300000,'Re-run usage guard; require a result from the last five minutes')
const {createPlatformCredentialStore}=await import(pathToFileURL(join(repo,'src/proxy/tokenRefresh.ts')).href)
const credentials=await createPlatformCredentialStore().read()
assert(credentials?.claudeAiOauth?.accessToken&&credentials.claudeAiOauth.expiresAt>Date.now(),'No current access token; no refresh attempted')
mkdirSync(privateRoot,{recursive:true,mode:0o700})
assert.equal(statSync(privateRoot).mode&0o077,0,'Private directory must have mode0700')
const path=join(privateRoot,'grant.json')
writeFileSync(path,JSON.stringify([{id:'owned-1410',name:'Owned 1410 verification',type:'oauth-token',oauthToken:credentials.claudeAiOauth.accessToken}]),{mode:0o600,flag:'wx'})
assert.equal(statSync(path).mode&0o077,0)
console.log('Private access-only grant created; no token value or refresh token emitted')

