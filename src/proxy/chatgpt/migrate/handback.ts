/**
 * Writing Meridian's seats back into oc-codex-multi-auth's account store.
 *
 * The store is merged, never replaced: every account the plugin holds that is
 * not being handed back keeps its record byte for byte, and a handed-back
 * seat lands in its old position when the store still has one.
 *
 * Which record a seat gets, in order:
 *
 *   1. A `.meridian-backup` copy whose refresh token is the one Meridian holds.
 *      Meridian never renewed the seat, so that original is still valid and is
 *      restored whole - labels, tags, cooldowns, `addedAt` and all.
 *   2. The record the store has now (the forward strip left it there without
 *      its refresh token), or else the newest backup copy, with Meridian's
 *      tokens laid over it. A backup's own tokens are never used here: once
 *      Meridian has renewed, they are spent.
 *   3. A new record, for a seat that was signed in through Meridian.
 *
 * Identity is `accountUserId`, read from the access token where a record
 * lacks the field - the same rule the import uses.
 *
 * Pure: text in, text out. No token value is ever placed in a report.
 */

import type { MeridianHeldAccount } from "./strip"
import { accountUserIdFromAccessToken, isRecord } from "./sources"

const STORE_VERSION = 3

export class PluginStoreFormatError extends Error {}

export type HandbackAction = "restored-from-backup" | "updated" | "added"

export interface HandbackOutcome {
  accountUserId: string
  action: HandbackAction
  /** The backup file a restored record came from. */
  backup?: string
}

export interface HandbackMerge {
  text: string
  outcomes: HandbackOutcome[]
}

export interface BackupDocument {
  path: string
  raw: string
}

type StoreRecord = Record<string, unknown>

function seatOf(record: StoreRecord): string | null {
  const field = typeof record.accountUserId === "string" && record.accountUserId.trim() ? record.accountUserId.trim() : null
  return field ?? accountUserIdFromAccessToken(typeof record.accessToken === "string" ? record.accessToken : null)
}

function parseStore(raw: string, path: string): StoreRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PluginStoreFormatError(`${path} is not valid JSON`)
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) throw new PluginStoreFormatError(`${path} is not an oc-codex-multi-auth account store`)
  if (parsed.version !== STORE_VERSION) {
    throw new PluginStoreFormatError(`${path} declares schema version ${JSON.stringify(parsed.version)}; only version ${STORE_VERSION} is written back`)
  }
  return parsed
}

function backupRecords(backups: readonly BackupDocument[]): Array<{ path: string; record: StoreRecord }> {
  const records: Array<{ path: string; record: StoreRecord }> = []
  for (const backup of backups) {
    let parsed: StoreRecord
    try {
      parsed = parseStore(backup.raw, backup.path)
    } catch {
      continue
    }
    for (const record of parsed.accounts as unknown[]) if (isRecord(record)) records.push({ path: backup.path, record })
  }
  return records
}

function withMeridianTokens(base: StoreRecord, seat: MeridianHeldAccount, now: number): StoreRecord {
  const record: StoreRecord = { ...base }
  record.accountUserId = seat.accountUserId
  if (seat.accountId) record.accountId = seat.accountId
  if (seat.email && typeof record.email !== "string") record.email = seat.email
  record.refreshToken = seat.refreshToken
  if (seat.accessToken) record.accessToken = seat.accessToken
  else delete record.accessToken
  if (seat.expiresAt !== null) record.expiresAt = seat.expiresAt
  else delete record.expiresAt
  record.tokenRotatedAt = seat.tokenRotatedAt ?? now
  if (typeof record.addedAt !== "number") record.addedAt = now
  if (typeof record.lastUsed !== "number") record.lastUsed = now
  return record
}

/**
 * `currentRaw` null means the store file does not exist. `backups` are listed
 * oldest first; for metadata the newest copy of a seat wins.
 */
export function mergeIntoPluginStore(input: {
  storePath: string
  currentRaw: string | null
  backups: readonly BackupDocument[]
  seats: readonly MeridianHeldAccount[]
  now: number
}): HandbackMerge {
  const document = input.currentRaw === null
    ? { version: STORE_VERSION, accounts: [] as unknown[], activeIndex: 0 }
    : parseStore(input.currentRaw, input.storePath)
  const accounts = [...(document.accounts as unknown[])]
  const saved = backupRecords(input.backups)
  const outcomes: HandbackOutcome[] = []

  for (const seat of input.seats) {
    const index = accounts.findIndex(record => isRecord(record) && seatOf(record) === seat.accountUserId)
    const copies = saved.filter(entry => seatOf(entry.record) === seat.accountUserId)
    const valid = copies.find(entry => entry.record.refreshToken === seat.refreshToken)
    let record: StoreRecord
    let outcome: HandbackOutcome
    if (valid) {
      record = valid.record
      outcome = { accountUserId: seat.accountUserId, action: "restored-from-backup", backup: valid.path }
    } else {
      const base = index >= 0 ? accounts[index] as StoreRecord : copies.at(-1)?.record ?? { enabled: true }
      record = withMeridianTokens(base, seat, input.now)
      outcome = { accountUserId: seat.accountUserId, action: index >= 0 || copies.length > 0 ? "updated" : "added" }
    }
    if (index >= 0) accounts[index] = record
    else accounts.push(record)
    outcomes.push(outcome)
  }

  const activeIndex = typeof document.activeIndex === "number" && document.activeIndex >= 0 ? document.activeIndex : 0
  const next = { ...document, accounts, activeIndex: Math.min(activeIndex, Math.max(0, accounts.length - 1)) }
  // The plugin's own writer: two-space JSON, no trailing newline.
  return { text: JSON.stringify(next, null, 2), outcomes }
}

/** Seats in the store that hold a refresh token, for checking that no seat has two refreshers. */
export function seatsWithRefreshTokens(raw: string, path: string): Set<string> {
  const seats = new Set<string>()
  for (const record of parseStore(raw, path).accounts as unknown[]) {
    if (!isRecord(record) || typeof record.refreshToken !== "string" || !record.refreshToken.trim()) continue
    const seat = seatOf(record)
    if (seat) seats.add(seat)
  }
  return seats
}
