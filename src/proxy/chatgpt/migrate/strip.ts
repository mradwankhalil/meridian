/**
 * Taking refresh authority away from oc-codex-multi-auth and from opencode's
 * own OpenAI OAuth, once Meridian holds the live copy of every seat.
 *
 * Every source keeps its original under `.meridian-backup` (0600) before it
 * is rewritten:
 *
 *   - plugin stores (global, per-project, legacy, flagged): `refreshToken` is
 *     deleted from every account, under the plugin's refresh lease and storage
 *     transaction lock. The plugin drops accounts without one when it loads,
 *     so it is left with nothing to refresh. Everything else is kept.
 *   - keychain entries: the same edit, with the original preserved as a
 *     sibling keychain entry rather than a plaintext file - an operator who
 *     opted into the keychain did so to keep these off disk.
 *   - opencode `auth.json`: the `openai` OAuth entry is removed. Leaving it
 *     makes opencode's built-in provider keep refreshing it, and keeps sending
 *     `openai/` requests straight to chatgpt.com instead of to Meridian.
 *   - `backups/`: moved aside whole. The snapshots are not refreshed by
 *     anything, but restoring one would hand the plugin a live token again.
 *
 * Stripping a seat Meridian does not hold, or holds an older token for,
 * leaves no working copy anywhere but a backup; that is refused per source.
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { KeychainBackend } from "./keychain"
import {
  ACCOUNTS_FILE_NAME,
  KEYCHAIN_SERVICE_NAME,
  MERIDIAN_BACKUP_SUFFIX,
  storeRefreshLockPath,
  storeTransactionLockPath,
  type MigrationEnvironment,
} from "./layout"
import {
  REFRESH_LOCK_STALE_MS,
  TRANSACTION_LOCK_STALE_MS,
  backupStamp,
  moveDirectoryAside,
  preserveOriginal,
  replaceFileAtomically,
  withPluginLocks,
  withPluginLocksAsync,
  type LockOptions,
} from "./files"
import {
  LIVE_SOURCE_KINDS,
  compareFreshness,
  isRecord,
  pluginStoreDirectories,
  type CandidateCredential,
  type Discovery,
  type SourceKind,
} from "./sources"

export type StripTarget =
  | { type: "document"; kind: SourceKind; location: string; lockedStorePath: string }
  | { type: "keychain"; kind: SourceKind; location: string; account: string; lockedStorePath: string }
  | { type: "opencode-auth"; location: string }
  | { type: "backups"; location: string }

export interface StripPlanItem {
  target: StripTarget
  /** Refresh tokens held there at discovery time (files in `backups/` for a backups directory). */
  tokens: number
  seats: string[]
  /** Why this source must not be stripped yet. Empty means it may be. */
  blockers: string[]
}

/** What Meridian's store holds for one seat - compared in-process, never printed. */
export interface MeridianHeldAccount {
  accountUserId: string
  refreshToken: string
  accessToken: string | null
  tokenRotatedAt: number | null
  expiresAt: number | null
  /** The workspace and email, for naming seats and spotting duplicates. Absent where the adapter does not know them. */
  accountId?: string | null
  email?: string | null
  /** Set while an exchange's result was never recorded: the refresh token may already be spent. */
  exchangeStartedAt?: number | null
}

export function heldAsCandidate(account: MeridianHeldAccount, template: CandidateCredential): CandidateCredential {
  return {
    ...template,
    refreshToken: account.refreshToken,
    accessToken: account.accessToken,
    tokenRotatedAt: account.tokenRotatedAt,
    expiresAt: account.expiresAt,
    issuedAt: null,
  }
}

export const STORE_UNREADABLE = "Meridian's ChatGPT store could not be read"
export const SEAT_NOT_IMPORTED = "not in Meridian's store - run the import step first"
export const SEAT_REFRESHED_SINCE = "refreshed here after the import, so Meridian's copy is older - re-run the import step"

/**
 * Why each live copy may not be stripped. `held` is null when Meridian's store
 * could not be read, in which case nothing may be stripped without --force.
 */
export function ownershipBlockers(
  candidates: readonly CandidateCredential[],
  held: readonly MeridianHeldAccount[] | null,
): Map<CandidateCredential, string> {
  const blockers = new Map<CandidateCredential, string>()
  const bySeat = new Map((held ?? []).map(account => [account.accountUserId, account]))
  for (const candidate of candidates) {
    if (!LIVE_SOURCE_KINDS.has(candidate.source.kind)) continue
    if (held === null) {
      blockers.set(candidate, STORE_UNREADABLE)
      continue
    }
    const mine = bySeat.get(candidate.accountUserId)
    if (!mine) {
      blockers.set(candidate, SEAT_NOT_IMPORTED)
      continue
    }
    if (mine.refreshToken === candidate.refreshToken) continue
    if (compareFreshness(candidate, heldAsCandidate(mine, candidate)) < 0) {
      blockers.set(candidate, SEAT_REFRESHED_SINCE)
    }
  }
  return blockers
}

