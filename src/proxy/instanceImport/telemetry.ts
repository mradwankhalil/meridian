/**
 * Copying one instance's telemetry into another's, row for row.
 *
 * A request is identified by its `request_id`, a UUID minted per request, so
 * a row the destination already holds is never copied twice and an import
 * that stopped part-way resumes where it was. The row's own `id` is not kept:
 * both databases number their rows from 1, and nothing refers to it.
 *
 * THE DESTINATION KEEPS SERVING WHILE ITS HISTORY GROWS. Rows go in through
 * short transactions with a pause between them, so the running Meridian's
 * own writes wait at most one batch for the lock (telemetry/sqlite.ts waits
 * for a busy database rather than dropping the row).
 *
 * Verification reads every copied row back and compares it with its source
 * column by column, which is what proves that every figure computed from the
 * rows - requests, tokens, the estimated value - is the same on both sides.
 */

import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import Database from "libsql"
import { createSqliteStores } from "../../telemetry/sqlite"

type Row = Record<string, unknown>

/** The source's telemetry, read once. */
export interface TelemetrySnapshot {
  path: string
  /** Metrics columns, in table order. */
  columns: string[]
  rows: Row[]
  logColumns: string[]
  logs: Row[]
}

/** How many rows each profile id has; a row served by no profile is not counted. */
export function rowsByProfile(snapshot: TelemetrySnapshot): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of snapshot.rows) {
    if (typeof row.profile_id === "string") counts.set(row.profile_id, (counts.get(row.profile_id) ?? 0) + 1)
  }
  return counts
}

function columnsOf(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name)
}

function timeSpan(rows: readonly Row[]): { from: number; to: number } | null {
  let from = Infinity
  let to = -Infinity
  for (const row of rows) {
    const at = Number(row.timestamp)
    if (at < from) from = at
    if (at > to) to = at
  }
  return rows.length === 0 ? null : { from, to }
}

function logKey(row: Row): string {
  return JSON.stringify([row.timestamp, row.level, row.category, row.request_id ?? null, row.message])
}

/** Null when the source has no telemetry database. */
export function readTelemetry(path: string): TelemetrySnapshot | null {
  if (!existsSync(path)) return null
  const db = new Database(path, { readonly: true })
  try {
    return {
      path,
      columns: columnsOf(db, "metrics"),
      rows: db.prepare("SELECT * FROM metrics ORDER BY id").all() as Row[],
      logColumns: columnsOf(db, "diagnostic_logs"),
      logs: db.prepare("SELECT * FROM diagnostic_logs ORDER BY id").all() as Row[],
    }
  } finally {
    db.close()
  }
}

/** What the destination already holds of the source's rows, read without writing. */
export interface TelemetryPresence {
  /** Request ids of the source's rows the destination holds. */
  requests: Set<string>
  logs: Set<string>
  /** Source metrics columns the destination's table does not have yet. */
  missingColumns: string[]
}

function presenceIn(db: Database.Database, snapshot: TelemetrySnapshot): TelemetryPresence {
  const wanted = new Set(snapshot.rows.map(row => String(row.request_id)))
  const requests = new Set<string>()
  const span = timeSpan(snapshot.rows)
  if (span) {
    // A copy carries its source row's timestamp, so the index on it narrows
    // the search to the source's own span.
    const held = db.prepare("SELECT request_id FROM metrics WHERE timestamp BETWEEN ? AND ?").all(span.from, span.to) as Array<{ request_id: string }>
    for (const { request_id } of held) if (wanted.has(request_id)) requests.add(request_id)
  }
  const logs = new Set<string>()
  const logSpan = timeSpan(snapshot.logs)
  if (logSpan) {
    const wantedLogs = new Set(snapshot.logs.map(logKey))
    for (const row of db.prepare("SELECT * FROM diagnostic_logs WHERE timestamp BETWEEN ? AND ?").all(logSpan.from, logSpan.to) as Row[]) {
      const key = logKey(row)
      if (wantedLogs.has(key)) logs.add(key)
    }
  }
  const present = new Set(columnsOf(db, "metrics"))
  return { requests, logs, missingColumns: snapshot.columns.filter(column => column !== "id" && !present.has(column)) }
}

/** The destination's holdings, for a plan; an absent database holds nothing and will be created. */
export function telemetryPresence(destinationPath: string, snapshot: TelemetrySnapshot): TelemetryPresence {
  if (!existsSync(destinationPath)) return { requests: new Set(), logs: new Set(), missingColumns: [] }
  const db = new Database(destinationPath, { readonly: true })
  try {
    return presenceIn(db, snapshot)
  } finally {
    db.close()
  }
}

export interface TelemetryCopyOptions {
  snapshot: TelemetrySnapshot
  destinationPath: string
  /** Profile ids filed under another id on the destination. */
  renamed: ReadonlyMap<string, string>
  batchSize?: number
  pauseMs?: number
}

export class TelemetrySchemaError extends Error {
  constructor(path: string, columns: readonly string[]) {
    super(`The telemetry database at ${path} has no column ${columns.join(", ")}, which the source's rows carry; this build cannot add them.`)
    this.name = "TelemetrySchemaError"
  }
}

