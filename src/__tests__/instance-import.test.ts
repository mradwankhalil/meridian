import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "libsql"
import { createChatGptCredentialStore, type ChatGptAccount } from "../proxy/chatgpt/credentials"
import { acquireWriterLease, type WriterLease } from "../proxy/chatgpt/lease"
import { chatGptLockPath } from "../proxy/chatgpt/paths"
import { parseInstanceImportArgs, InstanceImportUsageError } from "../proxy/instanceImport/cli"
import { runInstanceImport, type InstancePaths } from "../proxy/instanceImport/importer"
import { copyTelemetry, readTelemetry, verifyTelemetry } from "../proxy/instanceImport/telemetry"
import { createSqliteStores } from "../telemetry/sqlite"
import type { RequestMetric } from "../telemetry/types"

const HOUR = 60 * 60 * 1000
// Every case does real file, lease and SQLite work.
const TIMEOUT = 60_000
const STAMP = new Date("2026-10-08T12:00:00.000Z")
const RETIRED = ".imported-2026-10-08T12-00-00-000Z"

const ALICE = "user-alice__workspace-aaaaaa"
const BOB = "user-bob__workspace-bbbbbb"
const CAROL = "user-carol__workspace-cccccc"

function account(seat: string, email: string, token: string): ChatGptAccount {
  return {
    accountUserId: seat,
    accountId: seat.split("__")[1]!,
    email,
    refreshToken: `rt-${token}`,
    accessToken: `at-${token}`,
    expiresAt: 1_800_000_000_000,
    tokenRotatedAt: 1_790_000_000_000,
    exchangeStartedAt: null,
  }
}

let nextRequest = 0
function metric(profileId: string | undefined, hoursAgo: number, outputTokens: number): RequestMetric {
  return {
    requestId: `req-${String(++nextRequest).padStart(5, "0")}`,
    timestamp: Date.now() - Math.round(hoursAgo * HOUR) - nextRequest,
    adapter: "chatgpt",
    model: "gpt-5.4",
    mode: "stream",
    isResume: false,
    isPassthrough: true,
    status: 200,
    queueWaitMs: 1,
    proxyOverheadMs: 2,
    ttfbMs: 300,
    upstreamDurationMs: 900,
    totalDurationMs: 950,
    contentBlocks: 2,
    textEvents: 7,
    error: null,
    inputTokens: 12_000 + outputTokens,
    outputTokens,
    cacheReadInputTokens: 8_000,
    cacheHitRate: 0.4,
    reasoningOutputTokens: Math.floor(outputTokens / 3),
    ...(profileId === undefined ? {} : { profileId }),
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function writeStore(path: string, accounts: ChatGptAccount[]): void {
  writeJson(path, { version: 1, accounts })
}

function record(path: string, metrics: RequestMetric[]): void {
  mkdirSync(join(path, ".."), { recursive: true })
  const stores = createSqliteStores(path, 3650)
  for (const m of metrics) stores.telemetry.record(m)
  stores.close()
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"))
}

/** Every file under `dir`, by name, with a hash of its bytes. */
function fingerprint(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      // A WAL reader maps -shm; its bytes say nothing about the data.
      else if (!entry.name.endsWith("-shm")) out[path] = createHash("sha256").update(readFileSync(path)).digest("hex")
    }
  }
  walk(dir)
  return out
}

/** `requests` and `estimatedUsd` per profile, as / and /telemetry compute them over a window. */
function usage(telemetryPath: string, windowMs: number): Record<string, { requests: number; estimatedUsd: number }> {
  const stores = createSqliteStores(telemetryPath, 3650)
  try {
    return stores.telemetry.summarize(windowMs).costEstimate.byProfile
  } finally {
    stores.close()
  }
}

function requestIds(telemetryPath: string): string[] {
  const db = new Database(telemetryPath, { readonly: true })
  try {
    return (db.prepare("SELECT request_id FROM metrics").all() as Array<{ request_id: string }>).map(row => row.request_id)
  } finally {
    db.close()
  }
}

