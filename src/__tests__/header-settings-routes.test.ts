/**
 * Hostname consent through the real Claude and standalone Antigravity HTTP
 * dispatchers. Auth/account checks are controlled here: no CLI, SDK generation
 * or credential-store access is needed to exercise the header contract.
 * Isolated by package.json because Bun's model-module mock is process-global.
 */
import { installModelsMock } from "./modelsMock"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { hostname, tmpdir } from "node:os"
import { join } from "node:path"
import * as realModels from "../proxy/models"
import { AntigravityRuntime } from "../proxy/backends/antigravityRuntime"
import { createAntigravityServer } from "../proxy/backends/antigravity"
import { DEFAULT_PROXY_CONFIG } from "../proxy/types"
import { getSetting, setSetting } from "../settings"

let authLookup: () => Promise<realModels.ClaudeAuthStatus | null> = async () => null
installModelsMock(() => ({
  getClaudeAuthStatusAsync: () => authLookup(),
  resolveClaudeExecutableAsync: async () => "owned-claude-fixture",
}))
const { createProxyServer } = await import("../proxy/server")

type TestApp = { fetch: (request: Request) => Response | Promise<Response> }
const base = "http://localhost"
const request = (path: string, headers?: Record<string, string>) => new Request(base + path, { headers })
const body = async (response: Response) => await response.json() as Record<string, unknown>

