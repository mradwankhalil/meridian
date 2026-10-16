/**
 * Duplicate detection on import and `meridian chatgpt-migrate --reverse`,
 * against synthetic HOMEs and an empty synthetic /proc. Nothing here reads
 * the real home, the real /proc or Meridian's real settings.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { MigrateUsageError, parseMigrateArgs, resolveInstancePaths } from "../proxy/chatgpt/migrate/cli"
import { findDuplicate, planImportNaming, possibleDuplicateName } from "../proxy/chatgpt/migrate/duplicates"
import { mergeIntoPluginStore, PluginStoreFormatError } from "../proxy/chatgpt/migrate/handback"
import { findMeridianInstance } from "../proxy/chatgpt/migrate/instance"
import { ACCOUNTS_FILE_NAME, type MigrationEnvironment } from "../proxy/chatgpt/migrate/layout"
import { runMigration, type ChatGptStoreAdapter, type ImportAccount, type MigrationOptions } from "../proxy/chatgpt/migrate/migrate"
import { addPluginEntry, pointProviderAtMeridian, providerBefore, removePluginEntries, restoreProvider } from "../proxy/chatgpt/migrate/opencodeConfig"
import { createOwnedStoreAdapter } from "../proxy/chatgpt/migrate/ownedStore"
import { DEFAULT_PLUGIN_SPEC, runReverseMigration, type ReverseOptions } from "../proxy/chatgpt/migrate/reverse"
import type { MeridianHeldAccount } from "../proxy/chatgpt/migrate/strip"
import { changedFromPluginConfig } from "../proxy/chatgpt/migrate/processes"
import { createChatGptCredentialStore } from "../proxy/chatgpt/credentials"
import { acquireWriterLease } from "../proxy/chatgpt/lease"
import { chatGptLockPath } from "../proxy/chatgpt/paths"

let root: string
let home: string
let env: MigrationEnvironment
let procRoot: string

function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`
}

function accessToken(seat: string, workspace: string, iat: number): string {
  return jwt({ iat, "https://api.openai.com/auth": { chatgpt_account_user_id: seat, chatgpt_account_id: workspace } })
}

function account(seat: string, refresh: string, rotatedAt: number, extra: Record<string, unknown> = {}) {
  const workspace = (extra.accountId as string | undefined) ?? `ws-${seat}-000abc`
  return {
    accountId: workspace,
    accountUserId: seat,
    email: `${seat}@example.test`,
    refreshToken: refresh,
    accessToken: accessToken(seat, workspace, Math.floor(rotatedAt / 1000)),
    expiresAt: rotatedAt + 3_600_000,
    tokenRotatedAt: rotatedAt,
    addedAt: 1,
    lastUsed: 1,
    ...extra,
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

function store(accounts: unknown[]) {
  return { version: 3, activeIndex: 0, accounts }
}

function heldSeat(seat: string, refresh: string, extra: Partial<MeridianHeldAccount> = {}): MeridianHeldAccount {
  return { accountUserId: seat, accountId: `ws-${seat}-000abc`, email: `${seat}@example.test`, refreshToken: refresh, accessToken: null, tokenRotatedAt: 5, expiresAt: null, ...extra }
}

/** A Meridian store with profile names, as the forward and reverse paths see it. */
class MemoryStore implements ChatGptStoreAdapter {
  readonly storePath: string
  held: MeridianHeldAccount[] = []
  names: Record<string, string> = {}
  constructor(path: string) { this.storePath = path }
  readHeld() { return this.held }
  profileNames() { return this.names }
  reservedProfileIds() { return new Set(["default"]) }
  saveProfileNames(names: ReadonlyMap<string, string>) { this.names = { ...this.names, ...Object.fromEntries(names) } }
  async importAccounts(accounts: readonly ImportAccount[]) {
    for (const incoming of accounts) {
      this.held = this.held.filter(existing => existing.accountUserId !== incoming.accountUserId)
      this.held.push({ ...incoming })
    }
  }
}