/**
 * The refresh tokens discovery saw in each source, which the ownership checks
 * were made against. Kept off `StripPlanItem`, which is reported, so no report
 * can serialise them.
 */
const tokensSeenAtDiscovery = new WeakMap<StripPlanItem, Set<string>>()

export const CHANGED_SINCE_DISCOVERY = "it gained a refresh token since it was inspected (the plugin refreshed an account); re-run the import step, then strip"

/** A token here that discovery never saw was never checked against Meridian's store, and stripping it would destroy it. */
function unseenTokenPresent(item: StripPlanItem, present: readonly string[]): boolean {
  const seen = tokensSeenAtDiscovery.get(item) ?? new Set<string>()
  return present.some(token => !seen.has(token))
}

function accountsRefreshTokens(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) return []
    return parsed.accounts.flatMap(account =>
      isRecord(account) && typeof account.refreshToken === "string" && account.refreshToken.trim() ? [account.refreshToken.trim()] : [])
  } catch {
    return []
  }
}

export function planStrip(discovery: Discovery, env: MigrationEnvironment, blockers: Map<CandidateCredential, string>): StripPlanItem[] {
  const items = new Map<string, StripPlanItem>()
  const blockedSeats = new Map<StripPlanItem, Map<string, Set<string>>>()
  const itemFor = (target: StripTarget): StripPlanItem => {
    const existing = items.get(target.location)
    if (existing) return existing
    const created: StripPlanItem = { target, tokens: 0, seats: [], blockers: [] }
    items.set(target.location, created)
    return created
  }

  for (const candidate of discovery.candidates) {
    const { source } = candidate
    let target: StripTarget
    if (source.kind === "backup") {
      target = { type: "backups", location: dirname(source.location) }
    } else if (source.kind === "opencode-auth") {
      target = { type: "opencode-auth", location: source.location }
    } else if (source.keychainAccount) {
      target = {
        type: "keychain", kind: source.kind, location: source.location,
        account: source.keychainAccount, lockedStorePath: source.lockedStorePath ?? source.location,
      }
    } else {
      target = { type: "document", kind: source.kind, location: source.location, lockedStorePath: source.lockedStorePath ?? source.location }
    }
    const item = itemFor(target)
    item.tokens++
    const seen = tokensSeenAtDiscovery.get(item) ?? new Set<string>()
    tokensSeenAtDiscovery.set(item, seen.add(candidate.refreshToken))
    if (!item.seats.includes(candidate.accountUserId)) item.seats.push(candidate.accountUserId)
    const blocker = blockers.get(candidate)
    if (blocker) {
      const byReason = blockedSeats.get(item) ?? new Map<string, Set<string>>()
      byReason.set(blocker, (byReason.get(blocker) ?? new Set<string>()).add(candidate.accountUserId))
      blockedSeats.set(item, byReason)
    }
  }
  for (const [item, byReason] of blockedSeats) {
    item.blockers = [...byReason].map(([reason, seats]) => reason === STORE_UNREADABLE ? reason : `${seats.size} seat(s) ${reason}`)
  }

  // A backups directory counts even when its snapshots were unparseable or tokenless.
  for (const { dir } of pluginStoreDirectories(env)) {
    const location = join(dir, "backups")
    if (existsSync(location) && !items.has(location)) itemFor({ type: "backups", location })
  }
  return [...items.values()]
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface StripOutcome {
  item: StripPlanItem
  status: "stripped" | "unchanged" | "skipped"
  removed: number
  backup?: string
  detail?: string
}

export interface StripExecutionOptions {
  now: Date
  keychain?: KeychainBackend | null
  refreshLock?: Pick<LockOptions, "waitMs" | "pollMs">
  transactionLock?: Pick<LockOptions, "waitMs" | "pollMs">
}

/** Delete `refreshToken` from each account. Null when the text is not a plugin document. */
export function stripAccountsText(raw: string): { text: string; removed: number } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.accounts)) return null
  let removed = 0
  for (const account of parsed.accounts) {
    if (isRecord(account) && "refreshToken" in account) {
      delete account.refreshToken
      removed++
    }
  }
  return { text: `${JSON.stringify(parsed, null, 2)}\n`, removed }
}

export function locksFor(lockedStorePath: string, options: Pick<StripExecutionOptions, "refreshLock" | "transactionLock">) {
  // The refresh lease belongs to the main accounts file of the directory, and
  // is taken first: the plugin holds it around the exchange and opens the
  // storage transaction inside it.
  const mainStore = join(dirname(lockedStorePath), ACCOUNTS_FILE_NAME)
  return [
    { path: storeRefreshLockPath(mainStore), staleMs: REFRESH_LOCK_STALE_MS, waitMs: options.refreshLock?.waitMs ?? REFRESH_LOCK_STALE_MS + 5_000, pollMs: options.refreshLock?.pollMs },
    { path: storeTransactionLockPath(lockedStorePath), staleMs: TRANSACTION_LOCK_STALE_MS, waitMs: options.transactionLock?.waitMs ?? TRANSACTION_LOCK_STALE_MS + 2_000, pollMs: options.transactionLock?.pollMs },
  ]
}

