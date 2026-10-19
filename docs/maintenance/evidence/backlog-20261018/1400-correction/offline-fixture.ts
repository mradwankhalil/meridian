/** Loaded only in a fresh regression worker; never install native mocks in the main suite. */
import { afterAll, expect, mock, spyOn } from "bun:test"
import * as childProcess from "node:child_process"
import * as http from "node:http"
import * as https from "node:https"
import * as net from "node:net"
import * as tls from "node:tls"
import type { ProcessIncarnation } from "/Volumes/DevSSD/meridian/t3-worktrees/t3-fa1c2388/src/proxy/session/processIncarnation"

const attempts: string[] = []
function refuse(api: string): (...args: unknown[]) => never {
  return () => {
    attempts.push(api)
    throw new Error(`SDK boundary attempted forbidden ${api}`)
  }
}
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
mock.module("/Volumes/DevSSD/meridian/t3-worktrees/t3-fa1c2388/src/proxy/buildRuntime", () => ({ buildRuntime: {
  local: false, info: () => ({ source: "npm", version: "fixture" }),
  status: () => ({ runtime: { source: "npm", version: "fixture" }, state: "unknown" }),
} }))
const identities = await import("/Volumes/DevSSD/meridian/t3-worktrees/t3-fa1c2388/src/proxy/session/processIncarnation")
const identityExports = { ...identities }
const self = { version: 1 as const, pid: process.pid, hostId: "a".repeat(64),
  bootId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startId: "1", startIdKind: "linux-proc-start-ticks" as const }
mock.module("/Volumes/DevSSD/meridian/t3-worktrees/t3-fa1c2388/src/proxy/session/processIncarnation", () => ({ ...identityExports,
  captureProcessIncarnation: (pid = process.pid) => pid === process.pid ? self : undefined,
  probeProcessIncarnation: (owner: ProcessIncarnation) => owner.pid === process.pid ? "alive" : "indeterminate",
}))
const intercepted = await import("child_process")
expect(intercepted.exec === native.exec).toBe(true)
expect(intercepted.execFile === native.execFile).toBe(true)
expect(intercepted.spawn).toBe(native.spawn)
afterAll(() => {
  console.log(`SDK_BOUNDARY_TRAP ${JSON.stringify({ attempts, actualNativeChildren: 0, actualNetworkCalls: 0 })}`)
  expect(attempts).toEqual([])
})

// This external fixture is not part of the contributor correction.
const models = await import('/Volumes/DevSSD/meridian/t3-worktrees/t3-fa1c2388/src/proxy/models.ts')
const credentials = await import('/Volumes/DevSSD/meridian/t3-worktrees/t3-fa1c2388/src/proxy/tokenRefresh.ts')
spyOn(models, "getClaudeAuthStatusAsync").mockResolvedValue({ loggedIn: true, subscriptionType: "max" })
spyOn(models, "resolveClaudeExecutableAsync").mockResolvedValue("meridian-sdk-fixture-not-executed")
spyOn(credentials, "createPlatformCredentialStore").mockImplementation(() => ({
  read: async () => null, write: async () => false,
}))
console.log(`OFFLINE_FIXTURE_RUNTIME ${JSON.stringify({bun: Bun.version, executable: process.execPath})}`)