/** Copy every source row the destination lacks. Returns how many were written. */
export async function copyTelemetry(options: TelemetryCopyOptions): Promise<{ requests: number; logs: number }> {
  const { snapshot, destinationPath, renamed } = options
  const batchSize = options.batchSize ?? 200
  const pauseMs = options.pauseMs ?? 25
  if (snapshot.rows.length === 0 && snapshot.logs.length === 0) return { requests: 0, logs: 0 }
  // Opened once through the server's own store, which creates the tables and
  // adds the columns this build knows, exactly as the destination would.
  mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 })
  createSqliteStores(destinationPath, 3650).close()
  const db = new Database(destinationPath)
  try {
    // A command can wait for the serving Meridian's writes; they cannot wait
    // long for it (a second at most, telemetry/sqlite.ts). So each batch
    // commits the way the server's own writes do, without an fsync that
    // would hold the lock for as long as the disk takes.
    db.pragma("busy_timeout = 30000")
    db.pragma("synchronous = NORMAL")
    const presence = presenceIn(db, snapshot)
    if (presence.missingColumns.length > 0) throw new TelemetrySchemaError(destinationPath, presence.missingColumns)

    const write = async (table: string, columns: readonly string[], rows: readonly Row[], values: (row: Row) => unknown[]): Promise<number> => {
      const insert = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      for (let start = 0; start < rows.length; start += batchSize) {
        db.exec("BEGIN IMMEDIATE")
        try {
          for (const row of rows.slice(start, start + batchSize)) insert.run(...values(row))
          db.exec("COMMIT")
        } catch (error) {
          db.exec("ROLLBACK")
          throw error
        }
        if (pauseMs > 0 && start + batchSize < rows.length) await new Promise(resolve => setTimeout(resolve, pauseMs))
      }
      return rows.length
    }

    const metricColumns = snapshot.columns.filter(column => column !== "id")
    const requests = await write(
      "metrics",
      metricColumns,
      snapshot.rows.filter(row => !presence.requests.has(String(row.request_id))),
      row => metricColumns.map(column => column === "profile_id" && typeof row.profile_id === "string"
        ? renamed.get(row.profile_id) ?? row.profile_id
        : row[column]),
    )
    const logColumns = snapshot.logColumns.filter(column => column !== "id")
    const logs = await write(
      "diagnostic_logs",
      logColumns,
      snapshot.logs.filter(row => !presence.logs.has(logKey(row))),
      row => logColumns.map(column => row[column]),
    )
    return { requests, logs }
  } finally {
    db.close()
  }
}

export interface ProfileTotals {
  requests: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

export interface TelemetryVerification {
  /** Source rows the destination does not hold. */
  missing: number
  /** Source rows the destination holds with any column different. */
  differing: number
  logsMissing: number
  /** Per destination profile id, summed over the source's rows as the destination holds them. */
  byProfile: Map<string, ProfileTotals>
}

function addTotals(totals: Map<string, ProfileTotals>, row: Row): void {
  const id = typeof row.profile_id === "string" ? row.profile_id : "default"
  const entry = totals.get(id) ?? { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }
  entry.requests += 1
  entry.inputTokens += Number(row.input_tokens ?? 0)
  entry.outputTokens += Number(row.output_tokens ?? 0)
  entry.cacheReadTokens += Number(row.cache_read_input_tokens ?? 0)
  totals.set(id, entry)
}

/** Read every source row back from the destination and compare it column by column. */
export function verifyTelemetry(options: { snapshot: TelemetrySnapshot; destinationPath: string; renamed: ReadonlyMap<string, string>; batchSize?: number }): TelemetryVerification {
  const { snapshot, renamed } = options
  const byProfile = new Map<string, ProfileTotals>()
  if (snapshot.rows.length === 0 && snapshot.logs.length === 0) return { missing: 0, differing: 0, logsMissing: 0, byProfile }
  if (!existsSync(options.destinationPath)) return { missing: snapshot.rows.length, differing: 0, logsMissing: snapshot.logs.length, byProfile }
  const db = new Database(options.destinationPath, { readonly: true })
  try {
    // A batch of the source's rows at a time, read back over that batch's own
    // span of time: the destination may hold far more history than the source,
    // and none of it needs to be in memory at once.
    const select = db.prepare("SELECT * FROM metrics WHERE timestamp BETWEEN ? AND ?")
    const ordered = [...snapshot.rows].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
    const batchSize = options.batchSize ?? 500
    let missing = 0
    let differing = 0
    for (let start = 0; start < ordered.length; start += batchSize) {
      const batch = ordered.slice(start, start + batchSize)
      const span = timeSpan(batch)!
      const wanted = new Set(batch.map(row => String(row.request_id)))
      const held = new Map<string, Row>()
      for (const row of select.all(span.from, span.to) as Row[]) {
        if (wanted.has(String(row.request_id))) held.set(String(row.request_id), row)
      }
      for (const row of batch) {
        const copy = held.get(String(row.request_id))
        if (!copy) {
          missing++
          continue
        }
        const same = snapshot.columns.every(column => {
          if (column === "id") return true
          const expected = column === "profile_id" && typeof row.profile_id === "string" ? renamed.get(row.profile_id) ?? row.profile_id : row[column]
          return copy[column] === expected
        })
        if (same) addTotals(byProfile, copy)
        else differing++
      }
    }
    const logsMissing = snapshot.logs.length - presenceIn(db, { ...snapshot, rows: [] }).logs.size
    return { missing, differing, logsMissing, byProfile }
  } finally {
    db.close()
  }
}

/** The source's own totals per destination profile id, for the before/after comparison. */
export function sourceTotals(snapshot: TelemetrySnapshot, renamed: ReadonlyMap<string, string>): Map<string, ProfileTotals> {
  const totals = new Map<string, ProfileTotals>()
  for (const row of snapshot.rows) {
    addTotals(totals, typeof row.profile_id === "string" ? { ...row, profile_id: renamed.get(row.profile_id) ?? row.profile_id } : row)
  }
  return totals
}