describe("meridian instance-import", () => {
  let root: string
  let from: InstancePaths
  let to: InstancePaths
  let lines: string[]
  let sourceMetrics: RequestMetric[]
  const leases: WriterLease[] = []

  const run = (apply: boolean, renames: Record<string, string> = {}) => runInstanceImport({
    from, to, apply,
    renames: new Map(Object.entries(renames)),
    log: line => lines.push(line),
    batchSize: 7,
    pauseMs: 0,
    now: () => STAMP,
  })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "meridian-instance-import-"))
    lines = []
    // The source is laid out the way the live meridian-gpt is: an isolated
    // HOME's config directory, with the store and the telemetry elsewhere.
    from = {
      configDir: join(root, "gpt-home", ".config", "meridian"),
      storePath: join(root, "gpt-store", "chatgpt-accounts.json"),
      telemetryPath: join(root, "gpt-data", "telemetry.db"),
    }
    to = {
      configDir: join(root, "dev"),
      storePath: join(root, "dev", "chatgpt-accounts.json"),
      telemetryPath: join(root, "dev", "telemetry.db"),
    }

    writeStore(from.storePath, [account(ALICE, "alice@example.com", "alice"), account(BOB, "bob@example.com", "bob"), account(CAROL, "carol@example.com", "carol")])
    writeJson(join(from.configDir, "settings.json"), {
      chatGptActiveSeat: BOB,
      chatGptProfileNames: { [ALICE]: "alice-team", [BOB]: "bob-plus" },
      chatGptProfileAliases: { [ALICE]: ["alice-aaaaaa"], [BOB]: ["bob-bbbbbb", "bob-old"] },
      chatgpt: { creditsPolicy: "reserve", seatCreditsPolicy: { [BOB]: "never" } },
      layout: "wide",
      claudeExecutable: "bundled",
    })
    writeJson(join(from.configDir, "model-pricing.json"), { "gpt-6-luna": { inputPerMTok: 1, outputPerMTok: 8 } })
    sourceMetrics = [
      ...Array.from({ length: 12 }, (_, i) => metric("alice-team", 1 + i, 400 + i)),
      ...Array.from({ length: 5 }, (_, i) => metric("alice-aaaaaa", 30 + i * 20, 900)),
      ...Array.from({ length: 9 }, (_, i) => metric("bob-plus", 2 + i * 5, 250 * (i + 1))),
      metric("bob-old", 100, 50),
      ...Array.from({ length: 4 }, (_, i) => metric("carol-cccccc", 3 + i, 70)),
      metric("chatgpt:carol@example.com · id:cccccc", 50, 5),
      metric(undefined, 6, 0),
      metric(undefined, 120, 0),
    ]
    record(from.telemetryPath, sourceMetrics)

    writeJson(join(to.configDir, "profiles.json"), [
      { id: "personal", claudeConfigDir: join(root, "dev", "profiles", "personal"), aliases: ["old-personal"] },
    ])
    writeJson(join(to.configDir, "settings.json"), { activeProfile: "personal", profileOrder: ["personal"], layout: "compact", showHostname: true })
    record(to.telemetryPath, [
      ...Array.from({ length: 6 }, (_, i) => ({ ...metric("personal", 1 + i, 1000), adapter: "opencode", model: "claude-opus-4-7" })),
      metric(undefined, 2, 0),
    ])
  }, TIMEOUT)

  afterEach(() => {
    for (const lease of leases.splice(0)) lease.release()
    rmSync(root, { recursive: true, force: true })
  }, TIMEOUT)

  it("a dry run plans every seat under its own name and writes nothing", async () => {
    const before = fingerprint(root)
    const result = await run(false)

    expect(result.exitCode).toBe(0)
    expect(result.plan?.conflicts).toEqual([])
    expect(result.plan?.seats.map(seat => [seat.id, seat.aliases])).toEqual([
      ["alice-team", ["alice-aaaaaa"]],
      ["bob-plus", ["bob-bbbbbb", "bob-old"]],
      ["carol-cccccc", []],
    ])
    expect(lines).toContain("Dry run: nothing was written. Run again with --apply to import.")
    expect(lines.join("\n")).toContain(`Telemetry     ${sourceMetrics.length} requests to copy (0 already there)`)
    expect(fingerprint(root)).toEqual(before)
  }, TIMEOUT)

  it("moves every seat, setting, price and request, proves the copy, then retires the source", async () => {
    const seatIds = ["alice-team", "alice-aaaaaa", "bob-plus", "bob-old", "carol-cccccc"]
    const before = { day: usage(from.telemetryPath, 24 * HOUR), week: usage(from.telemetryPath, 7 * 24 * HOUR) }
    const sourceAccounts = createChatGptCredentialStore({ path: from.storePath }).readAccounts()
    const destinationRows = requestIds(to.telemetryPath).length

    const result = await run(true)

    expect(result.exitCode).toBe(0)
    expect(result.copied).toEqual({ seats: 3, requests: sourceMetrics.length, logs: 0 })

    // The seats, in their order, with the very same credentials.
    expect(createChatGptCredentialStore({ path: to.storePath }).readAccounts()).toEqual(sourceAccounts)

    const settings = readJsonFile(join(to.configDir, "settings.json"))
    expect(settings).toEqual({
      activeProfile: "personal",
      profileOrder: ["personal"],
      layout: "compact",
      showHostname: true,
      chatGptProfileNames: { [ALICE]: "alice-team", [BOB]: "bob-plus", [CAROL]: "carol-cccccc" },
      chatGptProfileAliases: { [ALICE]: ["alice-aaaaaa"], [BOB]: ["bob-bbbbbb", "bob-old"] },
      chatGptActiveSeat: BOB,
      chatgpt: { creditsPolicy: "reserve", seatCreditsPolicy: { [BOB]: "never" } },
    })
    expect(readJsonFile(join(to.configDir, "model-pricing.json"))).toEqual({ "gpt-6-luna": { inputPerMTok: 1, outputPerMTok: 8 } })

    // Every request once, and each seat's history on / unchanged: the same
    // requests and the same estimated value over the last day and week.
    const ids = requestIds(to.telemetryPath)
    expect(ids.length).toBe(destinationRows + sourceMetrics.length)
    expect(new Set(ids).size).toBe(ids.length)
    const retiredTelemetry = `${from.telemetryPath}${RETIRED}`
    const after = { day: usage(to.telemetryPath, 24 * HOUR), week: usage(to.telemetryPath, 7 * 24 * HOUR) }
    for (const id of seatIds) {
      expect(after.day[id]).toEqual(before.day[id]!)
      expect(after.week[id]).toEqual(before.week[id]!)
    }
    expect(before.week["bob-plus"]?.requests).toBe(9)
    expect(before.week["bob-plus"]?.estimatedUsd).toBeGreaterThan(0)
    expect(after.week["chatgpt:carol@example.com · id:cccccc"]?.requests).toBe(1)
    // The destination's own history is still its own.
    expect(after.week.personal?.requests).toBe(6)
    expect(after.week.default?.requests).toBe(1 + 2)
    expect(verifyTelemetry({ snapshot: readTelemetry(retiredTelemetry)!, destinationPath: to.telemetryPath, renamed: new Map() })).toMatchObject({ missing: 0, differing: 0 })

    // Retired by renaming, so a full copy stays; nothing was deleted.
    for (const path of [from.storePath, join(from.configDir, "settings.json"), join(from.configDir, "model-pricing.json"), from.telemetryPath]) {
      expect(existsSync(path)).toBe(false)
      expect(existsSync(`${path}${RETIRED}`)).toBe(true)
    }
    expect(createChatGptCredentialStore({ path: `${from.storePath}${RETIRED}` }).readAccounts()).toEqual(sourceAccounts)
    expect(requestIds(retiredTelemetry).length).toBe(sourceMetrics.length)
    // Neither lease is left behind.
    expect(existsSync(chatGptLockPath(from.storePath))).toBe(false)
    expect(existsSync(chatGptLockPath(to.storePath))).toBe(false)
  }, TIMEOUT)

  it("does nothing the second time", async () => {
    expect((await run(true)).exitCode).toBe(0)
    const before = fingerprint(root)
    lines = []

    expect((await run(true)).exitCode).toBe(0)
    expect(lines.join("\n")).toContain("Already imported")
    expect(fingerprint(root)).toEqual(before)
  }, TIMEOUT)

  it("continues an import that stopped part-way, copying no request twice", async () => {
    const snapshot = readTelemetry(from.telemetryPath)!
    await copyTelemetry({ snapshot: { ...snapshot, rows: snapshot.rows.slice(0, 10) }, destinationPath: to.telemetryPath, renamed: new Map(), pauseMs: 0 })

    const result = await run(true)

    expect(result.exitCode).toBe(0)
    expect(result.copied?.requests).toBe(sourceMetrics.length - 10)
    const ids = requestIds(to.telemetryPath)
    expect(new Set(ids).size).toBe(ids.length)
    for (const m of sourceMetrics) expect(ids).toContain(m.requestId)
  }, TIMEOUT)

  it("refuses while the source's Meridian holds its store, and writes nothing", async () => {
    leases.push(await acquireWriterLease({ lockPath: chatGptLockPath(from.storePath), waitMs: 0 }))
    const before = fingerprint(to.configDir)

    const result = await run(true)

    expect(result.exitCode).toBe(1)
    expect(lines.join("\n")).toContain("The source's ChatGPT store is in use, so its Meridian is still running")
    expect(fingerprint(to.configDir)).toEqual(before)
    expect(existsSync(from.storePath)).toBe(true)
  }, TIMEOUT)

  it("refuses while the destination's Meridian holds its store", async () => {
    leases.push(await acquireWriterLease({ lockPath: chatGptLockPath(to.storePath), waitMs: 0 }))

    const result = await run(true)

    expect(result.exitCode).toBe(1)
    expect(lines.join("\n")).toContain("The destination's ChatGPT store is in use")
    expect(existsSync(to.storePath)).toBe(false)
    expect(existsSync(from.storePath)).toBe(true)
  }, TIMEOUT)

  it("refuses a seat name the destination already uses, and --rename files the seat and its history under another", async () => {
    writeJson(join(to.configDir, "profiles.json"), [
      { id: "personal", claudeConfigDir: join(root, "dev", "profiles", "personal"), aliases: ["old-personal"] },
      { id: "alice-team", claudeConfigDir: join(root, "dev", "profiles", "alice-team") },
    ])
    const before = fingerprint(to.configDir)
    const aliceDay = usage(from.telemetryPath, 24 * HOUR)["alice-team"]

    const refused = await run(true)

    expect(refused.exitCode).toBe(1)
    expect(refused.plan?.conflicts).toEqual([
      "alice@example.com · id:aaaaaa would be \"alice-aaaaaa\" on the destination instead of \"alice-team\", which is the destination's Claude profile alice-team",
    ])
    expect(lines).toContain("Refused: resolve the conflicts above. Nothing was written.")
    expect(fingerprint(to.configDir)).toEqual(before)

    lines = []
    const renamed = await run(true, { "alice-team": "alice-gpt" })

    expect(renamed.exitCode).toBe(0)
    expect(readJsonFile(join(to.configDir, "settings.json")).chatGptProfileNames).toMatchObject({ [ALICE]: "alice-gpt" })
    const after = usage(to.telemetryPath, 24 * HOUR)
    expect(after["alice-gpt"]).toEqual(aliceDay!)
    expect(after["alice-team"]).toBeUndefined()
  }, TIMEOUT)

  it("refuses requests filed under a name the destination's Claude profile answers to", async () => {
    record(from.telemetryPath, [metric("old-personal", 3, 10)])

    const result = await run(false)

    expect(result.exitCode).toBe(1)
    expect(result.plan?.conflicts).toEqual(["1 source request(s) are filed under \"old-personal\", which is a former name of the destination's Claude profile personal"])
    expect((await run(false, { "old-personal": "legacy-gpt" })).plan?.conflicts).toEqual([])
  }, TIMEOUT)

  it("refuses a seat both stores hold with different credentials", async () => {
    writeStore(to.storePath, [account(BOB, "bob@example.com", "bob-renewed-since")])

    const result = await run(false)

    expect(result.exitCode).toBe(1)
    expect(result.plan?.conflicts).toEqual(["bob@example.com · id:bbbbbb (bob-plus) is in both stores with different credentials, and the destination's may be the newer"])
  }, TIMEOUT)

  it("refuses a source that also has Claude profiles", async () => {
    writeJson(join(from.configDir, "profiles.json"), [{ id: "work", claudeConfigDir: join(root, "gpt-home", "work") }])

    const result = await run(false)

    expect(result.plan?.conflicts).toContain("the source also has Claude profiles (work), and this command moves ChatGPT seats and their history only")
  }, TIMEOUT)

  it("notices a copied request that differs from its source, or is missing", async () => {
    expect((await run(true)).exitCode).toBe(0)
    const snapshot = readTelemetry(`${from.telemetryPath}${RETIRED}`)!
    const db = new Database(to.telemetryPath)
    db.prepare("UPDATE metrics SET output_tokens = output_tokens + 1 WHERE request_id = ?").run(sourceMetrics[0]!.requestId)
    db.prepare("DELETE FROM metrics WHERE request_id = ?").run(sourceMetrics[1]!.requestId)
    db.close()

    expect(verifyTelemetry({ snapshot, destinationPath: to.telemetryPath, renamed: new Map(), batchSize: 4 })).toMatchObject({ missing: 1, differing: 1 })
  }, TIMEOUT)
})

