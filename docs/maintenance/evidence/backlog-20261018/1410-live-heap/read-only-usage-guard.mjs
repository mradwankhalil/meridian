#!/usr/bin/env bun
// Read-only usage guard: supported credential-store API and Meridian usage API.
// No refresh, credential writes, SDK queries or model calls.
import {createPlatformCredentialStore,readStoredCredentialSnapshot} from '/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/src/proxy/tokenRefresh.ts'
import {fetchOAuthUsageResult} from '/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/src/proxy/oauthUsage.ts'
import {writeFileSync} from 'node:fs'
process.env.MERIDIAN_CREDENTIALS_READONLY='1'
const report={result:'RUNNING',scope:'Read-only official usage endpoint; no inference',modelCalls:0,credentialWrites:0,refreshCalls:0,http:[]}
try {
 const store=createPlatformCredentialStore()
 report.credential=await readStoredCredentialSnapshot(store)
 const result=await fetchOAuthUsageResult({store,profileId:'owned-1410-readonly-guard',force:true,refreshImpl:async()=>{report.refreshCalls++;return false},fetchImpl:async(...args)=>{
  const url=String(args[0]);if(url!=='https://api.anthropic.com/api/oauth/usage')throw Error('Unexpected endpoint')
  const response=await fetch(...args);const raw=await response.clone().json().catch(()=>undefined)
  report.http.push({status:response.status,extraUsageEnabled:typeof raw?.extra_usage?.is_enabled==='boolean'?raw.extra_usage.is_enabled:null})
  return response
 }})
 report.status=result.status??null;report.error=result.error;report.stale=result.snapshot?.stale??false
 report.extraUsageEnabled=report.http.at(-1)?.extraUsageEnabled??null
 report.canInfer=report.credential.presence==='present'&&report.credential.accessTokenExpiresAt>Date.now()&&report.http.length===1&&report.http[0].status===200&&report.extraUsageEnabled===false&&!report.stale&&report.refreshCalls===0
 report.result=report.canInfer?'PASS':'BLOCKED'
} catch(error){report.result='BLOCKED';report.failure=error?.name??'Unknown'}
writeFileSync('/tmp/meridian-1410-live-evidence/read-only-usage-guard.json',JSON.stringify(report,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify(report))

