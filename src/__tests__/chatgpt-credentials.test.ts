/**
 * Task 4 - Meridian's own ChatGPT credential store.
 *
 * Two properties are load-bearing and both are about irreversible loss rather
 * than correctness in the ordinary sense.
 *
 * IDENTITY IS `accountUserId`. `accountId` is NOT unique: in the operator's
 * live pool one `accountId` is shared by two different people with two
 * different emails and two different seats. A store keyed on `accountId`
 * merges them, and the merge is not a display bug - it hands one person's
 * refresh token to the other's account.
 *
 * A WRITE IS ALL-OR-NOTHING. A refresh token is single-use, so the rotated
 * replacement is the only credential that still works. A half-written file
 * loses it exactly as thoroughly as never writing it at all.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { closeSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireWriterLease } from "../proxy/chatgpt/lease"
import {
  AccountIdentityMismatchError,
  ChatGptStoreCorruptError,
  createChatGptCredentialStore,
  WriterLeaseRequiredError,
  type ChatGptAccount,
} from "../proxy/chatgpt/credentials"

const STORE_MODULE = join(import.meta.dir, "../proxy/chatgpt/credentials.ts")

let dir: string
let lockPath: string
let storePath: string
const held: Array<{ release(): void }> = []

/**
 * The collision is the point. Both seats report the SAME `accountId`, which
 * is what the real pool looks like; synthetic unique ids would let a store
 * keyed on the wrong field pass every assertion here.
 */
const SHARED_ACCOUNT_ID = "05cd9f04-1111-2222-3333-444444989a40"

function account(overrides: Partial<ChatGptAccount> & { accountUserId: string }): ChatGptAccount {
  return {
    accountId: SHARED_ACCOUNT_ID,
    email: null,
    refreshToken: `refresh-${overrides.accountUserId}`,
    accessToken: null,
    expiresAt: null,
    tokenRotatedAt: null,
    exchangeStartedAt: null,
    ...overrides,
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "meridian-chatgpt-store-"))
  lockPath = join(dir, "chatgpt.lock")
  storePath = join(dir, "chatgpt-accounts.json")
})

afterEach(() => {
  while (held.length > 0) {
    try { held.pop()?.release() } catch { /* already released by the test */ }
  }
  rmSync(dir, { recursive: true, force: true })
})

async function writableStore() {
  const lease = await acquireWriterLease({ lockPath, staleMs: 400, heartbeatMs: 80, waitMs: 0 })
  held.push(lease)
  return createChatGptCredentialStore({ path: storePath, lease })
}