function stripDocument(item: StripPlanItem, target: Extract<StripTarget, { type: "document" }>, options: StripExecutionOptions): StripOutcome {
  return withPluginLocks(locksFor(target.lockedStorePath, options), () => {
    // Re-read under the lock: what discovery saw may have been rewritten since.
    const raw = readFileSync(target.location, "utf8")
    const stripped = stripAccountsText(raw)
    if (!stripped) return { item, status: "skipped", removed: 0, detail: "no longer a readable accounts document" }
    if (stripped.removed === 0) return { item, status: "unchanged", removed: 0 }
    if (unseenTokenPresent(item, accountsRefreshTokens(raw))) return { item, status: "skipped", removed: 0, detail: CHANGED_SINCE_DISCOVERY }
    const backup = preserveOriginal(target.location, raw, options.now)
    replaceFileAtomically(target.location, stripped.text)
    return { item, status: "stripped", removed: stripped.removed, backup: backup.path }
  })
}

async function stripKeychain(item: StripPlanItem, target: Extract<StripTarget, { type: "keychain" }>, options: StripExecutionOptions): Promise<StripOutcome> {
  const backend = options.keychain
  if (!backend) return { item, status: "skipped", removed: 0, detail: "the keychain backend is not available" }
  const raw = await backend.get(KEYCHAIN_SERVICE_NAME, target.account)
  if (raw === null) return { item, status: "unchanged", removed: 0 }
  const stripped = stripAccountsText(raw)
  if (!stripped) return { item, status: "skipped", removed: 0, detail: "no longer a readable accounts document" }
  if (stripped.removed === 0) return { item, status: "unchanged", removed: 0 }

  // The keychain has no exclusive create; a backup entry that exists with
  // other contents is kept, and this one gets a timestamped name.
  let backupAccount = `${target.account}${MERIDIAN_BACKUP_SUFFIX}`
  const existing = await backend.get(KEYCHAIN_SERVICE_NAME, backupAccount)
  if (existing !== null && existing !== raw) backupAccount = `${backupAccount}.${backupStamp(options.now)}`
  return withPluginLocksAsync(locksFor(target.lockedStorePath, options), async () => {
    const current = await backend.get(KEYCHAIN_SERVICE_NAME, target.account)
    if (current !== raw) return { item, status: "skipped", removed: 0, detail: "the entry changed during the migration; re-run" }
    if (unseenTokenPresent(item, accountsRefreshTokens(raw))) return { item, status: "skipped", removed: 0, detail: CHANGED_SINCE_DISCOVERY }
    if (existing !== raw) await backend.set(KEYCHAIN_SERVICE_NAME, backupAccount, raw)
    if ((await backend.get(KEYCHAIN_SERVICE_NAME, backupAccount)) !== raw) {
      return { item, status: "skipped", removed: 0, detail: "the backup entry could not be verified; nothing was stripped" }
    }
    await backend.set(KEYCHAIN_SERVICE_NAME, target.account, stripped.text)
    return { item, status: "stripped", removed: stripped.removed, backup: `keychain:${KEYCHAIN_SERVICE_NAME}/${backupAccount}` }
  })
}

function stripOpencodeAuth(item: StripPlanItem, location: string, options: StripExecutionOptions): StripOutcome {
  const raw = readFileSync(location, "utf8")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { item, status: "skipped", removed: 0, detail: "no longer valid JSON" }
  }
  if (!isRecord(parsed) || !isRecord(parsed.openai) || parsed.openai.type !== "oauth") {
    return { item, status: "unchanged", removed: 0 }
  }
  const refresh = parsed.openai.refresh
  if (typeof refresh === "string" && refresh.trim() && unseenTokenPresent(item, [refresh.trim()])) {
    return { item, status: "skipped", removed: 0, detail: CHANGED_SINCE_DISCOVERY }
  }
  delete parsed.openai
  const backup = preserveOriginal(location, raw, options.now)
  replaceFileAtomically(location, `${JSON.stringify(parsed, null, 2)}\n`)
  return { item, status: "stripped", removed: 1, backup: backup.path }
}

export async function executeStrip(items: readonly StripPlanItem[], options: StripExecutionOptions): Promise<StripOutcome[]> {
  const outcomes: StripOutcome[] = []
  for (const item of items) {
    if (item.blockers.length > 0) {
      outcomes.push({ item, status: "skipped", removed: 0, detail: item.blockers.join("; ") })
      continue
    }
    const { target } = item
    try {
      if (target.type === "document") outcomes.push(stripDocument(item, target, options))
      else if (target.type === "keychain") outcomes.push(await stripKeychain(item, target, options))
      else if (target.type === "opencode-auth") outcomes.push(stripOpencodeAuth(item, target.location, options))
      else if (!existsSync(target.location)) outcomes.push({ item, status: "unchanged", removed: 0 })
      else outcomes.push({ item, status: "stripped", removed: item.tokens, backup: moveDirectoryAside(target.location, options.now) })
    } catch (error) {
      outcomes.push({ item, status: "skipped", removed: 0, detail: (error as Error).message })
    }
  }
  return outcomes
}
