/**
 * Task 9 - moving the ChatGPT accounts from the plugin's pool into Meridian's
 * own store, once.
 *
 * This runs exactly one time in the life of the system, during the ownership
 * transfer, against the operator's real credentials, with the plugin stopped
 * and nothing else able to write. Every property below is about that one shot
 * being safe rather than about the import being convenient.
 *
 * IT IS A READER OF THE POOL AND NOTHING ELSE. The pool is the only surviving
 * copy of six refresh tokens at the moment this runs. Damaging it is not a bug
 * to fix on the next run - there is no next run to fix it on.
 *
 * IT REFUSES ANYTHING IT CANNOT DO EXACTLY. A partial or approximate import of
 * a credential file is worse than no import: it produces a store that looks
 * populated and is wrong about which token belongs to whom.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireWriterLease } from "../proxy/chatgpt/lease"
import { createChatGptCredentialStore } from "../proxy/chatgpt/credentials"
import {
  importCodexPool,
  PoolImportRefusedError,
  PoolSourceError,
} from "../proxy/chatgpt/importPool"

const LEASE_MODULE = join(import.meta.dir, "../proxy/chatgpt/lease.ts")

/**
 * Both seats report the SAME accountId. That is what the operator's live pool
 * looks like - one workspace id shared by two people - and it is the only
 * fixture shape that can catch an importer keyed on the wrong field. Unique
 * synthetic ids would pass against a broken importer.
 */
const SHARED_ACCOUNT_ID = "05cd9f04-1111-2222-3333-444444989a40"

const SEAT_A = {
  accountId: SHARED_ACCOUNT_ID,
  accountUserId: "user_first_C0RSu9",
  email: "first@example.test",
  refreshToken: "refresh-first",
  accessToken: "access-first",
  expiresAt: 1_800_000_000_000,
  tokenRotatedAt: 1_700_000_000_000,
  addedAt: 1,
  lastUsed: 2,
}

const SEAT_B = {
  accountId: SHARED_ACCOUNT_ID,
  accountUserId: "user_second_zStirX",
  email: "second@example.test",
  refreshToken: "refresh-second",
  accessToken: null,
  expiresAt: null,
  tokenRotatedAt: null,
  addedAt: 3,
  lastUsed: 4,
}

function pool(accounts: unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: 3, accounts, activeIndex: 0, ...overrides })
}

let dir: string
let poolPath: string
let storePath: string
let backupPath: string

const held: Array<{ release(): void }> = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "meridian-pool-import-"))
  poolPath = join(dir, "oc-codex-multi-auth-accounts.json")
  storePath = join(dir, "chatgpt-accounts.json")
  backupPath = join(dir, "store-backup.json")
  writeFileSync(poolPath, pool([SEAT_A, SEAT_B]), { mode: 0o600 })
})

afterEach(() => {
  while (held.length > 0) {
    try { held.pop()?.release() } catch { /* released by the test */ }
  }
  try { chmodSync(poolPath, 0o600) } catch { /* the test may have removed it */ }
  rmSync(dir, { recursive: true, force: true })
})

function run(overrides: Record<string, unknown> = {}) {
  return importCodexPool({
    poolPath,
    storePath,
    leaseWaitMs: 0,
    staleMs: 400,
    heartbeatMs: 80,
    ...overrides,
  })
}

function poolFingerprint() {
  const info = statSync(poolPath)
  return {
    sha256: createHash("sha256").update(readFileSync(poolPath)).digest("hex"),
    mtimeMs: info.mtimeMs,
    size: info.size,
    mode: info.mode & 0o777,
  }
}

