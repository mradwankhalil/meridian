#!/usr/bin/env bun
/**
 * Multi-turn passthrough conversation through the REAL proxy.
 *
 * This drives Meridian in the same HTTP shape as OpenCode: send a request with
 * tools, execute the returned calls, replay the history plus tool_results, and
 * continue until the model answers.
 *
 * The gate asserts behavior, cache continuity, exact tool-call batching, and
 * the active fork's supported SDK message history. It never reads or mutates
 * Claude's private transcript files.
 *
 * Requires installed client and server plugins before access-only grant loading.
 */
import assert from "node:assert/strict"
import {randomBytes, createHmac} from "node:crypto"
import * as cp from "node:child_process"
import { spyOn } from "bun:test"
import { mkdirSync } from "node:fs"
import { observeChildClosure, stopAndJoinChild } from "file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/scripts/lib/e2eProcessCustody.mjs"
import { resolveOpenCodeScrub, configureOpenCodeScrub, verifyOpenCodeScrub } from "file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/scripts/lib-opencode-scrub-preflight.mjs"
import { resolveOpenCodeClient, loadOpenCodeClient } from "file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/scripts/lib-opencode-client-preflight.mjs"
assert.equal(process.env.E2E_ALLOW_LIVE_MODEL, "1", "Explicit live opt-in required")
assert(process.env.E2E_LIVE_PROFILE_FILE, "Explicit access-only grant required")
assert(!process.env.PROBE_ADAPTER || process.env.PROBE_ADAPTER === "opencode", "This qualified E41 gate is the OpenCode protocol fixture")
const scrub = resolveOpenCodeScrub(process.env.E2E_PLUGIN_PATH, process.env.E2E_SCRUB_VERSION)
const clientInstallation = resolveOpenCodeClient(process.env.E2E_CLIENT_PLUGIN_PATH, process.env.E2E_CLIENT_VERSION)
const actors = [], spies = []
for (const name of ["spawn", "execFile"]) {
  const original = cp[name]
  spies.push(spyOn(cp, name).mockImplementation((...args) => {
    const child = Reflect.apply(original, cp, args)
    actors.push({child, witness:observeChildClosure(child)})
    return child
  }))
}

import { mkdtempSync, realpathSync, writeFileSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getSessionMessages } from "file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/node_modules/%40anthropic-ai/claude-agent-sdk/sdk.mjs"
import { isForwardedDenial } from "file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/src/proxy/passthroughDenial.ts"
import { readSessionStoreSnapshot, setSessionStoreDir } from "file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/src/proxy/sessionStore.ts"
import { parseAssistantResponse, replayAssistantBlocks } from "file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/scripts/lib/e41-assistant-response.ts"

const routingKeys = Object.keys(process.env).filter(key=>/^(MERIDIAN_|CLAUDE_PROXY_|ANTHROPIC_|CLAUDE_)/.test(key))
for(const key of routingKeys) if(!["MERIDIAN_CLAUDE_PATH","MERIDIAN_CREDENTIALS_READONLY","MERIDIAN_NO_UPDATE_CHECK"].includes(key)) delete process.env[key]
// Tested chain arm inherited only MERIDIAN_API_KEY (removed before import)
// and CLAUDE_AGENT_SDK_VERSION (SDK overwrites its own version, no routing).
process.env.MERIDIAN_PASSTHROUGH = "1"
process.env.OPENCODE_CLAUDE_PROVIDER_DEBUG = "1"
process.env.MERIDIAN_TELEMETRY_PERSIST = "0"
const { startProxyServer } = await import("file:///Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe/src/proxy/server.ts")

const STREAM = process.argv.includes("--stream")
const PORT = Number(process.env.PROBE_PORT ?? 3522)
const MODEL = process.env.PROBE_MODEL ?? "claude-sonnet-5"
const MAX_TURNS = Number(process.env.PROBE_TURNS ?? 6)
assert(Number.isInteger(MAX_TURNS) && MAX_TURNS > 0 && MAX_TURNS <= 6, "Bound E41 to at most six tool/answer rounds")

