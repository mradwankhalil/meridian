/**
 * follow-external reads the oc-codex-multi-auth store and nothing more.
 *
 * The owner's refresh tokens are single-use, so these tests pin the three
 * things that keep Meridian from ever becoming a second refresher: no write
 * primitive exists in the module, reading never changes the file or its
 * directory, and the owner's own eligibility state is honoured.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createExternalCredentialSource } from "../proxy/chatgpt/external"

const NOW = 1_800_000_000_000

function account(n: number, extra: Record<string, unknown> = {}) {
  return {
    accountId: `workspace-${n}`,
    accountUserId: `user-${n}__workspace-${n}`,
    email: `seat${n}@example.test`,
    planType: "pro",
    refreshToken: `rt-${n}`,
    accessToken: `at-${n}`,
    expiresAt: NOW + 3_600_000,
    addedAt: 1,
    lastUsed: 1,
    ...extra,
  }
}

let dir: string
let path: string
function writePool(accounts: unknown[], extra: Record<string, unknown> = {}) {
  writeFileSync(path, JSON.stringify({ version: 3, accounts, activeIndex: 0, ...extra }))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chatgpt-external-"))
  path = join(dir, "oc-codex-multi-auth-accounts.json")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("follow-external credential source", () => {
  it("imports no filesystem write primitive", () => {
    const code = readFileSync(join(import.meta.dir, "../proxy/chatgpt/external.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
    const fsImports = [...code.matchAll(/import\s*\{([^}]*)\}\s*from\s*"node:fs"/g)].flatMap(m => m[1]!.split(",").map(s => s.trim()).filter(Boolean))
    expect(fsImports.sort()).toEqual(["readFileSync", "statSync"])
    expect(code).not.toMatch(/fs\/promises|"fs"|writeFile|rename|unlink|appendFile|openSync|truncate|refreshToken|oauth\/token|fetch\(/)
  })

  it("honours the owner's enabled, cooldown, quota and per-model limit state", async () => {
    writePool([
      account(0, { enabled: false }),
      account(1, { coolingDownUntil: NOW + 1000 }),
      account(2, { quotaExhaustedUntil: NOW + 1000 }),
      account(3, { rateLimitResetTimes: { "gpt-6-luna": NOW + 1000 } }),
      account(4, { coolingDownUntil: NOW - 1, quotaExhaustedUntil: NOW - 1 }),
    ])
    const source = createExternalCredentialSource({ path, now: () => NOW })
    expect(source.candidateSeats("gpt-6-luna")).toEqual(["user-4__workspace-4"])
    expect(source.candidateSeats("gpt-6-sol")).toEqual(["user-3__workspace-3", "user-4__workspace-4"])
    expect(Object.fromEntries(source.seats("gpt-6-luna").map(s => [s.id.slice(0, 6), s.reason ?? "ok"]))).toEqual({
      "user-0": "disabled", "user-1": "cooling_down", "user-2": "quota_exhausted", "user-3": "quota_exhausted", "user-4": "ok",
    })
    expect(await source.credentials("user-0__workspace-0", { model: "gpt-6-luna" })).toEqual({ ok: false, reason: "disabled" })
    expect(await source.credentials("user-4__workspace-4", { model: "gpt-6-luna" })).toEqual({
      ok: true, account: { accountUserId: "user-4__workspace-4", accountId: "workspace-4", accessToken: "at-4" },
    })
  })

  it("starts from the owner's active pick for the model, then rotates in store order", () => {
    writePool([account(0), account(1), account(2)], { activeIndex: 1, activeIndexByFamily: { "gpt-6-luna": 2 } })
    const source = createExternalCredentialSource({ path, now: () => NOW })
    expect(source.candidateSeats("gpt-6-luna").map(s => s[5])).toEqual(["2", "0", "1"])
    expect(source.candidateSeats("gpt-5.4").map(s => s[5])).toEqual(["1", "2", "0"])
  })

  it("reports an expired token instead of repairing it", async () => {
    writePool([account(0, { expiresAt: NOW + 30_000 })])
    const source = createExternalCredentialSource({ path, now: () => NOW })
    // Still a candidate: the backend re-reads it once in case the owner rotated it.
    expect(source.candidateSeats()).toEqual(["user-0__workspace-0"])
    expect(await source.credentials("user-0__workspace-0", { reread: true })).toEqual({ ok: false, reason: "expired" })
    expect(source.describeUnavailable(new Set(["expired"]))).toContain("never refreshes")
  })

  it("picks up a token the owner rotated, by re-reading on change", async () => {
    writePool([account(0)])
    const source = createExternalCredentialSource({ path, now: () => NOW })
    expect(await source.credentials("user-0__workspace-0")).toMatchObject({ ok: true, account: { accessToken: "at-0" } })
    writePool([account(0, { accessToken: "at-0-rotated-by-owner" })])
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    expect(await source.credentials("user-0__workspace-0")).toMatchObject({ ok: true, account: { accessToken: "at-0-rotated-by-owner" } })
  })

  it("never changes the store or its directory while reading it", async () => {
    writePool([account(0), account(1, { expiresAt: NOW - 1 })])
    const before = { bytes: readFileSync(path), entries: readdirSync(dir).sort() }
    const source = createExternalCredentialSource({ path, now: () => NOW })
    source.seats("gpt-6-luna")
    source.candidateSeats("gpt-6-luna")
    await source.credentials("user-0__workspace-0", { reread: true })
    await source.credentials("user-1__workspace-1", { reread: true })
    source.usagePool()
    await source.acquire()
    source.release()
    expect(readFileSync(path).equals(before.bytes)).toBe(true)
    expect(readdirSync(dir).sort()).toEqual(before.entries)
  })

  it("never serves a record that has no seat id", () => {
    writePool([{ ...account(0), accountUserId: undefined }, account(1)])
    const source = createExternalCredentialSource({ path, now: () => NOW })
    expect(source.candidateSeats()).toEqual(["user-1__workspace-1"])
  })

  it("reports an absent or foreign store as not serving", () => {
    const source = createExternalCredentialSource({ path, now: () => NOW })
    expect(source.isServing()).toBe(false)
    expect(source.usagePool().error).toBe("not_configured")
    writeFileSync(path, JSON.stringify({ version: 1, accounts: [] }))
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    expect(source.usagePool().error).toBe("invalid_pool")
  })
})