describe("import - identity survives the move", () => {
  it("keys by accountUserId, so two seats sharing one accountId stay two accounts", async () => {
    await run()

    const store = createChatGptCredentialStore({ path: storePath })
    const accounts = store.readAccounts()

    expect(accounts).toHaveLength(2)
    expect(accounts.map(a => a.accountId)).toEqual([SHARED_ACCOUNT_ID, SHARED_ACCOUNT_ID])
    expect(store.readAccount("user_first_C0RSu9")?.refreshToken).toBe("refresh-first")
    expect(store.readAccount("user_second_zStirX")?.refreshToken).toBe("refresh-second")
    expect(store.readAccount("user_first_C0RSu9")?.email).toBe("first@example.test")
    expect(store.readAccount("user_second_zStirX")?.email).toBe("second@example.test")
  })

  it("carries the token state across and starts every seat with no exchange in flight", async () => {
    await run()
    const store = createChatGptCredentialStore({ path: storePath })

    const first = store.readAccount("user_first_C0RSu9")
    expect(first?.accessToken).toBe("access-first")
    expect(first?.expiresAt).toBe(1_800_000_000_000)
    expect(first?.tokenRotatedAt).toBe(1_700_000_000_000)
    // An import is not an interrupted exchange. Carrying a stamp in would put
    // a freshly imported account straight into REQUIRES-REAUTH.
    expect(first?.exchangeStartedAt).toBeNull()

    const second = store.readAccount("user_second_zStirX")
    expect(second?.accessToken).toBeNull()
    expect(second?.expiresAt).toBeNull()
    expect(second?.tokenRotatedAt).toBeNull()
  })

  it("summarises by email and the last six of the accountId, never by token", async () => {
    const result = await run()

    expect(result.imported).toEqual([
      {
        accountUserId: "user_first_C0RSu9",
        email: "first@example.test",
        accountIdTail: "989a40",
        disabledInPool: false,
      },
      {
        accountUserId: "user_second_zStirX",
        email: "second@example.test",
        accountIdTail: "989a40",
        disabledInPool: false,
      },
    ])

    const rendered = JSON.stringify(result)
    expect(rendered).not.toContain("refresh-first")
    expect(rendered).not.toContain("refresh-second")
    expect(rendered).not.toContain("access-first")
  })

  it("reports an account the operator had switched off rather than deciding for them", async () => {
    writeFileSync(poolPath, pool([SEAT_A, { ...SEAT_B, enabled: false }]))
    const result = await run()

    // Imported either way: the store holds credentials, and enablement is a
    // routing decision that lives in profiles.json. Silently dropping it and
    // silently including it are both silent; this is the third option.
    expect(result.imported.map(a => a.disabledInPool)).toEqual([false, true])
    expect(createChatGptCredentialStore({ path: storePath }).readAccounts()).toHaveLength(2)
  })
})

describe("import - the source pool is only ever read", () => {
  it("leaves the pool byte-identical, to the mtime", async () => {
    const before = poolFingerprint()
    // A same-millisecond write would make an unchanged mtime prove nothing.
    const past = new Date(Date.now() - 60_000)
    utimesSync(poolPath, past, past)
    const stamped = poolFingerprint()

    await run()

    expect(poolFingerprint()).toEqual(stamped)
    expect(stamped.sha256).toBe(before.sha256)
  })

  it("succeeds against a pool the process cannot write to at all", async () => {
    // Stronger than comparing bytes afterwards: with the write permission
    // removed, any attempt to open the pool for writing is EACCES rather than
    // a difference someone has to notice.
    chmodSync(poolPath, 0o400)

    await run()

    expect(createChatGptCredentialStore({ path: storePath }).readAccounts()).toHaveLength(2)
    expect(statSync(poolPath).mode & 0o777).toBe(0o400)
  })
})

describe("import - it refuses rather than approximating", () => {
  it("refuses a pool it cannot parse", async () => {
    writeFileSync(poolPath, "{ not json")
    await expect(run()).rejects.toThrow(PoolSourceError)
    expect(existsSync(storePath)).toBe(false)
  })

  it("refuses a pool schema version it was not written against", async () => {
    writeFileSync(poolPath, pool([SEAT_A], { version: 4 }))
    await expect(run()).rejects.toThrow(PoolSourceError)
    expect(existsSync(storePath)).toBe(false)
  })

  it("refuses an account with no accountUserId rather than inventing a key", async () => {
    const { accountUserId: _dropped, ...seatWithoutSeatId } = SEAT_A
    writeFileSync(poolPath, pool([seatWithoutSeatId, SEAT_B]))

    // accountId is right there and is the obvious substitute. Using it would
    // merge the two colliding seats into one account and file one person's
    // single-use token under the other's name.
    await expect(run()).rejects.toThrow(PoolSourceError)
    expect(existsSync(storePath)).toBe(false)
  })

  it("refuses an account with no refresh token", async () => {
    const { refreshToken: _dropped, ...seatWithoutToken } = SEAT_B
    writeFileSync(poolPath, pool([SEAT_A, seatWithoutToken]))

    await expect(run()).rejects.toThrow(PoolSourceError)
    expect(existsSync(storePath)).toBe(false)
  })

  it("refuses two entries claiming the same seat", async () => {
    writeFileSync(poolPath, pool([SEAT_A, { ...SEAT_B, accountUserId: SEAT_A.accountUserId }]))

    await expect(run()).rejects.toThrow(PoolSourceError)
    expect(existsSync(storePath)).toBe(false)
  })

  it("writes nothing at all when any single account is unusable", async () => {
    const { refreshToken: _dropped, ...broken } = SEAT_B
    writeFileSync(poolPath, pool([SEAT_A, broken]))

    await expect(run()).rejects.toThrow(PoolSourceError)
    // All or nothing. A store holding one of two seats looks populated and is
    // wrong, and the operator's own verification step counts accounts.
    expect(existsSync(storePath)).toBe(false)
  })
})