const WORKDIR = realpathSync(mkdtempSync(join(tmpdir(), "meridian-probe-proxy-")))
// The SDK recomputes git status each query. Keep this cache-continuity
// fixture outside the checkout so concurrent review edits cannot change it.
process.env.MERIDIAN_WORKDIR = WORKDIR
setSessionStoreDir(join(WORKDIR, "meridian-store"))
process.env.MERIDIAN_CONFIG_DIR = join(WORKDIR, "meridian-config")
mkdirSync(process.env.MERIDIAN_CONFIG_DIR)
process.env.MERIDIAN_OPENCODE_ATTESTATION_KEY = randomBytes(32).toString("base64url")
const clientConfig = join(WORKDIR, "owned-client-config")
mkdirSync(clientConfig)
const setup = Bun.spawnSync(["node", process.env.E2E_MERIDIAN_ROOT + "/dist/cli.js", "setup", "--v1"], {
  cwd: WORKDIR, env: {...process.env, OPENCODE_CONFIG_DIR: clientConfig}, stdout:"pipe", stderr:"pipe"
})
assert.equal(setup.exitCode,0,"Tested setup must install the V1 plugin before protocol host inference")
const configured = JSON.parse(readFileSync(join(clientConfig,"opencode.json"),"utf8"))
assert.deepEqual(configured.plugin.map(path=>realpathSync(path)),[realpathSync(process.env.E2E_MERIDIAN_ROOT+"/dist/meridian")])
const scrubConfig = configureOpenCodeScrub(WORKDIR, scrub)
const sessionId = `probe-turns-${STREAM ? "stream" : "nonstream"}-${process.pid}`
const clientPlugin = await loadOpenCodeClient(clientInstallation, sessionId)
const report = {clientPlugin:clientPlugin.report,scope:"Real SDK/model E41 with installed client hook and server scrub; protocol host, not OpenCode executable",model:MODEL,stream:STREAM,root:WORKDIR,result:"RUNNING"}
report.setup = {exit:setup.exitCode, generation:"v1", field:"plugin", entries:configured.plugin.length, path:configured.plugin[0]}
report.runtimeRequests=[]
let inst
let failure
try {
const CONTENT = { "a.txt": "alpha", "b.txt": "bravo", "c.txt": "charlie" }
const FILES = Object.keys(CONTENT).map(f => join(WORKDIR, f))
for (const f of FILES) writeFileSync(f, CONTENT[f.slice(-5)] + "\n")

// Programmatic servers do not discover disk profiles automatically. Make a
// selected read-only live fixture explicit rather than falling back to login.
report.phase = "access-only grant"
const profileFile = process.env.E2E_LIVE_PROFILE_FILE
let profiles
if (profileFile) {
  assert.equal(statSync(profileFile).mode & 0o077, 0, "Live profile fixture must be private")
  assert(process.env.MERIDIAN_CONFIG_DIR, "Set an isolated MERIDIAN_CONFIG_DIR")
  profiles = JSON.parse(readFileSync(profileFile, "utf8"))
  assert(Array.isArray(profiles) && profiles.length === 1 && profiles[0].type === "oauth-token"
    && typeof profiles[0].id === "string" && /^[a-z0-9_-]{1,80}$/i.test(profiles[0].id)
    && profiles[0].refreshToken === undefined && typeof profiles[0].oauthToken === "string"
    && profiles[0].oauthToken, "Select one supported access-only OAuth profile")
  process.env.MERIDIAN_CREDENTIALS_READONLY = "1"
}

const READ_TOOL = {
  name: "read",
  description: "Read a file from disk",
  input_schema: {
    type: "object",
    properties: { file_path: { type: "string", description: "Absolute path" } },
    required: ["file_path"],
  },
}

// Keep proxy logs out of the probe's verdict while retaining lineage events.
const say = console.log.bind(console)
const proxyLog = []
// claudeLog events use console.debug and request lines use console.error.
for (const k of ["log", "error", "debug"]) console[k] = (...args) => { proxyLog.push(args.map(String).join(" ")) }
report.phase = "server scrub preflight"
inst = await startProxyServer({ port: PORT, host: "127.0.0.1", profiles, ...scrubConfig,
  defaultProfile: profiles?.[0].id })
const preflightResponse=await fetch(`http://127.0.0.1:${PORT}/plugins/list`)
const preflightBody=await preflightResponse.json()
report.serverPreflightHTTP={status:preflightResponse.status,body:preflightBody}
report.scrubPreflight = verifyOpenCodeScrub(preflightBody,scrub)
if (profiles) say(`  explicit isolated profile: ${profiles[0].id}`)
const short = s => (typeof s === "string" && s.length > 10 ? s.slice(-8) : String(s))

/** Parse either response shape into assistant content blocks plus usage. */
async function assistantBlocks(res) {
  const raw = await res.text()
  if(res.status!==200){report.providerRefusal={status:res.status};try{const body=JSON.parse(raw);report.providerRefusal.type=body.error?.type;report.providerRefusal.diagnostic=body.error?.message?.slice(0,600)}catch{}}
  assert.equal(res.status, 200, "E41 HTTP error; stop before another model request")
  const events = STREAM ? raw.split("\n").filter(line=>line.startsWith("data:")).map(line=>JSON.parse(line.slice(5))) : [JSON.parse(raw)]
  const errorEvent=events.find(event=>event?.type==="error"||event?.error)
  if(errorEvent)report.providerRefusal={status:res.status,type:errorEvent.error?.type,diagnostic:errorEvent.error?.message?.slice(0,600)}
  assert(!errorEvent, "E41 provider error; stop before another model request")
  return parseAssistantResponse(raw, STREAM)
}

/** One line of prompt-cache accounting: what was read from cache vs paid for. */
const usageLine = u => {
  const read = u.cache_read_input_tokens ?? 0, created = u.cache_creation_input_tokens ?? 0, fresh = u.input_tokens ?? 0
  const total = read + created + fresh
  return `cache_read=${read} cache_create=${created} input=${fresh} (${total ? Math.round(100 * read / total) : 0}% of ${total} input read from cache)`
}

// Prompt-cache continuity across resumes. Forking changes session/message
// metadata, not Anthropic prompt content, so each continuation must read the
// previous turn's full cached prefix.
const CACHE_FLOOR = 0.95
let priorCached = 0
const cacheMisses = []
report.cacheMisses = cacheMisses
function checkCache(label, usage, lineage) {
  const read = usage.cache_read_input_tokens ?? 0
  if (lineage.includes("continuation") && priorCached > 0 && read < CACHE_FLOOR * priorCached) {
    cacheMisses.push(`${label}: cache_read=${read} < ${CACHE_FLOOR} x prior cached ${priorCached}`)
    assert.fail(cacheMisses.at(-1))
  }
  priorCached = read + (usage.cache_creation_input_tokens ?? 0)
}

let humanMessage = {id:"owned-human-1",sessionID:sessionId,time:{created:Date.now()}}
async function send(messages) {
  const headers = await clientPlugin.headers(humanMessage, {
    "Content-Type":"application/json", "x-api-key":"dummy",
    "user-agent":"opencode/e41-plugin-host",
  })
  const parts=(headers["x-meridian-opencode-turn"]??"").split(".")
  assert.equal(parts[0],"v1","Live real plugin must sign the turn")
  const payload=Buffer.from(parts[1],"base64url").toString("utf8"), decoded=JSON.parse(payload)
  const expected=createHmac("sha256",Buffer.from(process.env.MERIDIAN_OPENCODE_ATTESTATION_KEY,"base64url")).update("meridian.opencode.turn.v1\0").update(payload).digest("base64url")
  assert.equal(parts[2],expected,"Live real plugin HMAC mismatch")
  assert.equal(decoded.g,"oc1");assert.equal(decoded.s,sessionId);assert.equal(decoded.a,"build")
  const target=`http://127.0.0.1:${PORT}/v1/messages`
  assert.equal(new URL(target).pathname,"/v1/messages")
  report.runtimeRequests.push({route:"/v1/messages",session:headers["x-opencode-session"],agent:headers["x-opencode-agent-name"],mode:headers["x-opencode-agent-mode"],attested:true,resultIds:messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).filter(block=>block.type==="tool_result").map(block=>block.tool_use_id)})
  return fetch(target, {
    signal: AbortSignal.timeout(120000), method:"POST", headers,
    body: JSON.stringify({ model: MODEL, max_tokens: 2048, stream: STREAM, tools: [READ_TOOL], messages }),
  })
}

