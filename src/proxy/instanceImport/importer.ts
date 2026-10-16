/**
 * `meridian instance-import`: moving one Meridian instance's ChatGPT seats and
 * their history into another, then retiring the source.
 *
 * REFRESH TOKENS ARE SINGLE-USE, SO THE SEATS MOVE, THEY ARE NOT COPIED. Both
 * stores' writer leases are held for the whole run: the source's proves its
 * Meridian is stopped, and keeps it from starting until the source's files
 * are renamed away; the destination's keeps anything else from writing the
 * store being filled. Every credential is written through the store's own
 * lease-guarded writer.
 *
 * NOTHING IS DELETED. The source is retired by renaming each file it read to
 * `<name>.imported-<time>`, and only after everything was read back from the
 * destination and found identical. A run that stops before that leaves the
 * source as it was, and running the command again continues: whatever the
 * destination already holds unchanged is not written twice.
 */

import { randomUUID } from "node:crypto"
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import Database from "libsql"
import { ChatGptStoreCorruptError, createChatGptCredentialStore } from "../chatgpt/credentials"
import { acquireWriterLease, WriterLeaseUnavailableError, type WriterLease } from "../chatgpt/lease"
import { chatGptLockPath } from "../chatgpt/paths"
import { syncDirectoryDurablySync } from "../session/durableFileSystem"
import { planInstanceImport, type InstanceImportPlan, type InstanceState } from "./plan"
import {
  copyTelemetry,
  readTelemetry,
  rowsByProfile,
  sourceTotals,
  telemetryPresence,
  TelemetrySchemaError,
  verifyTelemetry,
  type ProfileTotals,
  type TelemetrySnapshot,
} from "./telemetry"

/** Where one instance keeps what this command reads or writes. */
export interface InstancePaths {
  configDir: string
  storePath: string
  telemetryPath: string
}

export interface InstanceImportOptions {
  from: InstancePaths
  to: InstancePaths
  /** `--rename`: source profile id -> destination profile id. */
  renames: ReadonlyMap<string, string>
  /** False: report the plan and write nothing. */
  apply: boolean
  log: (line: string) => void
  batchSize?: number
  pauseMs?: number
  now?: () => Date
}

export interface InstanceImportResult {
  exitCode: number
  plan?: InstanceImportPlan
  copied?: { seats: number; requests: number; logs: number }
  retired?: Array<{ from: string; to: string }>
}

/** Refused before anything was written, or with what was written still in place. */
export class InstanceImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InstanceImportError"
  }
}

const RETIRED_MARK = ".imported-"

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

function readJson(path: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined
    throw error
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new InstanceImportError(`${path} is not valid JSON`)
  }
}

function readObject(path: string): Record<string, unknown> {
  const value = readJson(path)
  if (value === undefined || value === null) return {}
  if (typeof value !== "object" || Array.isArray(value)) throw new InstanceImportError(`${path} does not hold a JSON object`)
  return value as Record<string, unknown>
}

function readInstance(paths: InstancePaths): InstanceState {
  const profiles = readJson(join(paths.configDir, "profiles.json")) ?? []
  if (!Array.isArray(profiles)) throw new InstanceImportError(`${join(paths.configDir, "profiles.json")} does not hold a profile list`)
  return {
    accounts: createChatGptCredentialStore({ path: paths.storePath }).readAccounts(),
    settings: readObject(join(paths.configDir, "settings.json")),
    claudeProfiles: profiles.flatMap((profile: unknown) => {
      if (typeof profile !== "object" || profile === null) return []
      const entry = profile as Record<string, unknown>
      return typeof entry.id === "string" ? [{ id: entry.id, aliases: entry.aliases }] : []
    }),
    pricing: readObject(join(paths.configDir, "model-pricing.json")),
  }
}

/** Fsynced to a private staging file, then renamed over the original. */
function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const staging = `${path}.import-${process.pid}-${randomUUID()}`
  const fd = openSync(staging, "wx", 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8")
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(staging, path)
  } catch (error) {
    unlinkSync(staging)
    throw error
  }
  syncDirectoryDurablySync(dirname(path))
}

/** Set these top-level keys in a JSON object file as it is NOW, keeping every other key. */
function mergeIntoFile(path: string, patch: Record<string, unknown>): void {
  if (Object.keys(patch).length === 0) return
  writeJsonAtomically(path, { ...readObject(path), ...patch })
}

function retiredCopies(path: string): string[] {
  const prefix = `${basename(path)}${RETIRED_MARK}`
  try {
    return readdirSync(dirname(path)).filter(name => name.startsWith(prefix) && !name.endsWith("-wal") && !name.endsWith("-shm")).sort().map(name => join(dirname(path), name))
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return []
    throw error
  }
}