describe("import - it will not overwrite what is already there", () => {
  async function seedExistingStore() {
    const lease = await acquireWriterLease({
      lockPath: `${storePath}.lock`,
      staleMs: 400,
      heartbeatMs: 80,
      waitMs: 0,
    })
    const store = createChatGptCredentialStore({ path: storePath, lease })
    store.commitAccount("user_already_here", () => ({
      accountUserId: "user_already_here",
      accountId: "acct-existing",
      email: "existing@example.test",
      refreshToken: "refresh-already-owned",
      accessToken: null,
      expiresAt: null,
      tokenRotatedAt: 99,
      exchangeStartedAt: null,
    }))
    lease.release()
  }

  it("refuses when a store already exists", async () => {
    await seedExistingStore()

    // The existing store's tokens may already have been ROTATED, in which case
    // the pool's copies are dead and overwriting is the loss, not the recovery.
    await expect(run()).rejects.toThrow(PoolImportRefusedError)
    expect(createChatGptCredentialStore({ path: storePath }).readAccount("user_already_here"))
      .toBeDefined()
  })

  it("refuses --force on its own, without somewhere to put what it replaces", async () => {
    await seedExistingStore()

    await expect(run({ force: true })).rejects.toThrow(PoolImportRefusedError)
    expect(createChatGptCredentialStore({ path: storePath }).readAccount("user_already_here"))
      .toBeDefined()
  })

  it("refuses a backup path without --force, so a backup is never a silent overwrite", async () => {
    await seedExistingStore()

    await expect(run({ backupPath })).rejects.toThrow(PoolImportRefusedError)
    expect(existsSync(backupPath)).toBe(false)
  })

  it("refuses to write a backup over an existing file", async () => {
    await seedExistingStore()
    writeFileSync(backupPath, "an earlier backup nobody wants to lose", { mode: 0o600 })

    await expect(run({ force: true, backupPath })).rejects.toThrow(PoolImportRefusedError)
    expect(readFileSync(backupPath, "utf8")).toBe("an earlier backup nobody wants to lose")
    expect(createChatGptCredentialStore({ path: storePath }).readAccount("user_already_here"))
      .toBeDefined()
  })

  it("replaces the store only with --force AND a fresh backup, and the backup holds the old one", async () => {
    await seedExistingStore()
    const replaced = readFileSync(storePath, "utf8")

    const result = await run({ force: true, backupPath })

    expect(readFileSync(backupPath, "utf8")).toBe(replaced)
    expect(statSync(backupPath).mode & 0o777).toBe(0o600)
    expect(result.backupPath).toBe(backupPath)

    const store = createChatGptCredentialStore({ path: storePath })
    expect(store.readAccounts().map(a => a.accountUserId).sort())
      .toEqual(["user_first_C0RSu9", "user_second_zStirX"])
    // The displaced account is gone from the store and recoverable only from
    // the backup, which is the whole reason the backup is mandatory.
    expect(store.readAccount("user_already_here")).toBeUndefined()
  })
})

describe("import - it runs under the writer lease", () => {
  it("holds the lease while importing and releases it afterwards", async () => {
    const lockPath = `${storePath}.lock`
    expect(existsSync(lockPath)).toBe(false)

    await run()

    expect(existsSync(lockPath)).toBe(false)
    const after = await acquireWriterLease({ lockPath, staleMs: 400, heartbeatMs: 80, waitMs: 0 })
    held.push(after)
    after.assertValid()
  })

  it("refuses while a REAL second process holds the lease, and writes nothing", async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, "-e", `
        import { acquireWriterLease } from ${JSON.stringify(LEASE_MODULE)}
        await acquireWriterLease({
          lockPath: ${JSON.stringify(`${storePath}.lock`)},
          staleMs: 60000,
          heartbeatMs: 200,
          waitMs: 0,
        })
        console.log("HELD")
        setInterval(() => {}, 1000)
      `],
      stdout: "pipe",
      stderr: "pipe",
    })

    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let seen = ""
    while (!seen.includes("HELD")) {
      const { done, value } = await reader.read()
      if (done) break
      seen += decoder.decode(value, { stream: true })
    }
    expect(seen).toContain("HELD")

    try {
      // An in-process guard would let this through, and two importers writing
      // one credential file is the same class of loss as two refreshers.
      await expect(run()).rejects.toThrow()
      expect(existsSync(storePath)).toBe(false)
    } finally {
      child.kill("SIGKILL")
      await child.exited
    }
  })
})