for (const backend of ["claude", "antigravity"] as const) describe(`${backend} header consent`, () => {
  let dir: string
  let app: TestApp
  let close: (() => Promise<void>) | undefined
  let beginDrain: () => void
  let accountCheck: () => Promise<void>
  let savedConfigDir: string | undefined
  let savedKey: string | undefined

  function create() {
    if (backend === "claude") {
      const server = createProxyServer({ port: 0, host: "127.0.0.1", silent: true,
        profiles: [{ id: "header-fixture", type: "api", apiKey: "owned-dummy-key" }],
        defaultProfile: "header-fixture" })
      beginDrain = server.beginDrain!
      return server.app
    }
    const runtime = new AntigravityRuntime()
    runtime.initialize = async () => {}
    runtime.verifyAccount = () => accountCheck()
    const server = createAntigravityServer({ ...DEFAULT_PROXY_CONFIG, backend }, runtime)
    close = server.closeBackend
    beginDrain = server.beginDrain!
    return server.app
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "meridian-header-consent-"))
    savedConfigDir = process.env.MERIDIAN_CONFIG_DIR
    savedKey = process.env.MERIDIAN_API_KEY
    process.env.MERIDIAN_CONFIG_DIR = dir
    delete process.env.MERIDIAN_API_KEY
    authLookup = async () => null
    accountCheck = async () => {}
    app = create()
  })
  afterEach(async () => {
    await close?.()
    close = undefined
    if (savedConfigDir === undefined) delete process.env.MERIDIAN_CONFIG_DIR
    else process.env.MERIDIAN_CONFIG_DIR = savedConfigDir
    if (savedKey === undefined) delete process.env.MERIDIAN_API_KEY
    else process.env.MERIDIAN_API_KEY = savedKey
    rmSync(dir, { recursive: true, force: true })
  })
  const get = (headers?: Record<string, string>) => app.fetch(request("/settings/api/header", headers))
  const put = (value: unknown, headers?: Record<string, string>) => app.fetch(new Request(base + "/settings/api/header", {
    method: "PUT", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(value),
  }))
  const health = () => app.fetch(request("/health"))

  it("defaults off, exposes the OS name only to settings, and prevents cached consent", async () => {
    const settings = await get()
    expect(settings.status).toBe(200)
    expect(settings.headers.get("cache-control")).toBe("no-store")
    expect(await body(settings)).toEqual({ showHostname: false, hostname: hostname() })
    const response = await health()
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect((await body(response)).hostname).toBeUndefined()
  })

  it("persists on/off across fresh server instances and preserves unrelated settings", async () => {
    setSetting("layout", "wide")
    const enabled = await put({ showHostname: true })
    expect(enabled.status).toBe(200)
    expect(await body(enabled)).toEqual({ showHostname: true, hostname: hostname() })
    expect(getSetting("showHostname")).toBe(true)
    expect((await body(await health())).hostname).toBe(hostname())
    await close?.()
    app = create()
    expect((await body(await get())).showHostname).toBe(true)
    expect((await body(await health())).hostname).toBe(hostname())
    expect((await put({ showHostname: false })).status).toBe(200)
    expect(getSetting("showHostname")).toBe(false)
    expect((await body(await health())).hostname).toBeUndefined()
    expect(getSetting("layout")).toBe("wide")
  })

  it("treats a missing field as a no-op and null as removal, immediately", async () => {
    await put({ showHostname: true })
    expect((await put({})).status).toBe(200)
    expect(getSetting("showHostname")).toBe(true)
    expect((await put({ showHostname: null })).status).toBe(200)
    expect(getSetting("showHostname")).toBeUndefined()
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))).not.toHaveProperty("showHostname")
    expect((await body(await health())).hostname).toBeUndefined()
  })

  it("rejects invalid bodies without changing existing consent", async () => {
    await put({ showHostname: true })
    for (const invalid of [null, [], true, 1, "yes", { showHostname: "yes" }, { showHostname: 1 }]) {
      expect((await put(invalid)).status).toBe(400)
      expect(getSetting("showHostname")).toBe(true)
    }
    const malformed = await app.fetch(new Request(base + "/settings/api/header", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: "{not json",
    }))
    expect(malformed.status).toBe(400)
    expect(getSetting("showHostname")).toBe(true)
  })

  it("fails closed for missing, malformed, null and incorrectly typed persisted consent", async () => {
    for (const invalid of ["{not json", "null", "[]", '{"showHostname":"true"}', '{"showHostname":1}']) {
      writeFileSync(join(dir, "settings.json"), invalid)
      const settings = await get()
      expect(settings.status).toBe(200)
      expect((await body(settings)).showHostname).toBe(false)
      expect((await body(await health())).hostname).toBeUndefined()
    }
    rmSync(join(dir, "settings.json"))
    expect((await body(await get())).showHostname).toBe(false)
  })

  it("protects reads and writes with either API-key form while keeping health public", async () => {
    process.env.MERIDIAN_API_KEY = "owned-header-key"
    const invalidHeaders: Record<string, string>[] = [{}, { "x-api-key": "wrong" }, { Authorization: "Bearer wrong" }]
    for (const headers of invalidHeaders) {
      expect((await get(headers)).status).toBe(401)
      expect((await put({ showHostname: true }, headers)).status).toBe(401)
      expect(getSetting("showHostname")).toBeUndefined()
    }
    const validHeaders: Record<string, string>[] = [{ "x-api-key": "owned-header-key" }, { Authorization: "Bearer owned-header-key" }]
    for (const headers of validHeaders) {
      expect((await get(headers)).status).toBe(200)
      expect((await put({ showHostname: true }, headers)).status).toBe(200)
    }
    expect((await health()).status).not.toBe(401)
    expect((await body(await health())).hostname).toBe(hostname())
  })

  it("rejects foreign, opaque, malformed and different-port Origin writes, even with a key", async () => {
    for (const key of [undefined, "owned-header-key"]) {
      if (key) process.env.MERIDIAN_API_KEY = key
      const headers: Record<string, string> = key ? { "x-api-key": key } : {}
      for (const origin of ["https://foreign.example", "null", "not an origin", "http://localhost:9999", "http://localhost/path", "http://user@localhost"]) {
        expect((await put({ showHostname: true }, { ...headers, Origin: origin })).status).toBe(403)
        expect(getSetting("showHostname")).toBeUndefined()
      }
      expect((await put({ showHostname: true }, { ...headers, Origin: base })).status).toBe(200)
      expect((await put({ showHostname: null }, headers)).status).toBe(200)
    }
  })

  it("permits preserved public Host behind HTTPS termination without trusting forwarding headers", async () => {
    process.env.MERIDIAN_API_KEY = "owned-header-key"
    const write = (target: string, origin: string, forwarding?: string) => app.fetch(new Request(target + "/settings/api/header", {
      method: "PUT", headers: { "x-api-key": "owned-header-key", Origin: origin, "Content-Type": "application/json",
        ...(forwarding ? { "X-Forwarded-Host": forwarding, "X-Forwarded-Proto": "https" } : {}) },
      body: JSON.stringify({ showHostname: true }),
    }))
    expect((await write("http://meridian.example", "https://meridian.example")).status).toBe(200)
    expect((await write("http://meridian.example:443", "https://meridian.example")).status).toBe(200)
    expect((await write("http://meridian.example:8443", "https://meridian.example:8443")).status).toBe(200)
    expect((await write("http://meridian.example", "https://foreign.example", "foreign.example")).status).toBe(403)
    expect((await write("http://meridian.example", "https://meridian.example:8443")).status).toBe(403)
    expect((await write("https://meridian.example", "http://meridian.example")).status).toBe(403)
  })

  it("adds only the optional hostname to healthy health responses", async () => {
    authLookup = async () => ({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" })
    const off = await health()
    expect(off.status).toBe(200)
    const original = await body(off)
    await put({ showHostname: true })
    const on = await health()
    expect(on.status).toBe(200)
    const enabled = await body(on)
    expect(enabled.hostname).toBe(hostname())
    delete enabled.hostname
    expect(enabled).toEqual(original)
  })

  it("rechecks consent after a delayed auth/account probe", async () => {
    await put({ showHostname: true })
    let release: () => void = () => { throw new Error("Missing probe gate") }
    let entered: () => void = () => { throw new Error("Missing entered gate") }
    const waiting = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    authLookup = async () => { entered(); await waiting; return null }
    accountCheck = async () => { entered(); await waiting }
    const pending = Promise.resolve(health())
    await started
    try { expect((await put({ showHostname: false })).status).toBe(200) }
    finally { release() }
    const response = await pending
    expect((await body(response)).hostname).toBeUndefined()
  })

  it("keeps draining health status and liveness/readiness shapes, with hostname only on health", async () => {
    await put({ showHostname: true })
    beginDrain()
    const response = await health()
    expect(response.status).toBe(503)
    expect(await body(response)).toMatchObject({ status: "draining", hostname: hostname() })
    const live = await app.fetch(request("/livez"))
    expect(live.status).toBe(200)
    expect(await live.text()).not.toContain("hostname")
    const ready = await app.fetch(request("/readyz"))
    expect(ready.status).toBe(backend === "antigravity" ? 503 : 200)
    expect(await ready.text()).not.toContain("hostname")
    expect(await body(await app.fetch(request("/settings/api/features")))).not.toHaveProperty("hostname")
  })

  it("keeps auth/account error responses while applying current consent only to health", async () => {
    await put({ showHostname: true })
    authLookup = async () => ({ loggedIn: false })
    accountCheck = async () => { throw new Error("Owned account failure") }
    const response = await health()
    expect(response.status).toBe(503)
    const result = await body(response)
    expect(result.hostname).toBe(hostname())
    if (backend === "claude") expect(result).toMatchObject({ status: "unhealthy", auth: { loggedIn: false } })
    else expect(result).toMatchObject({ type: "error", error: { type: "api_error", message: "Owned account failure" } })
    await put({ showHostname: false })
    expect((await body(await health())).hostname).toBeUndefined()
    const ready = await app.fetch(request("/readyz"))
    expect(await ready.text()).not.toContain("hostname")
  })
})
