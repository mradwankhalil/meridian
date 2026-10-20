#!/usr/bin/env bun
// Read-only usage guard: supported credential-store API and Meridian usage API.
// No refresh, credential writes, SDK queries or model calls.
import {pathToFileURL} from 'node:url'
import {join} from 'node:path'
const repo=process.env.E2E_MERIDIAN_ROOT
if(!repo || !process.env.E2E_EVIDENCE_DIR)throw Error('Explicit root/output required')
const {createPlatformCredentialStore,readStoredCredentialSnapshot}=await import(pathToFileURL(join(repo,'src/proxy/tokenRefresh.ts')).href)
const {fetchOAuthUsageResult}=await import(pathToFileURL(join(repo,'src/proxy/oauthUsage.ts')).href)
import {writeFileSync} from 'node:fs'
process.env.MERIDIAN_CREDENTIALS_READONLY='1'
const report={result:'RUNNING',scope:'Read-only official usage endpoint; no inference',modelCalls:0,credentialWrites:0,refreshCalls:0,http:[]}
try {
 const store=createPlatformCredentialStore()
 report.credential=await readStoredCredentialSnapshot(store)
 const result=await fetchOAuthUsageResult({store,profileId:'owned-1410-readonly-guard',force:true,refreshImpl:async()=>{report.refreshCalls++;return false},fetchImpl:async(...args)=>{
  const url=String(args[0]);if(url!=='https://api.anthropic.com/api/oauth/usage')throw Error('Unexpected endpoint')
  const response=await fetch(...args);const raw=await response.clone().json().catch(()=>undefined)
  report.http.push({status:response.status,extraUsageEnabled:typeof raw?.extra_usage?.is_enabled==='boolean'?raw.extra_usage.is_enabled:null,fiveHourUtilization:raw?.five_hour?.utilization??null,sevenDayUtilization:raw?.seven_day?.utilization??null})
  return response
 }})
 report.status=result.status??null;report.error=result.error;report.stale=result.snapshot?.stale??false
 report.extraUsageEnabled=report.http.at(-1)?.extraUsageEnabled??null
 report.canInfer=report.credential.presence==='present'&&report.credential.accessTokenExpiresAt>Date.now()&&report.http.length===1&&report.http[0].status===200&&report.extraUsageEnabled===false&&!report.stale&&report.refreshCalls===0
 report.loadReserveAvailable=report.canInfer&&Number.isFinite(report.http[0]?.fiveHourUtilization)&&report.http[0].fiveHourUtilization<75&&Number.isFinite(report.http[0]?.sevenDayUtilization)&&report.http[0].sevenDayUtilization<90
 report.result=report.canInfer?'PASS':'BLOCKED'
} catch(error){report.result='BLOCKED';report.failure=error?.name??'Unknown'}
writeFileSync(join(process.env.E2E_EVIDENCE_DIR,'read-only-usage-guard.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify(report))