async function takeLease(storePath: string, whose: string): Promise<WriterLease> {
  try {
    return await acquireWriterLease({ lockPath: chatGptLockPath(storePath), waitMs: 0 })
  } catch (error) {
    if (error instanceof WriterLeaseUnavailableError) {
      throw new InstanceImportError(`${whose} ChatGPT store is in use, so its Meridian is still running: ${error.message} Stop it first.`)
    }
    throw error
  }
}

/** Who holds a store's writer lease, read from its lock file without taking it; null when nobody does. */
function leaseHolder(storePath: string): string | null {
  let raw: string
  try {
    raw = readFileSync(chatGptLockPath(storePath), "utf8")
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null
    throw error
  }
  try {
    const owner = JSON.parse(raw) as { pid?: unknown; hostname?: unknown }
    return `held by pid ${String(owner.pid)} on ${String(owner.hostname)}`
  } catch {
    return "held by an unreadable owner record"
  }
}

function emptySnapshot(path: string): TelemetrySnapshot {
  return { path, columns: [], rows: [], logColumns: [], logs: [] }
}

/** Row count and highest id, to notice a source still being written. */
function telemetryMark(path: string): string {
  if (!existsSync(path)) return "absent"
  const db = new Database(path, { readonly: true })
  try {
    const metrics = db.prepare("SELECT count(*) AS n, max(id) AS last FROM metrics").get() as { n: number; last: number | null }
    const logs = db.prepare("SELECT count(*) AS n, max(id) AS last FROM diagnostic_logs").get() as { n: number; last: number | null }
    return `${metrics.n}/${metrics.last}/${logs.n}/${logs.last}`
  } finally {
    db.close()
  }
}

function snapshotMark(snapshot: TelemetrySnapshot): string {
  if (!existsSync(snapshot.path)) return "absent"
  const lastId = (rows: readonly Record<string, unknown>[]): number | null => rows.length === 0 ? null : Number(rows[rows.length - 1]?.id)
  return `${snapshot.rows.length}/${lastId(snapshot.rows)}/${snapshot.logs.length}/${lastId(snapshot.logs)}`
}

function rename(from: string, to: string, moved: Array<{ from: string; to: string }>): void {
  if (existsSync(to)) throw new InstanceImportError(`cannot retire ${from}: ${to} already exists`)
  renameSync(from, to)
  moved.push({ from, to })
}

/**
 * Rename every source file the import read. The telemetry database is
 * checkpointed first, so that the renamed file holds every row by itself
 * rather than leaning on a write-ahead log under the old name.
 */
function retireSource(from: InstancePaths, stamp: string): Array<{ from: string; to: string }> {
  const moved: Array<{ from: string; to: string }> = []
  const aside = (path: string): string => `${path}${RETIRED_MARK}${stamp}`
  for (const path of [
    from.storePath,
    join(from.configDir, "settings.json"),
    join(from.configDir, "model-pricing.json"),
  ]) {
    if (existsSync(path)) rename(path, aside(path), moved)
  }
  if (existsSync(from.telemetryPath)) {
    const db = new Database(from.telemetryPath)
    try {
      db.pragma("busy_timeout = 30000")
      db.pragma("wal_checkpoint(TRUNCATE)")
    } finally {
      db.close()
    }
    const target = aside(from.telemetryPath)
    rename(from.telemetryPath, target, moved)
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${from.telemetryPath}${suffix}`)) rename(`${from.telemetryPath}${suffix}`, `${target}${suffix}`, moved)
    }
  }
  return moved
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length)
}

function printPlan(log: (line: string) => void, input: {
  options: InstanceImportOptions
  plan: InstanceImportPlan
  source: InstanceState
  destination: InstanceState
  snapshot: TelemetrySnapshot
  requestsHeld: number
  logsHeld: number
  missingColumns: readonly string[]
}): void {
  const { options, plan, source, destination, snapshot } = input
  const oldest = snapshot.rows.reduce<number | null>((min, row) => {
    const at = Number(row.timestamp)
    return min === null || at < min ? at : min
  }, null)
  log(`From  ${options.from.configDir}`)
  log(`      store      ${options.from.storePath} (${source.accounts.length} seat${source.accounts.length === 1 ? "" : "s"})`)
  log(`      telemetry  ${options.from.telemetryPath} (${snapshot.rows.length} requests${oldest === null ? "" : ` since ${new Date(oldest).toISOString().slice(0, 10)}`}, ${snapshot.logs.length} log entries)`)
  log(`Into  ${options.to.configDir}`)
  log(`      store      ${options.to.storePath} (${destination.accounts.length} seat${destination.accounts.length === 1 ? "" : "s"})`)
  log(`      telemetry  ${options.to.telemetryPath}`)
  log("")
  log("Seats")
  const width = Math.max(...plan.seats.map(seat => seat.id.length), 4)
  for (const seat of plan.seats) {
    const notes = [
      seat.aliases.length > 0 ? `former names ${seat.aliases.join(", ")}` : "",
      seat.id !== seat.sourceId ? `renamed from ${seat.sourceId}` : "",
      seat.action === "present" ? "already in the destination" : "",
    ].filter(Boolean)
    log(`  ${pad(seat.id, width)}  ${seat.label}${notes.length > 0 ? `  (${notes.join("; ")})` : ""}`)
  }
  const settingKeys = Object.keys(plan.settings)
  log("")
  log(`Settings      ${settingKeys.length > 0 ? settingKeys.join(", ") : "nothing to change"}`)
  log(`Prices        ${Object.keys(plan.pricing).length} override(s) to add`)
  log(`Telemetry     ${snapshot.rows.length - input.requestsHeld} requests to copy (${input.requestsHeld} already there), ${snapshot.logs.length - input.logsHeld} log entries to copy (${input.logsHeld} already there)`)
  if (input.missingColumns.length > 0) log(`              the destination's database gains the columns ${input.missingColumns.join(", ")}`)
  for (const note of plan.notes) log(`Note: ${note}`)
  log("")
  if (plan.conflicts.length === 0) log("Conflicts: none")
  else {
    log("Conflicts:")
    for (const conflict of plan.conflicts) log(`  - ${conflict}`)
  }
}

function printTotals(log: (line: string) => void, before: ReadonlyMap<string, ProfileTotals>, after: ReadonlyMap<string, ProfileTotals>): void {
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => (before.get(b)?.requests ?? 0) - (before.get(a)?.requests ?? 0))
  const width = Math.max(...ids.map(id => id.length), 7)
  log(`  ${pad("profile", width)}  ${pad("requests (source / destination)", 33)}  output tokens (source / destination)`)
  for (const id of ids) {
    const was = before.get(id)
    const now = after.get(id)
    log(`  ${pad(id, width)}  ${pad(`${was?.requests ?? 0} / ${now?.requests ?? 0}`, 33)}  ${was?.outputTokens ?? 0} / ${now?.outputTokens ?? 0}`)
  }
}

