#!/usr/bin/env bun
/** Real SDK/native CLI -> captured model request. Loopback responder, no paid model.
 * Seeds the previous contaminated session, then resumes with the isolated options.
 * Records retained guidance instead of pretending settings changes erase history.
 * No live config is read/written; fixtures and subprocesses are owned by this run.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {pathToFileURL} from 'node:url'
const repo=process.env.E2E_MERIDIAN_ROOT
if(!repo)throw Error('Explicit E2E_MERIDIAN_ROOT required')
const requireSdk=createRequire(join(repo,'package.json'))
const {query}=await import(pathToFileURL(requireSdk.resolve('@anthropic-ai/claude-agent-sdk')).href)
const {buildQueryOptions}=await import(pathToFileURL(join(repo,'src/proxy/query.ts')).href)
const {createPassthroughMcpServer}=await import(pathToFileURL(join(repo,'src/proxy/passthroughTools.ts')).href)
const { OwnedFixtureProcesses, withFixtureEnvironment, within, closeFixtureQuery, consumeFixtureQuery, assertFixtureQueryOutcomes, removeJoinedSandbox } = await import(pathToFileURL(join(repo,'scripts/lib-passthrough-mcp-fixture.mjs')).href)

const arg = name => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3)
const evidence = resolve(arg('evidence-dir') ?? 'local-evidence/toolname-refix')
const baseline = process.argv.includes('--baseline')
const root = await mkdtemp(join(tmpdir(), 'meridian-toolnames-'))
const configHome = join(root, 'config-home')
const cli = resolve(arg('claude-executable') ?? 'node_modules/@anthropic-ai/claude-code/bin/claude.exe')
const inheritedPath = process.env.PATH
const osEnv = Object.fromEntries(['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
const processes = new OwnedFixtureProcesses()
const requests = []
let phase='seed'
const foreign = 'mcp__plugin_context-mode_context-mode__ctx_execute'
const client = 'context-mode_ctx_execute'
const leak = `FOREIGN_SESSIONSTART: Run shell commands with ${foreign}(language, code).`
const report = { scope: 'actual SDK/native CLI model-facing request; loopback model responder, not paid-model/native-OpenCode acceptance', baseline, outcome: 'failed', model: 'claude-opus-5-5', requests, cleanup: null }
let state = { turn: 'isolation', init: null, result: null, error: null, closeError: null, intentionalCancellation: false, settled: false, sdkQuery: null, abortController: new AbortController() }
let server
let listenerClosed = false
let failure

await mkdir(configHome, { recursive: true })
await mkdir(evidence, { recursive: true })
const hook = join(root, 'foreign-hook.cjs')
await writeFile(hook, `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:${JSON.stringify(leak)}}}))`)
const mcp = join(root, 'foreign-mcp.cjs')
await writeFile(mcp, `const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.id===undefined)return;
 const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'foreign',version:'1'}}:
 r.method==='tools/list'?{tools:[{name:'ctx_execute',description:'Foreign proxy-host shell execution',inputSchema:{type:'object',properties:{code:{type:'string'}}}}]}:{};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
});process.stdin.on('end',()=>process.exit(0));`)
await writeFile(join(configHome, 'settings.json'), JSON.stringify({
  enableAllProjectMcpServers: true,
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${hook.replaceAll('\\', '/')}"` }] }] },
}))
await writeFile(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'plugin_context-mode_context-mode': { command: 'node', args: [mcp] } } }))
try {
  await withFixtureEnvironment({ ...osEnv, PATH: inheritedPath, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: configHome,
    XDG_CACHE_HOME: join(root, '.cache'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1',
  }, async () => {
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 120, async fetch(request) {
      if (new URL(request.url).pathname !== '/v1/messages') return Response.json({})
      const body = await request.json()
      const text = JSON.stringify([body.system, body.messages])
      requests.push({ phase, tools: (body.tools ?? []).map(t => t.name), foreignGuidance: text.includes(leak),
        leakedExcerpt: text.includes(leak) ? leak : null, clientContextPresent: text.includes('CLIENT_TOOL_CONTEXT') })
      const message = { id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', model: body.model,
        content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } }
      if (!body.stream) return Response.json(message)
      const events = [
        { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
    } })
    const passthroughMcp = createPassthroughMcpServer([{ name: client, description: 'Run a shell command through context-mode',
      input_schema: { type: 'object', properties: { language: { type: 'string' }, code: { type: 'string' } }, required: ['language', 'code'] } }])
    const options = buildQueryOptions({ prompt: 'Use context-mode to run echo TOOLNAME_REFIX_PROBE_42.', model: report.model,
      workingDirectory: root, systemContext: 'CLIENT_TOOL_CONTEXT: use the client tools.', claudeExecutable: cli,
      passthrough: true, stream: true, sdkAgents: {}, passthroughMcp, hasDeferredTools: false, isUndo: false,
      blockedTools: [], incompatibleTools: [], mcpServerName: 'oc', allowedMcpTools: [],
      settingSources: ['user', 'project'], codeSystemPrompt: false, memory: false, dreaming: false, sharedMemory: false,
      cleanEnv: { ...osEnv, PATH: inheritedPath, HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: configHome,
        XDG_CACHE_HOME: join(root, '.cache'), ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`,
        ANTHROPIC_API_KEY: 'fixture-not-a-credential', ANTHROPIC_AUTH_TOKEN: '', CLAUDE_CODE_OAUTH_TOKEN: '' },
    }, state.abortController)
    if (baseline) { options.options.settingSources = ['user', 'project']; delete options.options.strictMcpConfig }
    options.options.spawnClaudeCodeProcess = spawnOptions => {
      report.spawnCommand = spawnOptions.command
      return processes.spawnClaudeCodeProcess(spawnOptions)
    }
    report.sdkSettingSources = options.options.settingSources
    report.strictMcpConfig = options.options.strictMcpConfig ?? false
    // Seed a genuinely contaminated native session with the previous options.
    const seedOptions={...options,options:{...options.options,settingSources:['user','project']}}
    delete seedOptions.options.strictMcpConfig
    state.sdkQuery=query(seedOptions)
    state.done=consumeFixtureQuery(state)
    assert.equal((await within(state.done,60_000)).completed,true,'Seed query timed out')
    assertFixtureQueryOutcomes([state])
    assert(requests.some(row=>row.foreignGuidance && row.tools.includes(foreign)),'Seed must reproduce both foreign integrations')
    const session=state.init?.session_id
    assert.equal(typeof session,'string','Need actual native session ID for resume')
    report.seed={session,contaminated:true,result:state.result}
    state={turn:'candidate-resume',init:null,result:null,error:null,closeError:null,intentionalCancellation:false,settled:false,sdkQuery:null,abortController:new AbortController()}
    phase='resume'
    options.options.resume=session
    options.options.abortController=state.abortController
    state.sdkQuery = query(options)
    state.done = consumeFixtureQuery(state)
    assert.equal((await within(state.done, 60_000)).completed, true, 'SDK probe timed out')
    assertFixtureQueryOutcomes([state])
    assert.ok(requests.length > 0, 'No actual model-facing request captured')
    const failures = []
    for (const request of requests.filter(row=>row.phase==='resume')) {
      report.resumedForeignGuidance=request.foreignGuidance
      if (request.tools.includes(foreign)) failures.push('foreign MCP declaration reached the model')
      if (request.tools.length !== 1 || request.tools[0] !== `mcp__oc__${client}`) failures.push('model catalog differs from client-owned catalog')
      if (!request.clientContextPresent) failures.push('client context was lost')
    }
    assert.deepEqual(failures, [], 'model-facing isolation regression')
    assert(requests.some(row=>row.phase==='resume'),'Need actual resumed provider request')
    report.outcome = 'probe-complete'
    report.freshSessionRequired=report.resumedForeignGuidance===true
  })
} catch (error) {
  failure = error
  report.error = error.message
} finally {
  state.abortController.abort()
  closeFixtureQuery(state)
  const childrenJoined = await processes.closeAndJoin()
  const iteratorsJoined = !state.done || (await within(state.done, 3000)).completed
  if (server) { await server.stop(true); listenerClosed = true } else listenerClosed = true
  report.cleanup = { childrenJoined, iteratorsJoined, listenerClosed, processes: processes.summary() }
  if (!childrenJoined || !iteratorsJoined || !listenerClosed) { report.outcome = 'failed'; failure ??= new Error('cleanup incomplete') }
  await removeJoinedSandbox(root, report.cleanup)
  report.querySourceSha256 = createHash('sha256').update(await readFile(join(repo,'src/proxy/query.ts'))).digest('hex')
  const require = requireSdk
  report.sdkVersion = JSON.parse(await readFile(join(dirname(require.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8')).version
  report.nativeSha256=createHash('sha256').update(await readFile(cli)).digest('hex')
  const path = join(evidence,'resumed-session.json')
  await writeFile(path, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ outcome: report.outcome, baseline, requests, cleanup: report.cleanup, evidence: path }))
}
if (failure) process.exitCode = 1
