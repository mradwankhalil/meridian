/** Loaded only in a fresh regression worker; never install native mocks in the main suite. */
import { afterAll, beforeAll, expect, mock } from "bun:test"
import * as childProcess from "node:child_process"
import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import * as tls from "node:tls"
import * as fs from "node:fs"
import * as fsPromises from "node:fs/promises"
import type { ProcessIncarnation } from "../../proxy/session/processIncarnation"

const attempts: string[] = []
function refuse(api: string): (...args: unknown[]) => never {
  return () => {
    attempts.push(api)
    throw new Error(`SDK boundary attempted forbidden ${api}`)
  }
}
// Refuse the file backend before even checking existence: an empty Linux
// workstation must still discriminate a leaked lexical default-store read.
const fileApis = { ...fs }
const promiseApis = { ...fsPromises }
function credentialGuard(api: string, original: (...args: never[]) => unknown) {
  return (...args: unknown[]) => {
    if (/(?:^|[/\\])(?:\.credentials\.json|auth\.json)$/.test(String(args[0]))) return refuse(`credential.${api}`)()
    return Reflect.apply(original, undefined, args)
  }
}
const guardedFiles = { ...fileApis,
  existsSync: credentialGuard("existsSync", fileApis.existsSync),
  statSync: credentialGuard("statSync", fileApis.statSync),
  readFileSync: credentialGuard("readFileSync", fileApis.readFileSync),
  readFile: credentialGuard("readFile", fileApis.readFile),
  createReadStream: credentialGuard("createReadStream", fileApis.createReadStream),
}
mock.module("node:fs", () => guardedFiles)
mock.module("node:fs/promises", () => ({ ...promiseApis,
  readFile: credentialGuard("promises.readFile", promiseApis.readFile),
}))
expect<unknown>((await import("node:fs")).existsSync).toBe(guardedFiles.existsSync)
const native = { ...childProcess, exec: refuse("exec"), execFile: refuse("execFile"),
  execSync: refuse("execSync"), execFileSync: refuse("execFileSync"),
  spawn: refuse("spawn"), spawnSync: refuse("spawnSync"), fork: refuse("fork") }
mock.module("child_process", () => native)
mock.module("node:child_process", () => native)
mock.module("node:http", () => ({ ...http, request: refuse("http.request"), get: refuse("http.get") }))
mock.module("node:https", () => ({ ...https, request: refuse("https.request"), get: refuse("https.get") }))
mock.module("node:net", () => ({ ...net, connect: refuse("net.connect"), createConnection: refuse("net.createConnection") }))
mock.module("node:tls", () => ({ ...tls, connect: refuse("tls.connect") }))
globalThis.fetch = Object.assign(refuse("fetch"), { preconnect: refuse("fetch.preconnect") })
Bun.spawn = refuse("Bun.spawn") as typeof Bun.spawn
Bun.spawnSync = refuse("Bun.spawnSync") as typeof Bun.spawnSync
Bun.connect = refuse("Bun.connect") as typeof Bun.connect

// Build provenance normally invokes git; it is unrelated to the HTTP assertion.
mock.module("../../proxy/buildRuntime", () => ({ buildRuntime: {
  local: false, info: () => ({ source: "npm", version: "fixture" }),
  status: () => ({ runtime: { source: "npm", version: "fixture" }, state: "unknown" }),
} }))
const identities = await import("../../proxy/session/processIncarnation")
const identityExports = { ...identities }
const self = { version: 1 as const, pid: process.pid, hostId: "a".repeat(64),
  bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startId: "1", startIdKind: "linux-proc-start-ticks" as const }
mock.module("../../proxy/session/processIncarnation", () => ({ ...identityExports,
  captureProcessIncarnation: (pid = process.pid) => pid === process.pid ? self : undefined,
  probeProcessIncarnation: (owner: ProcessIncarnation) => owner.pid === process.pid ? "alive" : "indeterminate",
}))
const intercepted = await import("child_process")
expect<unknown>(intercepted.exec).toBe(native.exec)
expect<unknown>(intercepted.execFile).toBe(native.execFile)
expect(intercepted.spawn).toBe(native.spawn)
beforeAll(async () => {
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  const fixture = await import("../sdkMock")
  expect(sdk.query === fixture.sdkMockQuery).toBe(true)
})
afterAll(() => {
  console.log(`SDK_BOUNDARY_TRAP ${JSON.stringify({ attempts, actualNativeChildren: 0, actualNetworkCalls: 0 })}`)
  expect(attempts).toEqual(["1", "cleanup"].includes(process.env.SDK_BOUNDARY_CONTROL ?? "") ? ["exec"] : [])
})