// PROBE_PARALLEL=1 asks for all three reads in one turn, so the hook's denies
// arrive while the turn is still generating and are HELD. Pair it with
// DENY_HOLD_TIMEOUT_MS=1 to make the hold expire, which refuses the checkpoint
// and forces the next turn through the text-path resume — the one way to
// exercise that path from outside the proxy.
const PARALLEL = process.env.PROBE_PARALLEL === "1"
const messages = [{
  role: "user",
  content: PARALLEL
    ? `Use the read tool to read ${FILES.join(", ")} — all three in a single turn, in parallel. ` +
      `Once you have all three contents reply with them on one line and nothing else.`
    : `Use the read tool to read ${FILES[0]}. Only after its content has been returned to you, ` +
      `read ${FILES[1]}. Only after that content has been returned, read ${FILES[2]}. ` +
      `Make exactly one read call per step, never in parallel, and once you have all three ` +
      `reply with the three contents on one line and nothing else.`,
}]

const delivered = new Set()
const sourceSnapshots = new Map()
const sourceHistoryProblems = []
const continuationPrefixes = []
const toolCallBatchSizes = []
let finalText = ""
let followUpOk = false

const storedSession = () => Object.entries(readSessionStoreSnapshot()).find(([key]) =>
  key === sessionId || key.endsWith(`:${sessionId}`)
)?.[1]
async function supportedMessages(stored) {
  if (!stored?.claudeSessionId) return []
  const previous = process.env.CLAUDE_CONFIG_DIR
  try {
    if (stored.currentTranscript?.configDir) process.env.CLAUDE_CONFIG_DIR = stored.currentTranscript.configDir
    return await getSessionMessages(stored.claudeSessionId, {
      dir: stored.currentTranscript?.projectDir ?? WORKDIR,
    })
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
  }
}
async function captureSource() {
  await new Promise(r => setTimeout(r, 1500))
  const source = storedSession()
  const sourceMessages = await supportedMessages(source)
  const models = [...new Set(sourceMessages.filter(row => row.type === "assistant")
    .map(row => row.message?.model).filter(value => typeof value === "string"))]
  report.observedModels = models
  report.modelOk = models.length > 0 && models.every(value => value === MODEL)
  assert(report.modelOk, "Supported SDK source history does not match the required model; stop before another model request")
  if (!source?.claudeSessionId || sourceMessages.length === 0) sourceHistoryProblems.push("missing source snapshot")
  else if (sourceSnapshots.has(source.claudeSessionId)) sourceHistoryProblems.push("reused source before fork")
  else sourceSnapshots.set(source.claudeSessionId, { source, messages: JSON.stringify(sourceMessages) })
}

