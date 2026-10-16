/**
 * Unit tests for the read-only oc-codex account-pool reader.
 *
 * The pool belongs to the oc-codex-multi-auth plugin; Meridian is a guest in
 * it. Two properties matter more than anything this file asserts about parsing:
 * the reader never writes, and it never refreshes. Those are pinned separately
 * in codex-no-write.test.ts.
 *
 * The identity format is `<email>, id:<last 6 of accountId>` because
 * `accountId` alone is NOT unique — a real pool on this machine has one
 * accountId shared by two different emails belonging to two different users.
 * `accountUserId` is the only safe key.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadCodexPool, readCodexPool, codexAccountIdentity, codexPoolPath } from "../proxy/codex/pool"

const tempDir = join(tmpdir(), `meridian-codex-pool-${process.pid}`)
const poolFile = join(tempDir, "oc-codex-multi-auth-accounts.json")

function writePool(contents: unknown): void {
  writeFileSync(poolFile, typeof contents === "string" ? contents : JSON.stringify(contents), { mode: 0o600 })
}

/** A pool entry carrying only the fields a real record is guaranteed to have. */
function account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    accountId: "aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
    accountUserId: "user-ABC__aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
    organizationId: "org-EXAMPLEORGIDENTIFIER",
    email: "someone@example.com",
    refreshToken: "synthetic-refresh-token",
    accessToken: "synthetic.access.token",
    expiresAt: 1789494103699,
    addedAt: 1787823718470,
    lastUsed: 1788635891853,
    ...overrides,
  }
}

describe("codex pool reader", () => {
  let savedPoolPath: string | undefined

  beforeEach(() => {
    savedPoolPath = process.env.MERIDIAN_CODEX_POOL_PATH
    rmSync(tempDir, { recursive: true, force: true })
    mkdirSync(tempDir, { recursive: true })
    process.env.MERIDIAN_CODEX_POOL_PATH = poolFile
  })

  afterEach(() => {
    if (savedPoolPath !== undefined) process.env.MERIDIAN_CODEX_POOL_PATH = savedPoolPath
    else delete process.env.MERIDIAN_CODEX_POOL_PATH
    rmSync(tempDir, { recursive: true, force: true })
  })

  test("resolves the override path per call, not at import time", () => {
    expect(codexPoolPath()).toBe(poolFile)
    const other = join(tempDir, "elsewhere.json")
    process.env.MERIDIAN_CODEX_POOL_PATH = other
    expect(codexPoolPath()).toBe(other)
  })

  test("defaults to the global oc-codex pool when unset", () => {
    delete process.env.MERIDIAN_CODEX_POOL_PATH
    expect(codexPoolPath()).toContain(join(".opencode", "oc-codex-multi-auth-accounts.json"))
  })

  test("returns null when the pool is absent — the integration is simply not installed", () => {
    expect(loadCodexPool()).toBeNull()
  })

  test("returns null for malformed JSON rather than throwing", () => {
    writePool("{ not json")
    expect(loadCodexPool()).toBeNull()
  })

  test("returns null for a schema version it does not understand", () => {
    writePool({ version: 2, accounts: [account()], activeIndex: 0 })
    expect(loadCodexPool()).toBeNull()
  })

  test("returns null when accounts is not an array", () => {
    writePool({ version: 3, accounts: {}, activeIndex: 0 })
    expect(loadCodexPool()).toBeNull()
  })

  test("reads a v3 pool and exposes the fields a card needs", () => {
    writePool({ version: 3, accounts: [account()], activeIndex: 0 })
    const pool = loadCodexPool()
    expect(pool).not.toBeNull()
    expect(pool?.accounts).toHaveLength(1)
    expect(pool?.accounts[0]).toMatchObject({
      accountId: "aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
      accountUserId: "user-ABC__aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
      email: "someone@example.com",
      expiresAt: 1789494103699,
      enabled: true,
    })
  })

  test("tolerates the optional fields that real records omit", () => {
    // planType, accountLabel, enabled, accountTags and accountNote are all
    // absent from every record in the real pool on this machine.
    writePool({ version: 3, accounts: [account()], activeIndex: 0 })
    const parsed = loadCodexPool()?.accounts[0]
    expect(parsed?.planType).toBeNull()
    expect(parsed?.accountLabel).toBeNull()
    expect(parsed?.enabled).toBe(true)
  })

  test("keeps two accounts that share an accountId but differ by user", () => {
    const shared = "bbbbbbbb-2222-4222-8222-bbbbbbb4d5e6"
    writePool({
      version: 3,
      activeIndex: 0,
      accounts: [
        account({ accountId: shared, accountUserId: `user-ONE__${shared}`, email: "one@example.com" }),
        account({ accountId: shared, accountUserId: `user-TWO__${shared}`, email: "two@example.com" }),
      ],
    })
    const accounts = loadCodexPool()?.accounts ?? []
    expect(accounts).toHaveLength(2)
    expect(accounts[0]?.accountUserId).not.toBe(accounts[1]?.accountUserId)
  })

  test("drops entries that carry no usable identity at all", () => {
    writePool({ version: 3, activeIndex: 0, accounts: [{ addedAt: 1, lastUsed: 1 }] })
    expect(loadCodexPool()?.accounts).toHaveLength(0)
  })

  test("honours an explicit enabled:false", () => {
    writePool({ version: 3, accounts: [account({ enabled: false })], activeIndex: 0 })
    expect(loadCodexPool()?.accounts[0]?.enabled).toBe(false)
  })

  test("distinguishes an absent pool from a broken one", () => {
    expect(readCodexPool()).toEqual({ pool: null, error: "not_configured" })

    writePool("{ not json")
    expect(readCodexPool()).toEqual({ pool: null, error: "pool_unreadable" })

    writePool({ version: 2, accounts: [account()], activeIndex: 0 })
    expect(readCodexPool()).toEqual({ pool: null, error: "invalid_pool" })

    writePool({ version: 3, accounts: {}, activeIndex: 0 })
    expect(readCodexPool()).toEqual({ pool: null, error: "invalid_pool" })
  })

  test("reports no error when the pool reads cleanly", () => {
    writePool({ version: 3, accounts: [account()], activeIndex: 0 })
    const result = readCodexPool()
    expect(result.error).toBeNull()
    expect(result.pool?.accounts).toHaveLength(1)
  })
})

describe("codexAccountIdentity", () => {
  test("renders email plus the last six of the account id", () => {
    expect(codexAccountIdentity({
      email: "someone@example.com",
      accountId: "aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
    })).toBe("someone@example.com, id:a1b2c3")
  })

  test("falls back progressively when a part is missing", () => {
    expect(codexAccountIdentity({ email: "a@b.c", accountId: null })).toBe("a@b.c")
    expect(codexAccountIdentity({ email: null, accountId: "abcdef123456" })).toBe("id:123456")
    expect(codexAccountIdentity({ email: null, accountId: null })).toBe("unknown account")
  })

  test("uses a short account id whole rather than slicing it", () => {
    expect(codexAccountIdentity({ email: null, accountId: "abc" })).toBe("id:abc")
  })
})