describe("meridian instance-import arguments", () => {
  it("defaults each store and database to its config directory", () => {
    const args = parseInstanceImportArgs(["--from", "/srv/gpt", "--to", "/srv/dev", "--to-telemetry", "/var/dev.db", "--rename", "a=b", "--apply"])
    expect(args.from).toEqual({ configDir: "/srv/gpt", storePath: "/srv/gpt/chatgpt-accounts.json", telemetryPath: "/srv/gpt/telemetry.db" })
    expect(args.to).toEqual({ configDir: "/srv/dev", storePath: "/srv/dev/chatgpt-accounts.json", telemetryPath: "/var/dev.db" })
    expect([...args.renames]).toEqual([["a", "b"]])
    expect(args.apply).toBe(true)
  })

  it("needs both instances named, and a rename spelled old=new", () => {
    expect(() => parseInstanceImportArgs(["--from", "/srv/gpt"])).toThrow(new InstanceImportUsageError("--to is required"))
    expect(() => parseInstanceImportArgs(["--from", "/a", "--to", "/b", "--rename", "a"])).toThrow(InstanceImportUsageError)
    expect(() => parseInstanceImportArgs(["--from", "/a", "--to", "/b", "--dry-run"])).toThrow(new InstanceImportUsageError("unknown option \"--dry-run\""))
    expect(parseInstanceImportArgs(["--help"]).help).toBe(true)
  })
})