report.phase = "model requests"
for (let turn = 1; turn <= MAX_TURNS; turn++) {
  const logFrom = proxyLog.length
  const res = await send(messages)
  const { blocks, usage } = await assistantBlocks(res)
  const calls = blocks.filter(b => b.type === "tool_use")
  const text = blocks.filter(b => b.type === "text").map(b => b.text).join("")
  const turnLog = proxyLog.slice(logFrom)
  const lineage = turnLog.map(l => l.match(/lineage=\S+ session=\S+/)?.[0]).find(Boolean) ?? "?"
  const resumedPrefix = lineage.match(/lineage=continuation session=(\S+)/)?.[1]
  if (resumedPrefix) {
    continuationPrefixes.push(resumedPrefix)
  }
  say(`\n=== turn ${turn} (stream=${STREAM}) http ${res.status} ===`)
  say(`  calls: ${calls.map(c => `${c.name}(${String(c.input?.file_path ?? "").slice(-5)})#${short(c.id)}`).join(", ") || "none"}`)
  if (text) say(`  text: ${JSON.stringify(text.slice(0, 200))}`)
  say(`  lineage: ${lineage}`)
  say(`  usage: ${usageLine(usage)}`)
  checkCache(`turn ${turn}`, usage, lineage)
  if (res.status !== 200) { say(`  body: ${JSON.stringify(blocks).slice(0, 300)}`); break }

  messages.push({ role: "assistant", content: replayAssistantBlocks(blocks) })
  if (calls.length === 0) { finalText = text; break }
  toolCallBatchSizes.push(calls.length)

  // Inspect the published source before the next request forks it. The
  // canonical drain may finish after the wire EOF, as in the final check below.
  await captureSource()

  // Execute the forwarded calls like a client would.
  const results = calls.map(c => {
    const p = String(c.input?.file_path ?? "")
    let content
    assert(FILES.includes(p), "E41 model requested a file outside the owned fixtures")
    try { content = readFileSync(p, "utf8").trim() } catch (e) { content = `ERROR: ${e.message}` }
    delivered.add(c.id)
    return { type: "tool_result", tool_use_id: c.id, content: `REALOUTPUT[${content}]` }
  })
  messages.push({ role: "user", content: results })
}

// One more turn after the answer. This resumes the final live fork through all
// delivered results and proves both the active transcript and its cache prefix.
if (finalText) {
  humanMessage = {id:"owned-human-2",sessionID:sessionId,time:{created:Date.now()}}
  await captureSource()
  const logFrom = proxyLog.length
  const res = await send([...messages, { role: "user", content: "Reply with the single word OK." }])
  const { blocks, usage } = await assistantBlocks(res)
  followUpOk = res.status === 200 && blocks.filter(b => b.type === "text").map(b => b.text).join("").trim() === "OK"
  const lineage = proxyLog.slice(logFrom).map(l => l.match(/lineage=\S+ session=\S+/)?.[0]).find(Boolean) ?? "?"
  const resumedPrefix = lineage.match(/lineage=continuation session=(\S+)/)?.[1]
  if (resumedPrefix) {
    continuationPrefixes.push(resumedPrefix)
  }
  say(`\n=== follow-up turn (stream=${STREAM}) http ${res.status} ===`)
  say(`  lineage: ${lineage}`)
  say(`  usage: ${usageLine(usage)}`)
  checkCache("follow-up", usage, lineage)
}

// Resolve Meridian's published session, then inspect it only through the
// supported Agent SDK API. Never locate or read Claude's private transcript files.
await new Promise(r => setTimeout(r, 1500))
const activeStoredSession = storedSession()
const activeSessionId = activeStoredSession?.claudeSessionId
const activeMessages = await supportedMessages(activeStoredSession)
for (const [id, snapshot] of sourceSnapshots) {
  if (JSON.stringify(await supportedMessages(snapshot.source)) !== snapshot.messages) {
    sourceHistoryProblems.push(`source ${short(id)} changed after fork`)
  }
}
const sourceHistoryOk = sourceSnapshots.size === toolCallBatchSizes.length + 1 && sourceHistoryProblems.length === 0
const observedModels = [...new Set(activeMessages.filter(row => row.type === "assistant")
  .map(row => row.message?.model).filter(value => typeof value === "string"))]
const modelOk = observedModels.length > 0 && observedModels.every(value => value === MODEL)

say(`\n=== verdict (stream=${STREAM}, parallel=${PARALLEL}) ===`)
const quotes = Object.values(CONTENT).filter(w => finalText.includes(w))
const claimsUnanswered = /forwarded|no content|not returned|never returned|no result/i.test(finalText)
const toolShapeOk = PARALLEL
  ? toolCallBatchSizes.length === 1 && toolCallBatchSizes[0] === 3
  : toolCallBatchSizes.length === 3 && toolCallBatchSizes.every(n => n === 1)
const uniqueContinuations = new Set(continuationPrefixes)
const forkShapeOk = uniqueContinuations.size === toolCallBatchSizes.length + 1
say(`  tool-call batches: ${toolCallBatchSizes.join(" + ") || "none"}${toolShapeOk ? "" : "   <-- WRONG TURN SHAPE"}`)
say(`  continuation session prefixes: ${[...uniqueContinuations].join(" -> ") || "none"}${forkShapeOk ? "" : "   <-- FORK CHAIN NOT DURABLE"}`)
say(`  final reply quotes ${quotes.length}/3 contents: ${quotes.join(",") || "none"}${claimsUnanswered ? "   <-- claims a call went unanswered" : ""}`)

const messageBlocks = activeMessages.flatMap((row) => {
  const message = row?.message
  if (!message || typeof message !== "object" || !Array.isArray(message.content)) return []
  return message.content
})
const answerBlocks = messageBlocks.filter((block) =>
  block?.type === "tool_result" && delivered.has(block.tool_use_id)
)
const activeAnswerProblems = []
for (const id of delivered) {
  const answers = answerBlocks.filter(block => block.tool_use_id === id)
  const denials = answers.filter(isForwardedDenial)
  const real = answers.filter(block => !isForwardedDenial(block))
  if (denials.length !== 0 || real.length !== 1) {
    activeAnswerProblems.push(`${short(id)}: real=${real.length} denial=${denials.length}`)
  }
}
const activeHistoryVerdict = !activeSessionId
  ? "missing"
  : activeAnswerProblems.length
    ? activeAnswerProblems.join(", ")
    : "exactly one real answer per delivered call"
say(`  active fork ${activeSessionId ?? "missing"}: ${activeHistoryVerdict}`)
say(`  source history: ${sourceHistoryOk ? `${sourceSnapshots.size} unchanged parents` : sourceHistoryProblems.join("; ") || "missing parents"}`)
say(`  saved-session follow-up: ${followUpOk ? "OK" : "failed"}`)
say(`  actual assistant models: ${observedModels.join(",") || "missing"}`)
say(`  prompt cache: ${cacheMisses.length ? cacheMisses.join("; ") + "   <-- PREFIX LOST" : "every continuation read the prior cached prefix"}`)
if (!activeSessionId) say("  no published session was found — inconclusive")
if (activeMessages.length === 0) say("  supported getSessionMessages() returned no active history")
const pass = quotes.length === 3 &&
  !claimsUnanswered &&
  delivered.size === 3 &&
  toolShapeOk &&
  forkShapeOk &&
  Boolean(activeSessionId) &&
  activeMessages.length > 0 &&
  activeAnswerProblems.length === 0 &&
  sourceHistoryOk && modelOk && followUpOk &&
  cacheMisses.length === 0
say(`  ${pass ? "PASS" : "FAIL"}: tool batching, active history, and prompt-cache continuity`)
if (!pass) {
  say("\n  recent proxy diagnostics:")
  for (const line of proxyLog.slice(-30)) say(`    ${line}`)
}

report.scrubFinal = verifyOpenCodeScrub(await (await fetch(`http://127.0.0.1:${PORT}/plugins/list`)).json(),scrub,true)
assert.equal(clientPlugin.report.errors,0,"Client plugin execution failed")
assert(clientPlugin.report.invocations > 0,"Client plugin never processed a request")
Object.assign(report,{sourceSnapshots:sourceSnapshots.size,continuationPrefixes:[...uniqueContinuations],activeSessionId,observedModels,parallel:PARALLEL,toolCallBatchSizes,delivered:delivered.size,sourceHistoryOk,modelOk,followUpOk,cacheMisses,activeAnswerProblems,forkShapeOk,toolShapeOk})
assert(pass,"E41 original assertions failed")
report.result="PASS"
} catch(error) {
 failure=error
 report.result="FAIL"
 report.failure=error instanceof assert.AssertionError ? error.message : error?.name ?? "UnknownError"
 if(typeof error?.code === "string")report.failureCode=error.code
} finally {
 try { await inst?.close() } catch(error) { report.closeFailure=error?.name??"UnknownError";report.result="FAIL" }
 report.children=[]
 for (const actor of actors) report.children.push(await stopAndJoinChild(actor.child,actor.witness))
 report.joined=report.children.every(row=>row.joined)
 if(!report.joined)report.result="FAIL"
 for(const spy of spies.reverse())spy.mockRestore()
 writeFileSync(join(WORKDIR,"qualified-e41-report.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600})
 process.stdout.write(JSON.stringify({root:WORKDIR,result:report.result,joined:report.joined,failure:report.failure})+"\n")
 process.exitCode=report.result==="PASS"?0:1
}