describe("ChatGPT credential store - identity", () => {
  it("keeps two seats that share one accountId distinct", async () => {
    const store = await writableStore()

    store.commitAccount("seat-C0RSu9", () => account({
      accountUserId: "seat-C0RSu9",
      email: "first@example.test",
      refreshToken: "refresh-first",
    }))
    store.commitAccount("seat-zStirX", () => account({
      accountUserId: "seat-zStirX",
      email: "second@example.test",
      refreshToken: "refresh-second",
    }))

    const all = store.readAccounts()
    expect(all).toHaveLength(2)
    expect(all.map(a => a.accountId)).toEqual([SHARED_ACCOUNT_ID, SHARED_ACCOUNT_ID])

    expect(store.readAccount("seat-C0RSu9")?.refreshToken).toBe("refresh-first")
    expect(store.readAccount("seat-zStirX")?.refreshToken).toBe("refresh-second")
    expect(store.readAccount("seat-C0RSu9")?.email).toBe("first@example.test")
    expect(store.readAccount("seat-zStirX")?.email).toBe("second@example.test")
  })

  it("rotating one seat's token leaves the colliding seat untouched", async () => {
    const store = await writableStore()
    store.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" }))
    store.commitAccount("seat-zStirX", () => account({ accountUserId: "seat-zStirX" }))

    store.commitAccount("seat-C0RSu9", current => ({
      ...current!,
      refreshToken: "rotated-first",
      tokenRotatedAt: 1234,
    }))

    expect(store.readAccount("seat-C0RSu9")?.refreshToken).toBe("rotated-first")
    expect(store.readAccount("seat-C0RSu9")?.tokenRotatedAt).toBe(1234)
    expect(store.readAccount("seat-zStirX")?.refreshToken).toBe("refresh-seat-zStirX")
    expect(store.readAccount("seat-zStirX")?.tokenRotatedAt).toBeNull()
  })

  it("looking up by accountId is not offered as a way to reach a seat", async () => {
    const store = await writableStore()
    store.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" }))

    expect(store.readAccount(SHARED_ACCOUNT_ID)).toBeUndefined()
  })

  it("refuses a record whose own identity disagrees with the key it is filed under", async () => {
    const store = await writableStore()

    // Writing it anyway would file one seat's refresh token under another
    // seat's key, so the wronged seat reads a token that is not its own and
    // spends it - R7 with the two seats' roles swapped.
    expect(() => store.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-zStirX" })))
      .toThrow(AccountIdentityMismatchError)
    expect(store.readAccounts()).toEqual([])
  })
})

describe("ChatGPT credential store - durability", () => {
  it("replaces the document by rename, so a concurrent reader never sees a partial one", async () => {
    const store = await writableStore()
    store.commitAccount("seat-C0RSu9", () => account({
      accountUserId: "seat-C0RSu9",
      refreshToken: "generation-one",
    }))

    const before = statSync(storePath)
    // An fd opened on the OLD inode. POSIX keeps that inode's contents intact
    // after a rename replaces the directory entry, so this is a deterministic
    // stand-in for a reader that started before the write and finished after
    // it. An in-place rewrite would truncate what this fd can still see.
    const oldFd = openSync(storePath, "r")

    try {
      store.commitAccount("seat-C0RSu9", current => ({ ...current!, refreshToken: "generation-two" }))

      const throughOldFd = JSON.parse(readFileSync(oldFd, "utf8")) as { accounts: ChatGptAccount[] }
      expect(throughOldFd.accounts[0]!.refreshToken).toBe("generation-one")
    } finally {
      closeSync(oldFd)
    }

    expect(statSync(storePath).ino).not.toBe(before.ino)
    expect(store.readAccount("seat-C0RSu9")?.refreshToken).toBe("generation-two")
  })

  it("leaves no staging file behind", async () => {
    const store = await writableStore()
    store.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" }))

    expect(readdirSync(dir).sort()).toEqual(["chatgpt-accounts.json", "chatgpt.lock"])
  })

  it("creates the store readable only by its owner", async () => {
    const store = await writableStore()
    store.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" }))

    expect(statSync(storePath).mode & 0o777).toBe(0o600)
  })

  it("refuses a store it cannot parse instead of reporting that it owns nothing", async () => {
    const writer = await writableStore()
    writer.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" }))
    writeFileSync(storePath, "{ not json")

    // Answering "no accounts" here is the dangerous reading: the accounts are
    // still in the file, an empty answer silently flips this instance back to
    // routing GPT names at Claude (D6), and it invites a re-import that
    // overwrites the tokens that are still sitting there.
    expect(() => createChatGptCredentialStore({ path: storePath }).readAccounts())
      .toThrow(ChatGptStoreCorruptError)
  })

  it("survives a real reader process racing many commits", async () => {
    const store = await writableStore()
    store.commitAccount("seat-C0RSu9", () => account({
      accountUserId: "seat-C0RSu9",
      refreshToken: "generation-0",
    }))

    const reader = Bun.spawn({
      cmd: [process.execPath, "-e", `
        import { createChatGptCredentialStore } from ${JSON.stringify(STORE_MODULE)}
        const store = createChatGptCredentialStore({ path: ${JSON.stringify(storePath)} })
        let reads = 0
        let bad = 0
        const deadline = Date.now() + 3000
        while (Date.now() < deadline) {
          try {
            const accounts = store.readAccounts()
            if (accounts.length !== 1 || !/^generation-[0-9]+$/.test(accounts[0].refreshToken)) bad++
            reads++
          } catch {
            bad++
          }
        }
        console.log(JSON.stringify({ reads, bad }))
      `],
      stdout: "pipe",
      stderr: "pipe",
    })

    for (let generation = 1; generation <= 60; generation++) {
      store.commitAccount("seat-C0RSu9", current => ({
        ...current!,
        refreshToken: `generation-${generation}`,
      }))
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    const [exitCode, stdout, stderr] = await Promise.all([
      reader.exited,
      new Response(reader.stdout).text(),
      new Response(reader.stderr).text(),
    ])

    expect(stderr).toBe("")
    expect(exitCode).toBe(0)
    const observed = JSON.parse(stdout.trim()) as { reads: number; bad: number }
    expect(observed.bad).toBe(0)
    expect(observed.reads).toBeGreaterThan(0)
  }, 20_000)
})

describe("ChatGPT credential store - the lease is what authorizes a write", () => {
  it("refuses to write at all without a lease", () => {
    const store = createChatGptCredentialStore({ path: storePath })

    expect(() => store.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" })))
      .toThrow(WriterLeaseRequiredError)
    expect(store.readAccounts()).toEqual([])
  })

  it("refuses to write once the lease has been lost", async () => {
    const lease = await acquireWriterLease({ lockPath, staleMs: 400, heartbeatMs: 80, waitMs: 0 })
    const store = createChatGptCredentialStore({ path: storePath, lease })
    store.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" }))

    lease.release()

    // The check has to happen on THIS side of the write. A dispossessed writer
    // that notices afterwards has already overwritten whatever the new owner
    // committed, and with single-use tokens that is an account gone.
    expect(() => store.commitAccount("seat-C0RSu9", current => ({ ...current!, refreshToken: "not-mine" })))
      .toThrow()
    expect(JSON.parse(readFileSync(storePath, "utf8")).accounts[0].refreshToken)
      .toBe("refresh-seat-C0RSu9")
  })

  it("reads without a lease, because a reader spends nothing", async () => {
    const writer = await writableStore()
    writer.commitAccount("seat-C0RSu9", () => account({ accountUserId: "seat-C0RSu9" }))

    const reader = createChatGptCredentialStore({ path: storePath })
    expect(reader.readAccount("seat-C0RSu9")?.refreshToken).toBe("refresh-seat-C0RSu9")
  })

  it("reports an absent store as empty rather than failing", () => {
    const store = createChatGptCredentialStore({ path: storePath })

    expect(store.readAccounts()).toEqual([])
    expect(store.readAccount("seat-C0RSu9")).toBeUndefined()
  })
})

describe("ChatGPT credential store - never a lease-free path to a token", () => {
  it("offers exactly one door in, and it is the one that takes the lease", async () => {
    const exported = await import("../proxy/chatgpt/credentials")

    // Pinned as a whole surface rather than matched against a name pattern.
    // The property is that no SECOND way to obtain a writer exists, and a
    // pattern cannot say that: it passes for any writer whose name it happens
    // not to match, and fails for WriterLeaseRequiredError, which is an error
    // type. Everything here besides the factory is an error type.
    expect(Object.keys(exported).sort()).toEqual([
      "AccountIdentityMismatchError",
      "ChatGptStoreCorruptError",
      "WriterLeaseRequiredError",
      "createChatGptCredentialStore",
    ])
  })
})