export async function runInstanceImport(options: InstanceImportOptions): Promise<InstanceImportResult> {
  try {
    return await run(options)
  } catch (error) {
    if (error instanceof InstanceImportError || error instanceof ChatGptStoreCorruptError || error instanceof TelemetrySchemaError) {
      options.log(`Refused: ${error.message}`)
      return { exitCode: 1 }
    }
    throw error
  }
}

async function run(options: InstanceImportOptions): Promise<InstanceImportResult> {
  const { from, to, log } = options
  for (const key of ["configDir", "storePath", "telemetryPath"] as const) {
    if (resolve(from[key]) === resolve(to[key])) throw new InstanceImportError(`the source and the destination share ${from[key]}`)
  }
  if (!existsSync(from.storePath)) {
    const retired = retiredCopies(from.storePath)
    if (retired.length > 0) {
      log(`Already imported: the source's ChatGPT store was retired to ${retired[retired.length - 1]}. Nothing to do.`)
      return { exitCode: 0 }
    }
    throw new InstanceImportError(`the source has no ChatGPT store at ${from.storePath}`)
  }

  const plan = (source: InstanceState, destination: InstanceState, snapshot: TelemetrySnapshot): InstanceImportPlan =>
    planInstanceImport({ source, destination, renames: options.renames, telemetryProfileIds: rowsByProfile(snapshot) })

  if (!options.apply) {
    const source = readInstance(from)
    const destination = readInstance(to)
    const snapshot = readTelemetry(from.telemetryPath) ?? emptySnapshot(from.telemetryPath)
    const planned = plan(source, destination, snapshot)
    const presence = telemetryPresence(to.telemetryPath, snapshot)
    printPlan(log, { options, plan: planned, source, destination, snapshot, requestsHeld: presence.requests.size, logsHeld: presence.logs.size, missingColumns: presence.missingColumns })
    const sourceHolder = leaseHolder(from.storePath)
    if (sourceHolder) log(`The source's ChatGPT store is in use (${sourceHolder}); --apply refuses while its Meridian runs.`)
    const destinationHolder = leaseHolder(to.storePath)
    if (destinationHolder) log(`The destination's ChatGPT store is in use (${destinationHolder}); --apply refuses while its Meridian runs.`)
    log("Dry run: nothing was written. Run again with --apply to import.")
    return { exitCode: planned.conflicts.length > 0 ? 1 : 0, plan: planned }
  }

  const sourceLease = await takeLease(from.storePath, "The source's")
  try {
    const destinationLease = await takeLease(to.storePath, "The destination's")
    try {
      // Read only now: with the source's lease held its Meridian is stopped,
      // so nothing written after these reads can be left behind.
      const source = readInstance(from)
      const destination = readInstance(to)
      const snapshot = readTelemetry(from.telemetryPath) ?? emptySnapshot(from.telemetryPath)
      const planned = plan(source, destination, snapshot)
      const presence = telemetryPresence(to.telemetryPath, snapshot)
      printPlan(log, { options, plan: planned, source, destination, snapshot, requestsHeld: presence.requests.size, logsHeld: presence.logs.size, missingColumns: presence.missingColumns })
      if (planned.conflicts.length > 0) {
        log("Refused: resolve the conflicts above. Nothing was written.")
        return { exitCode: 1, plan: planned }
      }

      // History first and credentials last: until the seats are written, a
      // run that stops leaves every refresh token in exactly one store.
      const copied = await copyTelemetry({
        snapshot,
        destinationPath: to.telemetryPath,
        renamed: planned.renamed,
        ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
        ...(options.pauseMs === undefined ? {} : { pauseMs: options.pauseMs }),
      })
      const telemetry = verifyTelemetry({ snapshot, destinationPath: to.telemetryPath, renamed: planned.renamed })
      const telemetryProblems = [
        ...(telemetry.missing > 0 ? [`${telemetry.missing} source request(s) are not in the destination's telemetry`] : []),
        ...(telemetry.differing > 0 ? [`${telemetry.differing} source request(s) differ in the destination's telemetry`] : []),
        ...(telemetry.logsMissing > 0 ? [`${telemetry.logsMissing} source log entr${telemetry.logsMissing === 1 ? "y is" : "ies are"} not in the destination`] : []),
        ...(telemetryMark(from.telemetryPath) === snapshotMark(snapshot) ? [] : ["the source's telemetry changed during the import, so something still writes it"]),
      ]
      log("")
      if (telemetryProblems.length > 0) {
        log(`Copied ${copied.requests} request(s) and ${copied.logs} log entr${copied.logs === 1 ? "y" : "ies"}, then verification FAILED:`)
        for (const problem of telemetryProblems) log(`  - ${problem}`)
        log("No seat or setting was copied, and the source was left in place. Running the command again continues the import.")
        return { exitCode: 1, plan: planned, copied: { seats: 0, ...copied } }
      }

      mergeIntoFile(join(to.configDir, "settings.json"), planned.settings)
      mergeIntoFile(join(to.configDir, "model-pricing.json"), planned.pricing)
      const store = createChatGptCredentialStore({ path: to.storePath, lease: destinationLease })
      const accounts = new Map(source.accounts.map(account => [account.accountUserId, account]))
      let seats = 0
      for (const seat of planned.seats) {
        const account = accounts.get(seat.seat)
        if (seat.action !== "import" || !account) continue
        store.commitAccount(seat.seat, () => ({ ...account }))
        seats++
      }
      log(`Imported ${seats} seat(s), ${Object.keys(planned.settings).length} setting(s), ${copied.requests} request(s) and ${copied.logs} log entr${copied.logs === 1 ? "y" : "ies"}.`)

      // Verified by planning again against what the destination holds now:
      // an import that is complete leaves that plan nothing to do.
      const again = plan(source, readInstance(to), snapshot)
      const problems = [
        ...again.conflicts,
        ...again.seats.filter(seat => seat.action !== "present").map(seat => `${seat.label} is not in the destination's store`),
        ...Object.keys(again.settings).map(key => `the destination's ${key} setting does not hold what was imported`),
        ...Object.keys(again.pricing).map(model => `the destination has no price override for ${model}`),
        ...(telemetryMark(from.telemetryPath) === snapshotMark(snapshot) ? [] : ["the source's telemetry changed during the import, so something still writes it"]),
      ]
      log("")
      if (problems.length > 0) {
        log("Verification FAILED; the source was left in place:")
        for (const problem of problems) log(`  - ${problem}`)
        log("Both stores now hold these seats' refresh tokens: start neither Meridian on them until a run succeeds. Running the command again continues the import.")
        return { exitCode: 1, plan: planned, copied: { seats, ...copied } }
      }
      log(`Verified: ${planned.seats.length} seat(s) with identical credentials, every seat's name and former names, the settings, and ${snapshot.rows.length} of ${snapshot.rows.length} requests identical column by column:`)
      printTotals(log, sourceTotals(snapshot, planned.renamed), telemetry.byProfile)

      const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-")
      const retired = retireSource(from, stamp)
      log("")
      log("Retired the source (renamed; nothing was deleted):")
      for (const move of retired) log(`  ${move.from} -> ${basename(move.to)}`)
      log("")
      log("Restart the destination Meridian with MERIDIAN_CHATGPT_CREDENTIALS=owned (or unset) so it serves these seats.")
      return { exitCode: 0, plan: planned, copied: { seats, ...copied }, retired }
    } finally {
      destinationLease.release()
    }
  } finally {
    sourceLease.release()
  }
}