beforeEach(() => {
  const base = process.env.TMPDIR || tmpdir()
  mkdirSync(base, { recursive: true })
  root = mkdtempSync(join(base, "chatgpt-reverse-"))
  home = join(root, "home")
  mkdirSync(home, { recursive: true })
  procRoot = join(root, "proc")
  mkdirSync(procRoot, { recursive: true })
  env = { home, managedConfigDir: join(root, "managed") }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function forwardOptions(overrides: Partial<MigrationOptions>, lines: string[]): MigrationOptions {
  return {
    env, steps: ["import"], dryRun: false, force: false, providerId: "openai", baseURL: "http://127.0.0.1:3459/v1",
    apiKey: "meridian", projectDirs: [], opencodeDatabasePath: null, includeBackupOnly: false, testPrompt: false,
    store: null, keychain: null, procRoot, now: () => new Date("2026-10-02T20:00:00Z"), log: line => lines.push(line), ...overrides,
  }
}

function reverseOptions(overrides: Partial<ReverseOptions>, lines: string[]): ReverseOptions {
  return {
    env, steps: ["processes", "handback", "plugin", "provider", "verify"], dryRun: false, force: false, seats: [],
    pluginStorePath: null, pluginPath: null, providerId: "openai", baseURL: "http://127.0.0.1:3459/v1", apiKey: "meridian",
    projectDirs: [], opencodeDatabasePath: null, store: null, procRoot, lockWaitMs: 200,
    now: () => new Date("2026-10-02T21:00:00Z"), log: line => lines.push(line), ...overrides,
  }
}

describe("duplicate detection", () => {
  const ids = new Map([["alice", "alice-000abc"], ["bob", "bob-000abc"]])
  const held = [
    { accountUserId: "alice", accountId: "ws-shared", email: "Alice@Example.test" },
    { accountUserId: "bob", accountId: "ws-shared", email: "bob@example.test" },
  ]

  it("knows the same seat by its user id and nothing else", () => {
    expect(findDuplicate({ accountUserId: "alice", accountId: "ws-other", email: null }, held, ids)).toEqual({ kind: "same-seat", profileId: "alice-000abc" })
  })

  it("flags another user id with the same email in the same workspace", () => {
    expect(findDuplicate({ accountUserId: "alice-2", accountId: "ws-shared", email: "alice@example.test" }, held, ids))
      .toEqual({ kind: "possible", profileId: "alice-000abc", seat: "alice" })
  })

  it("does not treat email alone, or workspace alone, as identity", () => {
    expect(findDuplicate({ accountUserId: "alice-2", accountId: "ws-personal", email: "alice@example.test" }, held, ids)).toBeNull()
    expect(findDuplicate({ accountUserId: "carol", accountId: "ws-shared", email: "carol@example.test" }, held, ids)).toBeNull()
    expect(findDuplicate({ accountUserId: "anon", accountId: "ws-shared", email: null }, held, ids)).toBeNull()
  })

  it("names a possible duplicate as a valid profile id of at most 64 characters", () => {
    expect(possibleDuplicateName("alice-1b2c3d", "alice-000abc")).toBe("alice-1b2c3d-possibly-duplicate-of-alice-000abc")
    const long = possibleDuplicateName("a-very-long-mailbox-name-for-testing-1b2c3d", "another-very-long-mailbox-name-000abc")
    expect(long.length).toBeLessThanOrEqual(64)
    expect(long).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/)
    expect(long).toContain("-dup-of-")
  })

  it("plans names: the importer's derived name, flagged, unless the operator named the seat", () => {
    const naming = planImportNaming({
      held: [{ accountUserId: "user-1__ws-shared", accountId: "ws-shared", email: "alice@example.test" }],
      incoming: [
        { accountUserId: "user-2__ws-shared", accountId: "ws-shared", email: "alice@example.test" },
        { accountUserId: "user-3__ws-shared", accountId: "ws-shared", email: "alice@example.test" },
        { accountUserId: "user-9__ws-elsewh", accountId: "ws-elsewh", email: "alice@example.test" },
      ],
      names: { "user-3__ws-shared": "alice-chosen" },
    })
    const held = naming.ids.get("user-1__ws-shared")!
    expect(held).toBe("alice-shared")
    expect(naming.names.get("user-2__ws-shared")).toBe(`${naming.derived.get("user-2__ws-shared")}-possibly-duplicate-of-${held}`)
    expect(naming.names.has("user-3__ws-shared")).toBe(false)
    expect(naming.ids.get("user-3__ws-shared")).toBe("alice-chosen")
    expect(naming.matches.has("user-9__ws-elsewh")).toBe(false)
  })
})

describe("import with duplicates", () => {
  function seed(memory: MemoryStore) {
    memory.held = [heldSeat("user-1__ws-shared", "rt-SECRET-held-1", { accountId: "ws-shared", email: "alice@example.test", tokenRotatedAt: 5_000_000 })]
    writeJson(join(home, ".opencode", ACCOUNTS_FILE_NAME), store([
      account("user-2__ws-shared", "rt-SECRET-new-2", 2_000_000, { accountId: "ws-shared", email: "alice@example.test" }),
      account("user-1__ws-shared", "rt-SECRET-held-0", 1_000, { accountId: "ws-shared", email: "alice@example.test" }),
    ]))
  }

  it("shows each duplicate in the dry run and writes nothing", async () => {
    const memory = new MemoryStore(join(root, "meridian.json"))
    seed(memory)
    const lines: string[] = []
    await runMigration(forwardOptions({ dryRun: true, store: memory }, lines))
    const output = lines.join("\n")
    expect(output).toMatch(/would import alice@example\.test \(user-2__ws-shared\) as alice-shared-[0-9a-f]+-possibly-duplicate-of-alice-shared: "alice-shared-[0-9a-f]+ \(possibly duplicate of alice-shared\)"/)
    expect(output).toMatch(/keep alice@example\.test \(user-1__ws-shared\): Meridian's copy \(alice-shared\) is newer/)
    expect(output).not.toContain("rt-SECRET")
    expect(memory.held).toHaveLength(1)
    expect(memory.names).toEqual({})
  })

  it("imports a possible duplicate under its flagged name, and the same seat into its one record", async () => {
    const memory = new MemoryStore(join(root, "meridian.json"))
    seed(memory)
    const lines: string[] = []
    expect((await runMigration(forwardOptions({ store: memory }, lines))).exitCode).toBe(0)
    expect(memory.held.map(seat => seat.accountUserId).sort()).toEqual(["user-1__ws-shared", "user-2__ws-shared"])
    expect(memory.held.find(seat => seat.accountUserId === "user-1__ws-shared")!.refreshToken).toBe("rt-SECRET-held-1")
    expect(memory.names["user-2__ws-shared"]).toMatch(/-possibly-duplicate-of-alice-shared$/)
    expect(lines.join("\n")).toContain("Named 1 possible duplicate(s)")
  })

  it("skips possible duplicates when asked", async () => {
    const memory = new MemoryStore(join(root, "meridian.json"))
    seed(memory)
    const lines: string[] = []
    await runMigration(forwardOptions({ store: memory, skipPossibleDuplicates: true }, lines))
    expect(memory.held).toHaveLength(1)
    expect(lines.join("\n")).toContain("skip alice@example.test (user-2__ws-shared): possibly a duplicate of alice-shared (")
  })

  it("never gives two profiles one refresh token", async () => {
    const memory = new MemoryStore(join(root, "meridian.json"))
    memory.held = [heldSeat("user-1__ws-shared", "rt-SECRET-shared", { accountId: "ws-shared" })]
    writeJson(join(home, ".opencode", ACCOUNTS_FILE_NAME), store([account("user-2__ws-shared", "rt-SECRET-shared", 2_000_000, { accountId: "ws-shared" })]))
    const lines: string[] = []
    await runMigration(forwardOptions({ store: memory }, lines))
    expect(memory.held).toHaveLength(1)
    expect(lines.join("\n")).toContain("two profiles must not renew one token")
  })
})

describe("plugin store merge", () => {
  const storePath = "/virtual/oc-codex-multi-auth-accounts.json"
  const records = [
    account("alice", "rt-SECRET-alice-1", 1_000_000, { accountTags: ["work"], enabled: true }),
    account("bob", "rt-SECRET-bob-1", 1_000_000, { enabled: false }),
  ]
  const original = store(records)
  const stripped = JSON.stringify(store(records.map(({ refreshToken: _, ...rest }) => rest)), null, 2)
  const backups = [{ path: `${storePath}.meridian-backup`, raw: JSON.stringify(original, null, 2) }]

  it("restores an original whose token Meridian never renewed, whole", () => {
    const merged = mergeIntoPluginStore({ storePath, currentRaw: stripped, backups, seats: [heldSeat("alice", "rt-SECRET-alice-1"), heldSeat("bob", "rt-SECRET-bob-1")], now: 9 })
    expect(JSON.parse(merged.text)).toEqual(original)
    expect(merged.outcomes.map(outcome => outcome.action)).toEqual(["restored-from-backup", "restored-from-backup"])
  })

  it("lays a renewed token over the plugin's record and keeps its metadata", () => {
    const merged = mergeIntoPluginStore({ storePath, currentRaw: stripped, backups, seats: [heldSeat("alice", "rt-SECRET-alice-2", { tokenRotatedAt: 7 })], now: 9 })
    const accounts = JSON.parse(merged.text).accounts
    expect(accounts[0]).toMatchObject({ accountUserId: "alice", refreshToken: "rt-SECRET-alice-2", tokenRotatedAt: 7, accountTags: ["work"] }) // gitleaks:allow - synthetic test fixture, not a credential
    expect(accounts[0].accessToken).toBeUndefined()
    expect(accounts[1].refreshToken).toBeUndefined()
    expect(merged.outcomes[0]!.action).toBe("updated")
  })

  it("adds a seat the plugin never had and keeps every other account", () => {
    const merged = mergeIntoPluginStore({ storePath, currentRaw: JSON.stringify(original), backups: [], seats: [heldSeat("carol", "rt-SECRET-carol-1")], now: 9 })
    const accounts = JSON.parse(merged.text).accounts
    expect(accounts.map((entry: { accountUserId: string }) => entry.accountUserId)).toEqual(["alice", "bob", "carol"])
    expect(accounts.slice(0, 2)).toEqual(original.accounts)
    expect(accounts[2]).toMatchObject({ refreshToken: "rt-SECRET-carol-1", addedAt: 9, lastUsed: 9, enabled: true }) // gitleaks:allow - synthetic test fixture, not a credential
  })

  it("refuses a store format it does not write", () => {
    expect(() => mergeIntoPluginStore({ storePath, currentRaw: JSON.stringify({ version: 1, accounts: [] }), backups: [], seats: [], now: 9 }))
      .toThrow(PluginStoreFormatError)
  })
})

describe("config edits", () => {
  it("removes the plugin when it is the last entry of an inline list", () => {
    for (const text of [`{ "plugin": ["a", "oc-codex-multi-auth@6"] }`, `{\n  "plugin": [\n    "a",\n    "oc-codex-multi-auth"\n  ]\n}\n`, `{ "plugin": ["oc-codex-multi-auth", "a"] }`]) {
      const edit = removePluginEntries(text, "/x/opencode.json")
      expect(parseJsonc(edit.text).plugin).toEqual(["a"])
    }
  })

  it("puts the plugin back at its old position and replaces a spec only on request", () => {
    const text = `{\n  // keep me\n  "plugin": ["a", "b"]\n}\n`
    const added = addPluginEntry(text, "/x/opencode.jsonc", "oc-codex-multi-auth@6", { index: 1 })
    expect(parseJsonc(added.text).plugin).toEqual(["a", "oc-codex-multi-auth@6", "b"])
    expect(added.text).toContain("// keep me")
    expect(addPluginEntry(added.text, "/x/opencode.jsonc", "file:///repo").outcome).toBe("present")
    const replaced = addPluginEntry(added.text, "/x/opencode.jsonc", "file:///repo", { replace: true })
    expect(parseJsonc(replaced.text).plugin).toEqual(["a", "file:///repo", "b"])
    expect(replaced.previousSpec).toBe("oc-codex-multi-auth@6")
    expect(parseJsonc(addPluginEntry("{}", "/x/opencode.json", "oc-codex-multi-auth@latest").text).plugin).toEqual(["oc-codex-multi-auth@latest"])
  })

  it("undoes the provider step exactly, keeping a key the operator set", () => {
    const meridian = "http://127.0.0.1:3459/v1"
    const fresh = `{\n  "model": "x"\n}\n`
    const pointed = pointProviderAtMeridian(fresh, "/x/c.json", { providerId: "openai", baseURL: meridian, apiKey: "meridian" }).text
    const undone = restoreProvider(pointed, "/x/c.json", { providerId: "openai", meridianBaseURL: meridian, placeholderApiKey: "meridian", before: providerBefore(fresh, "/x/c.json", "openai") })
    expect(parseJsonc(undone.text)).toEqual({ model: "x" })

    const custom = `{ "provider": { "openai": { "options": { "baseURL": "https://gw.example/v1", "apiKey": "{env:K}" } } } }`
    const repointed = pointProviderAtMeridian(custom, "/x/c.json", { providerId: "openai", baseURL: meridian, apiKey: "meridian" }).text
    const back = restoreProvider(repointed, "/x/c.json", { providerId: "openai", meridianBaseURL: meridian, placeholderApiKey: "meridian", before: providerBefore(custom, "/x/c.json", "openai") })
    expect(parseJsonc(back.text)).toEqual(parseJsonc(custom))
    expect(back.apiKeyRemoved).toBe(false)

    expect(restoreProvider(custom, "/x/c.json", { providerId: "openai", meridianBaseURL: meridian, placeholderApiKey: "meridian", before: null }).outcome).toBe("not-meridian")
  })
})

describe("round trip: forward, then --reverse", () => {
  const configPath = () => join(home, ".config", "opencode", "opencode.jsonc")
  const pluginStore = () => join(home, ".opencode", ACCOUNTS_FILE_NAME)
  const meridianStore = () => join(root, "meridian", "chatgpt-accounts.json")
  const configText = `{\n  // operator notes\n  "plugin": ["some-plugin", "oc-codex-multi-auth@6"],\n  "provider": { "openai2": { "options": { "apiKey": "{env:OPENAI_API_KEY}" } } }\n}\n`
  const adapter = (names: Record<string, string> = {}) => createOwnedStoreAdapter({
    storePath: meridianStore(),
    meridianUrl: "http://127.0.0.1:1",
    settings: {
      names: () => names,
      reserved: () => new Set(["default"]),
      saveNames: incoming => Object.assign(names, Object.fromEntries(incoming)),
    },
  })

  function seedPlugin() {
    writeJson(pluginStore(), store([
      account("alice", "rt-SECRET-alice-1", 2_000_000, { accountTags: ["work"] }),
      account("bob", "rt-SECRET-bob-1", 1_000_000, { enabled: false }),
    ]))
    writeJson(join(home, ".opencode", "backups", "snapshot-1.json"), store([account("alice", "rt-SECRET-alice-0", 1_000)]))
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(configPath(), configText)
    return readFileSync(pluginStore(), "utf8")
  }

  async function forward() {
    const lines: string[] = []
    const result = await runMigration(forwardOptions({ steps: ["import", "strip", "plugin", "provider"], store: adapter() }, lines))
    expect({ exitCode: result.exitCode, output: result.exitCode === 0 ? "" : lines.join("\n") }).toEqual({ exitCode: 0, output: "" })
    expect(readFileSync(pluginStore(), "utf8")).not.toContain("rt-SECRET")
    expect(readFileSync(configPath(), "utf8")).not.toContain("oc-codex-multi-auth")
  }

  it("dry run plans everything and writes nothing", async () => {
    seedPlugin()
    await forward()
    const before = new Map(readdirSync(join(home, ".opencode")).map(name => [name, statSync(join(home, ".opencode", name)).mtimeMs]))
    const config = readFileSync(configPath(), "utf8")
    const lines: string[] = []
    await runReverseMigration(reverseOptions({ dryRun: true, store: adapter() }, lines))
    const output = lines.join("\n")
    expect(output).toContain("would hand back alice-")
    expect(output).toContain("restore its original record from")
    expect(output).toContain("would add oc-codex-multi-auth@6 to")
    expect(output).toContain("would remove provider.openai.options.baseURL")
    expect(output).not.toContain("rt-SECRET")
    expect(readFileSync(configPath(), "utf8")).toBe(config)
    expect(new Map(readdirSync(join(home, ".opencode")).map(name => [name, statSync(join(home, ".opencode", name)).mtimeMs]))).toEqual(before)
    expect(createChatGptCredentialStore({ path: meridianStore() }).readAccounts()).toHaveLength(2)
  })

  it("brings the plugin store and the config back equivalent, and leaves Meridian holding nothing", async () => {
    const originalStore = seedPlugin()
    await forward()
    const lines: string[] = []
    const result = await runReverseMigration(reverseOptions({ store: adapter() }, lines))
    const output = lines.join("\n")

    expect({ exitCode: result.exitCode, output: result.exitCode === 0 ? "" : output }).toEqual({ exitCode: 0, output: "" })
    expect(output).not.toContain("rt-SECRET")
    expect(JSON.parse(readFileSync(pluginStore(), "utf8"))).toEqual(JSON.parse(originalStore))
    expect(statSync(pluginStore()).mode & 0o777).toBe(0o600)
    expect(createChatGptCredentialStore({ path: meridianStore() }).readAccounts()).toEqual([])
    const config = readFileSync(configPath(), "utf8")
    expect(config).toContain("// operator notes")
    expect(parseJsonc(config)).toEqual(parseJsonc(configText))
    expect(output).toContain("2 seat(s) renewed by the plugin")
    expect(output).toContain("0 by Meridian, 0 by both")
    // The old store was kept, not clobbered.
    expect(readdirSync(join(home, ".opencode")).some(name => name.startsWith(`${ACCOUNTS_FILE_NAME}.meridian-backup.`))).toBe(true)
  })

  it("hands back a seat Meridian renewed with its new token, and only the seats asked for", async () => {
    seedPlugin()
    await forward()
    const lease = await acquireWriterLease({ lockPath: chatGptLockPath(meridianStore()), waitMs: 0 })
    createChatGptCredentialStore({ path: meridianStore(), lease }).commitAccount("alice", current => ({ ...current!, refreshToken: "rt-SECRET-alice-2", tokenRotatedAt: 3_000_000 })) // gitleaks:allow - synthetic test fixture, not a credential
    lease.release()

    const names: Record<string, string> = { alice: "alice-work" }
    const lines: string[] = []
    const result = await runReverseMigration(reverseOptions({ steps: ["handback"], seats: ["alice-work"], store: adapter(names) }, lines))
    expect(result.exitCode).toBe(0)
    const accounts = JSON.parse(readFileSync(pluginStore(), "utf8")).accounts
    expect(accounts[0]).toMatchObject({ accountUserId: "alice", refreshToken: "rt-SECRET-alice-2", accountTags: ["work"] }) // gitleaks:allow - synthetic test fixture, not a credential
    expect(accounts[1].refreshToken).toBeUndefined()
    expect(createChatGptCredentialStore({ path: meridianStore() }).readAccounts().map(seat => seat.accountUserId)).toEqual(["bob"])
    expect(lines.join("\n")).toContain("lay Meridian's current token over")
  })

  it("refuses while a running Meridian holds the writer lease, and changes nothing", async () => {
    seedPlugin()
    await forward()
    const stripped = readFileSync(pluginStore(), "utf8")
    const lease = await acquireWriterLease({ lockPath: chatGptLockPath(meridianStore()), waitMs: 0 })
    try {
      const lines: string[] = []
      const result = await runReverseMigration(reverseOptions({ steps: ["handback"], store: adapter() }, lines))
      expect(result.exitCode).toBe(1)
      expect(lines.join("\n")).toContain("A running Meridian holds the ChatGPT writer lease")
      expect(readFileSync(pluginStore(), "utf8")).toBe(stripped)
    } finally {
      lease.release()
    }
    expect(createChatGptCredentialStore({ path: meridianStore() }).readAccounts()).toHaveLength(2)
  })

  it("skips a seat whose renewal was interrupted, under --force too, unless --include-interrupted", async () => {
    seedPlugin()
    await forward()
    const lease = await acquireWriterLease({ lockPath: chatGptLockPath(meridianStore()), waitMs: 0 })
    createChatGptCredentialStore({ path: meridianStore(), lease }).commitAccount("bob", current => ({ ...current!, exchangeStartedAt: 5 }))
    lease.release()
    const lines: string[] = []
    const result = await runReverseMigration(reverseOptions({ steps: ["handback"], force: true, store: adapter() }, lines))
    expect(result.exitCode).toBe(1)
    expect(lines.join("\n")).toContain("a renewal was interrupted")
    expect(createChatGptCredentialStore({ path: meridianStore() }).readAccounts().map(seat => seat.accountUserId)).toEqual(["bob"])

    const included: string[] = []
    expect((await runReverseMigration(reverseOptions({ steps: ["handback"], includeInterrupted: true, store: adapter() }, included))).exitCode).toBe(0)
    expect(createChatGptCredentialStore({ path: meridianStore() }).readAccounts()).toEqual([])
  })

  it("loads the plugin from a checkout with --plugin-path", async () => {
    seedPlugin()
    await forward()
    const repo = join(root, "forks", "oc-codex-multi-auth")
    mkdirSync(join(repo, "dist"), { recursive: true })
    writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "oc-codex-multi-auth" }))
    writeFileSync(join(repo, "dist", "index.js"), "")
    const lines: string[] = []
    expect((await runReverseMigration(reverseOptions({ steps: ["plugin"], pluginPath: repo }, lines))).exitCode).toBe(0)
    expect(parseJsonc(readFileSync(configPath(), "utf8")).plugin).toEqual(["some-plugin", `file://${repo}`])

    const wrong = join(root, "not-the-plugin")
    mkdirSync(wrong, { recursive: true })
    writeFileSync(join(wrong, "package.json"), JSON.stringify({ name: "something-else" }))
    const refused: string[] = []
    expect((await runReverseMigration(reverseOptions({ steps: ["plugin"], pluginPath: wrong }, refused))).exitCode).toBe(1)
    expect(refused.join("\n")).toContain("not oc-codex-multi-auth")
  })

  it("falls back to the published package when no preserved config names one, TUI status bar included", async () => {
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(join(home, ".config", "opencode", "opencode.json"), `{ "plugin": [] }`)
    const lines: string[] = []
    expect((await runReverseMigration(reverseOptions({ steps: ["plugin"] }, lines))).exitCode).toBe(0)
    expect(parseJsonc(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8")).plugin).toEqual([DEFAULT_PLUGIN_SPEC])
    expect(existsSync(join(home, ".config", "opencode", "opencode.jsonc"))).toBe(false)
    expect(parseJsonc(readFileSync(join(home, ".config", "opencode", "tui.json"), "utf8")).plugin).toEqual([DEFAULT_PLUGIN_SPEC])
  })

  it("removes the TUI status bar going forward and puts it back where it was", async () => {
    seedPlugin()
    const tuiPath = join(home, ".config", "opencode", "tui.json")
    const tuiText = `{\n  "$schema": "https://opencode.ai/tui.json",\n  "plugin": ["oc-codex-multi-auth@6", "other-tui-plugin"]\n}\n`
    writeFileSync(tuiPath, tuiText)
    await forward()
    expect(parseJsonc(readFileSync(tuiPath, "utf8")).plugin).toEqual(["other-tui-plugin"])

    const lines: string[] = []
    expect((await runReverseMigration(reverseOptions({ store: adapter() }, lines))).exitCode).toBe(0)
    expect(parseJsonc(readFileSync(tuiPath, "utf8"))).toEqual(parseJsonc(tuiText))
    expect(lines.join("\n")).toContain("opencode's global TUI config loads the plugin's status bar")
  })
})

describe("a config file that changed after a process started", () => {
  const started = 1_700_000_000_000
  const at = (path: string, ms: number) => utimesSync(path, ms / 1000, ms / 1000)
  let config: string

  beforeEach(() => {
    config = join(home, ".config", "opencode", "opencode.jsonc")
    mkdirSync(join(config, ".."), { recursive: true })
    writeFileSync(config, `{ "plugin": ["other-plugin"] }`)
    at(config, started + 60_000)
  })

  function backup(suffix: string, text: string, takenAt: number) {
    const path = `${config}.meridian-backup${suffix}`
    writeFileSync(path, text)
    at(path, takenAt)
  }

  it("is a holder's when the plugin was removed after it started", () => {
    backup("", `{ "plugin": ["other-plugin", "oc-codex-multi-auth"] }`, started + 30_000)
    expect(changedFromPluginConfig([config], started)).toBe(true)
  })

  it("is not when the plugin was removed before it started and the file changed for another reason", () => {
    backup("", `{ "plugin": ["other-plugin", "oc-codex-multi-auth"] }`, started - 30_000)
    backup(".20261002T224213Z", `{ "plugin": ["older-other-plugin"] }`, started + 30_000)
    expect(changedFromPluginConfig([config], started)).toBe(false)
  })

  it("is not when the migration only ever saw the file without the plugin", () => {
    backup("", `{ "model": "x" }`, started + 30_000)
    expect(changedFromPluginConfig([config], started)).toBe(false)
  })

  it("is unknown, and so counts, without any backup; and never when the file did not change", () => {
    expect(changedFromPluginConfig([config], started)).toBe(true)
    at(config, started - 1_000)
    expect(changedFromPluginConfig([config], started)).toBe(false)
  })
})

describe("--force overrides the process gate and nothing else", () => {
  function holder() {
    writeFileSync(join(procRoot, "stat"), "btime 1700000000\n")
    const dir = join(procRoot, "200")
    mkdirSync(dir)
    symlinkSync("/usr/bin/opencode", join(dir, "exe"))
    symlinkSync(root, join(dir, "cwd"))
    writeFileSync(join(dir, "cmdline"), "opencode\0")
    writeFileSync(join(dir, "environ"), `HOME=${home}\0`)
    writeFileSync(join(dir, "stat"), `200 (opencode) S 1 ${Array.from({ length: 17 }, () => "0").join(" ")} 100\n`)
  }

  function seed() {
    writeJson(join(home, ".opencode", ACCOUNTS_FILE_NAME), store([account("alice", "rt-SECRET-alice-1", 2_000_000)]))
    mkdirSync(join(home, ".config", "opencode"), { recursive: true })
    writeFileSync(join(home, ".config", "opencode", "opencode.json"), `{ "plugin": ["oc-codex-multi-auth"] }`)
  }

  it("a forced strip still refuses a seat Meridian does not hold; --strip-unowned strips it", async () => {
    seed()
    holder()
    const pluginStore = join(home, ".opencode", ACCOUNTS_FILE_NAME)
    const memory = new MemoryStore(join(root, "meridian.json"))
    const lines: string[] = []
    const result = await runMigration(forwardOptions({ steps: ["processes", "strip"], force: true, store: memory }, lines))
    expect(result.exitCode).toBe(1)
    expect(lines.join("\n")).toContain("--force: running strip anyway")
    expect(lines.join("\n")).toContain("--strip-unowned strips them anyway")
    expect(readFileSync(pluginStore, "utf8")).toContain("rt-SECRET-alice-1")

    const unowned: string[] = []
    await runMigration(forwardOptions({ steps: ["strip"], force: true, stripUnowned: true, store: memory }, unowned))
    expect(unowned.join("\n")).toContain("--strip-unowned overrides")
    expect(readFileSync(pluginStore, "utf8")).not.toContain("rt-SECRET")
  })

  it("a forced run that succeeds exits 0, holders reported; unforced, the processes step fails it", async () => {
    seed()
    holder()
    const memory = new MemoryStore(join(root, "meridian.json"))
    const forced: string[] = []
    expect((await runMigration(forwardOptions({ steps: ["processes", "import", "strip"], force: true, store: memory }, forced))).exitCode).toBe(0)
    expect(forced.join("\n")).toContain("pid 200 opencode")
    expect(forced.join("\n")).toContain("--force: continuing past them.")

    const plain: string[] = []
    expect((await runMigration(forwardOptions({ steps: ["processes"], store: memory }, plain))).exitCode).toBe(1)
  })
})

describe("the Meridian instance behind --meridian-url", () => {
  function fakeProcess(pid: number, argv: string[], cwd: string, environ: Record<string, string>) {
    const dir = join(procRoot, String(pid))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "cmdline"), `${argv.join("\0")}\0`)
    writeFileSync(join(dir, "environ"), `${Object.entries(environ).map(([key, value]) => `${key}=${value}`).join("\0")}\0`)
    symlinkSync(cwd, join(dir, "cwd"))
  }

  function checkout(): string {
    const dir = join(root, "meridian-checkout")
    mkdirSync(join(dir, "bin"), { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@rynfar/meridian" }))
    writeFileSync(join(dir, "bin", "cli.ts"), "")
    return dir
  }

  it("finds the server on the URL's port and derives its store and config directory", () => {
    const dir = checkout()
    const isolated = join(root, "isolated-home")
    fakeProcess(10, ["/usr/bin/bun", "run", "./bin/cli.ts"], dir, { HOME: isolated, MERIDIAN_PORT: "3459", MERIDIAN_CHATGPT_STORE_PATH: "/srv/gpt/chatgpt-accounts.json", MERIDIAN_API_KEY: "not-read" })
    fakeProcess(11, ["/usr/bin/bun", "run", "./bin/cli.ts", "chatgpt-migrate", "--dry-run"], dir, { HOME: home, MERIDIAN_PORT: "3459" })
    fakeProcess(12, ["/usr/bin/bun", "run", "./bin/cli.ts"], dir, { HOME: home })

    expect(findMeridianInstance("http://127.0.0.1:3459", { procRoot, selfPid: 1 }))
      .toEqual({ pid: 10, port: "3459", configDir: join(isolated, ".config", "meridian"), storePath: "/srv/gpt/chatgpt-accounts.json" })
    expect(findMeridianInstance("http://127.0.0.1:3456", { procRoot, selfPid: 1 })).toMatchObject({ pid: 12, storePath: join(home, ".config", "meridian", "chatgpt-accounts.json") })
    expect(findMeridianInstance("http://127.0.0.1:3460", { procRoot, selfPid: 1 })).toBeNull()
  })

  it("ignores a process that is not Meridian", () => {
    const other = join(root, "other")
    mkdirSync(join(other, "bin"), { recursive: true })
    writeFileSync(join(other, "package.json"), JSON.stringify({ name: "something-else" }))
    writeFileSync(join(other, "bin", "cli.ts"), "")
    fakeProcess(20, ["/usr/bin/bun", "run", "./bin/cli.ts"], other, { HOME: home })
    expect(findMeridianInstance("http://127.0.0.1:3456", { procRoot, selfPid: 1 })).toBeNull()
  })

  it("takes flags, then explicit shell variables, then the instance, then the defaults", () => {
    const instance = { pid: 10, port: "3459", configDir: "/inst/config", storePath: "/inst/store.json" }
    const unset = { configDir: null, storePath: null, defaultConfigDir: "/home/.config/meridian" }
    const url = "http://127.0.0.1:3459"
    const none = { storePath: null, configDir: null, meridianUrl: url }
    expect(resolveInstancePaths(none, instance, unset)).toMatchObject({ storePath: "/inst/store.json", configDir: "/inst/config" })
    expect(resolveInstancePaths(none, null, unset)).toMatchObject({ storePath: "/home/.config/meridian/chatgpt-accounts.json", configDir: null })

    const flagged = resolveInstancePaths({ ...none, storePath: "/flag/store.json" }, instance, unset)
    expect(flagged).toMatchObject({ storePath: "/flag/store.json", configDir: "/inst/config" })
    expect(flagged.notes.join("\n")).toContain("that instance will not see what is written there")

    const shell = resolveInstancePaths(none, instance, { ...unset, configDir: "/sandbox" })
    expect(shell).toMatchObject({ storePath: "/sandbox/chatgpt-accounts.json", configDir: "/sandbox" })
    expect(resolveInstancePaths({ ...none, configDir: "/inst/config" }, instance, unset)).toMatchObject({ storePath: "/inst/store.json" })

    const stopped = resolveInstancePaths({ ...none, configDir: "/flag/config" }, null, unset)
    expect(stopped).toMatchObject({ storePath: "/flag/config/chatgpt-accounts.json", configDir: "/flag/config" })
    expect(stopped.notes.join("\n")).toContain("pass --store and --config-dir")
  })
})

describe("chatgpt-migrate --reverse arguments", () => {
  it("parses reverse steps and options", () => {
    const parsed = parseMigrateArgs(["--reverse", "--step", "handback,plugin", "--seat", "alice-work", "--plugin-path", "/repo", "--plugin-store", "/s.json"], {})
    expect(parsed.reverse).toBe(true)
    expect(parsed.reverseSteps).toEqual(["handback", "plugin"])
    expect(parsed.seats).toEqual(["alice-work"])
    expect(parsed.pluginPath).toBe("/repo")
    expect(parsed.pluginStorePath).toBe("/s.json")
    expect(parseMigrateArgs(["--reverse"], {}).reverseSteps).toHaveLength(5)
    expect(parseMigrateArgs(["--skip-possible-duplicates"], {}).skipPossibleDuplicates).toBe(true)
    expect(parseMigrateArgs(["--strip-unowned"], {}).stripUnowned).toBe(true)
    expect(parseMigrateArgs(["--reverse", "--include-interrupted"], {}).includeInterrupted).toBe(true)
  })

  it("rejects options and steps of the other direction", () => {
    expect(() => parseMigrateArgs(["--plugin-path", "/repo"], {})).toThrow(MigrateUsageError)
    expect(() => parseMigrateArgs(["--reverse", "--strip-unowned"], {})).toThrow(MigrateUsageError)
    expect(() => parseMigrateArgs(["--include-interrupted"], {})).toThrow(MigrateUsageError)
    expect(() => parseMigrateArgs(["--reverse", "--skip-possible-duplicates"], {})).toThrow(MigrateUsageError)
    expect(() => parseMigrateArgs(["--reverse", "--step", "import"], {})).toThrow(MigrateUsageError)
    expect(() => parseMigrateArgs(["--step", "handback"], {})).toThrow(MigrateUsageError)
  })
})
