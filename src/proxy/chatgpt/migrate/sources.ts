/**
 * Finding every copy of a ChatGPT refresh token that oc-codex-multi-auth or
 * opencode holds, and choosing the one copy per account that is still alive.
 *
 * Refresh tokens are single-use and rotate on every exchange, so the same
 * account routinely appears several times with different tokens: the live
 * store, a per-project store, the flagged store, a dozen pre-write snapshots
 * under `backups/`, the keychain, and opencode's own `auth.json`. Only the
 * most recently issued of those still works; every older one has already been
 * spent. Importing an older one gives Meridian a dead account, and importing
 * two gives it one dead and one live account under the same seat.
 *
 * Identity is `accountUserId` - the seat - never `accountId`, which is the
 * workspace and is shared between people. A record with no seat id and no
 * access token to read one from cannot be placed and is reported, not guessed.
 *
 * Nothing in this module returns or formats a token value. Callers get the
 * values inside `CandidateCredential` to hand to the importer, and every
 * report built from it prints lengths and sources only.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type { KeychainBackend } from "./keychain"
import {
  ACCOUNTS_FILE_NAME,
  FLAGGED_ACCOUNTS_FILE_NAME,
  KEYCHAIN_SERVICE_NAME,
  LEGACY_ACCOUNTS_FILE_NAME,
  LEGACY_BLOCKED_ACCOUNTS_FILE_NAME,
  LEGACY_FLAGGED_ACCOUNTS_FILE_NAME,
  keychainAccountKey,
  keychainFlaggedKey,
  opencodeAuthPath,
  pluginConfigDir,
  pluginProjectsDir,
  type MigrationEnvironment,
} from "./layout"

export type SourceKind =
  | "store"
  | "legacy-store"
  | "flagged"
  | "keychain"
  | "keychain-flagged"
  | "opencode-auth"
  | "backup"

/** Which kinds hold credentials the plugin or opencode will refresh on their own. */
export const LIVE_SOURCE_KINDS: ReadonlySet<SourceKind> = new Set([
  "store", "legacy-store", "flagged", "keychain", "keychain-flagged", "opencode-auth",
])

/**
 * Tie-break when two copies cannot be ordered by time. Lower wins: the live
 * store is what the plugin refreshes from, a backup is what it refreshed from
 * once.
 */
const SOURCE_RANK: Record<SourceKind, number> = {
  store: 0,
  keychain: 1,
  flagged: 2,
  "keychain-flagged": 3,
  "legacy-store": 4,
  "opencode-auth": 5,
  backup: 6,
}

export interface CredentialSource {
  kind: SourceKind
  /** A file path, or `keychain:<service>/<account>`. */
  location: string
  /** `null` for global storage, else the plugin's per-project storage key. */
  projectKey: string | null
  /** Store file whose locks guard this source; absent for auth.json and backups. */
  lockedStorePath?: string
  /** Keychain account key, for keychain sources. */
  keychainAccount?: string
}

export interface CandidateCredential {
  accountUserId: string
  accountId: string | null
  email: string | null
  refreshToken: string
  accessToken: string | null
  expiresAt: number | null
  tokenRotatedAt: number | null
  /** `iat` of the access token, in ms. */
  issuedAt: number | null
  disabled: boolean
  source: CredentialSource
  /** Position of the record in its source, for reports. */
  index: number
}

export interface SourceProblem {
  location: string
  kind: SourceKind
  detail: string
}

export interface UnplacedRecord {
  location: string
  kind: SourceKind
  index: number
  email: string | null
  reason: string
}

export interface ScannedSource {
  source: CredentialSource
  /** Accounts found, including ones with no refresh token. */
  records: number
  candidates: number
}

export interface Discovery {
  scanned: ScannedSource[]
  candidates: CandidateCredential[]
  problems: SourceProblem[]
  unplaced: UnplacedRecord[]
  keychainChecked: boolean
}

export interface DiscoveryOptions {
  env: MigrationEnvironment
  /** Extra project roots whose `.opencode/openai-codex-accounts.json` should be read. */
  projectRoots?: readonly string[]
  /** Read the keychain entries. Absent backend means the keychain is not consulted. */
  keychain?: KeychainBackend | null
}

// ---------------------------------------------------------------------------
// JWT claims (identity only - signatures are not checked and do not matter)
// ---------------------------------------------------------------------------

const JWT_CLAIM_PATH = "https://api.openai.com/auth"

function decodeJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) return null
  const payload = token.split(".")[1]
  if (!payload) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function authClaims(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const claims = payload?.[JWT_CLAIM_PATH]
  return isRecord(claims) ? claims : null
}

export function accountUserIdFromAccessToken(token: string | null): string | null {
  return nonEmptyString(authClaims(decodeJwtPayload(token))?.chatgpt_account_user_id)
}

export function accountIdFromAccessToken(token: string | null): string | null {
  return nonEmptyString(authClaims(decodeJwtPayload(token))?.chatgpt_account_id)
}

function issuedAtFromAccessToken(token: string | null): number | null {
  const iat = decodeJwtPayload(token)?.iat
  return typeof iat === "number" && Number.isFinite(iat) ? iat * 1000 : null
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

/** The plugin's documents are `{ version, accounts[] }`; V1 and V3 carry the same account fields. */
const SUPPORTED_DOCUMENT_VERSIONS = new Set([1, 3])

class SourceParseError extends Error {}

function parseAccountsDocument(raw: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new SourceParseError("it is not valid JSON")
  }
  if (!isRecord(parsed)) throw new SourceParseError("its top level is not an object")
  if (!SUPPORTED_DOCUMENT_VERSIONS.has(parsed.version as number)) {
    throw new SourceParseError(`it declares schema version ${JSON.stringify(parsed.version)}`)
  }
  if (!Array.isArray(parsed.accounts)) throw new SourceParseError("its accounts are not a list")
  return parsed.accounts
}

interface Collector {
  scanned: ScannedSource[]
  candidates: CandidateCredential[]
  problems: SourceProblem[]
  unplaced: UnplacedRecord[]
}

function collectRecords(collector: Collector, source: CredentialSource, accounts: unknown[]): void {
  let candidates = 0
  accounts.forEach((entry, index) => {
    if (!isRecord(entry)) {
      collector.unplaced.push({
        location: source.location, kind: source.kind, index, email: null, reason: "not an object",
      })
      return
    }
    const email = nonEmptyString(entry.email)
    const refreshToken = nonEmptyString(entry.refreshToken)
    if (!refreshToken) return // Already stripped, or never had one: nothing to move.
    const accessToken = nonEmptyString(entry.accessToken)
    const accountUserId = nonEmptyString(entry.accountUserId) ?? accountUserIdFromAccessToken(accessToken)
    if (!accountUserId) {
      collector.unplaced.push({
        location: source.location,
        kind: source.kind,
        index,
        email,
        reason: "no accountUserId and no access token to read the seat from",
      })
      return
    }
    candidates++
    collector.candidates.push({
      accountUserId,
      accountId: nonEmptyString(entry.accountId) ?? accountIdFromAccessToken(accessToken),
      email,
      refreshToken,
      accessToken,
      expiresAt: finiteNumber(entry.expiresAt),
      tokenRotatedAt: finiteNumber(entry.tokenRotatedAt),
      issuedAt: issuedAtFromAccessToken(accessToken),
      disabled: entry.enabled === false,
      source,
      index,
    })
  })
  collector.scanned.push({ source, records: accounts.length, candidates })
}

function readDocumentFile(collector: Collector, source: CredentialSource): void {
  let raw: string
  try {
    raw = readFileSync(source.location, "utf8")
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return
    collector.problems.push({
      location: source.location, kind: source.kind, detail: `unreadable (${errnoCode(error) ?? "error"})`,
    })
    return
  }
  try {
    collectRecords(collector, source, parseAccountsDocument(raw))
  } catch (error) {
    if (!(error instanceof SourceParseError)) throw error
    collector.problems.push({ location: source.location, kind: source.kind, detail: error.message })
  }
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

interface StoreDirectory {
  dir: string
  projectKey: string | null
}

type UnreadableDirectory = (dir: string, code: string) => void

function listEntries(dir: string, onUnreadable?: UnreadableDirectory) {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    const code = errnoCode(error) ?? "error"
    if (code !== "ENOENT") onUnreadable?.(dir, code)
    return []
  }
}

/** The global store directory, then every per-project one the plugin created. */
export function pluginStoreDirectories(env: MigrationEnvironment, onUnreadable?: UnreadableDirectory): StoreDirectory[] {
  const projectsDir = pluginProjectsDir(env)
  return [
    { dir: pluginConfigDir(env), projectKey: null },
    ...listEntries(projectsDir, onUnreadable)
      .filter(entry => entry.isDirectory())
      .map(entry => ({ dir: join(projectsDir, entry.name), projectKey: entry.name })),
  ]
}

function backupFiles(dir: string, onUnreadable: UnreadableDirectory): string[] {
  const backups = join(dir, "backups")
  return listEntries(backups, onUnreadable)
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => join(backups, entry.name))
}

const KNOWN_STORE_FILE_NAMES = [
  ACCOUNTS_FILE_NAME,
  LEGACY_ACCOUNTS_FILE_NAME,
  FLAGGED_ACCOUNTS_FILE_NAME,
  LEGACY_FLAGGED_ACCOUNTS_FILE_NAME,
  LEGACY_BLOCKED_ACCOUNTS_FILE_NAME,
]

/** Lock files, write staging, and this migration's own backups - none of them a store copy. */
const NOT_A_COPY = /\.(lock|tmp)$|\.meridian-backup|\.meridian-staging-|\.import-/

/**
 * Files named after a store that the plugin never reads - an operator's
 * `accounts.json.copy`, say. They can hold refresh tokens that are live, spent
 * or both, and nothing here can tell which, so they are reported and left alone.
 */
function strayCopies(dir: string): string[] {
  return listEntries(dir)
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => KNOWN_STORE_FILE_NAMES.some(known => name !== known && name.startsWith(known)) && !NOT_A_COPY.test(name))
    .map(name => join(dir, name))
}

function readOpencodeAuth(collector: Collector, env: MigrationEnvironment): void {
  const location = opencodeAuthPath(env)
  const source: CredentialSource = { kind: "opencode-auth", location, projectKey: null }
  let raw: string
  try {
    raw = readFileSync(location, "utf8")
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return
    collector.problems.push({ location, kind: source.kind, detail: `unreadable (${errnoCode(error) ?? "error"})` })
    return
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    collector.problems.push({ location, kind: source.kind, detail: "it is not valid JSON" })
    return
  }
  const entry = isRecord(parsed) ? parsed.openai : undefined
  if (!isRecord(entry) || entry.type !== "oauth") {
    collector.scanned.push({ source, records: 0, candidates: 0 })
    return
  }
  // opencode's shape: { type, refresh, access, expires, accountId }.
  collectRecords(collector, source, [{
    refreshToken: entry.refresh,
    accessToken: entry.access,
    expiresAt: entry.expires,
    accountId: entry.accountId,
  }])
}

async function readKeychain(
  collector: Collector,
  backend: KeychainBackend,
  directories: readonly StoreDirectory[],
): Promise<void> {
  for (const { dir, projectKey } of directories) {
    const entries: Array<[SourceKind, string, string]> = [
      ["keychain", keychainAccountKey(projectKey), join(dir, ACCOUNTS_FILE_NAME)],
      ["keychain-flagged", keychainFlaggedKey(projectKey), join(dir, FLAGGED_ACCOUNTS_FILE_NAME)],
    ]
    for (const [kind, account, lockedStorePath] of entries) {
      const location = `keychain:${KEYCHAIN_SERVICE_NAME}/${account}`
      const source: CredentialSource = { kind, location, projectKey, lockedStorePath, keychainAccount: account }
      let blob: string | null
      try {
        blob = await backend.get(KEYCHAIN_SERVICE_NAME, account)
      } catch (error) {
        collector.problems.push({ location, kind, detail: `keychain read failed (${(error as Error).name})` })
        continue
      }
      if (blob === null) continue
      try {
        collectRecords(collector, source, parseAccountsDocument(blob))
      } catch (error) {
        if (!(error instanceof SourceParseError)) throw error
        collector.problems.push({ location, kind, detail: error.message })
      }
    }
  }
}

export async function discoverCredentials(options: DiscoveryOptions): Promise<Discovery> {
  const { env } = options
  const collector: Collector = { scanned: [], candidates: [], problems: [], unplaced: [] }
  const unreadable: UnreadableDirectory = (location, code) => {
    collector.problems.push({ location, kind: "store", detail: `directory cannot be listed (${code}); any stores inside it were not read` })
  }
  const directories = pluginStoreDirectories(env, unreadable)

  for (const { dir, projectKey } of directories) {
    for (const location of strayCopies(dir)) {
      collector.problems.push({ location, kind: "store", detail: "a copy the plugin never reads; not imported and not stripped - check it by hand" })
    }
    const files: Array<[SourceKind, string]> = [
      ["store", ACCOUNTS_FILE_NAME],
      ["legacy-store", LEGACY_ACCOUNTS_FILE_NAME],
      ["flagged", FLAGGED_ACCOUNTS_FILE_NAME],
      ["flagged", LEGACY_FLAGGED_ACCOUNTS_FILE_NAME],
      ["flagged", LEGACY_BLOCKED_ACCOUNTS_FILE_NAME],
    ]
    for (const [kind, name] of files) {
      const location = join(dir, name)
      readDocumentFile(collector, { kind, location, projectKey, lockedStorePath: location })
    }
    for (const location of backupFiles(dir, unreadable)) {
      readDocumentFile(collector, { kind: "backup", location, projectKey })
    }
  }

  // Older plugin versions seeded a project's store from a file inside the repo.
  for (const root of options.projectRoots ?? []) {
    const location = join(root, ".opencode", LEGACY_ACCOUNTS_FILE_NAME)
    if (existsSync(location) && statSync(location).isFile()) {
      readDocumentFile(collector, { kind: "legacy-store", location, projectKey: null, lockedStorePath: location })
    }
  }

  readOpencodeAuth(collector, env)

  const keychainChecked = Boolean(options.keychain)
  if (options.keychain) await readKeychain(collector, options.keychain, directories)

  return { ...collector, keychainChecked }
}

// ---------------------------------------------------------------------------
// Choosing one copy per seat
// ---------------------------------------------------------------------------

/**
 * When the credential was minted. `tokenRotatedAt` is the plugin's own stamp
 * of the exchange; the access token's `iat` records the same event for copies
 * the plugin did not write (opencode's auth.json).
 */
function mintedAt(candidate: CandidateCredential): number | null {
  return candidate.tokenRotatedAt ?? candidate.issuedAt
}

/** Negative when `a` is the fresher copy. */
export function compareFreshness(a: CandidateCredential, b: CandidateCredential): number {
  const aMinted = mintedAt(a)
  const bMinted = mintedAt(b)
  if (aMinted !== null && bMinted !== null && aMinted !== bMinted) return bMinted - aMinted
  if (aMinted !== null && bMinted === null) return -1
  if (aMinted === null && bMinted !== null) return 1
  const aExpires = a.expiresAt ?? -1
  const bExpires = b.expiresAt ?? -1
  if (aExpires !== bExpires) return bExpires - aExpires
  return SOURCE_RANK[a.source.kind] - SOURCE_RANK[b.source.kind]
}

export type CopyRelation = "same-token" | "older-token" | "undated-token"

export interface AccountCopy {
  source: CredentialSource
  relation: CopyRelation
}

export interface AccountPlan {
  accountUserId: string
  accountId: string | null
  email: string | null
  winner: CandidateCredential
  copies: AccountCopy[]
  /** Distinct refresh tokens seen for this seat. */
  distinctTokens: number
  /** Every copy came from a backup: the seat was removed from the live pool. */
  onlyInBackups: boolean
  /** The chosen copy is a backup even though a live source holds this seat. */
  winnerFromBackup: boolean
  /** Two different tokens could not be ordered by time and the source rank decided. */
  tieBrokenBySource: boolean
  disabled: boolean
}

export function planAccounts(candidates: readonly CandidateCredential[]): AccountPlan[] {
  const bySeat = new Map<string, CandidateCredential[]>()
  for (const candidate of candidates) {
    const list = bySeat.get(candidate.accountUserId)
    if (list) list.push(candidate)
    else bySeat.set(candidate.accountUserId, [candidate])
  }

  const plans: AccountPlan[] = []
  for (const [accountUserId, list] of bySeat) {
    const sorted = [...list].sort(compareFreshness)
    const winner = sorted[0]!
    const runnerUpWithOtherToken = sorted.find(copy => copy.refreshToken !== winner.refreshToken)
    const tieBrokenBySource = runnerUpWithOtherToken !== undefined
      && mintedAt(winner) === mintedAt(runnerUpWithOtherToken)
      && winner.expiresAt === runnerUpWithOtherToken.expiresAt

    const copies = sorted.slice(1).map((copy): AccountCopy => ({
      source: copy.source,
      relation: copy.refreshToken === winner.refreshToken
        ? "same-token"
        : mintedAt(copy) === null && copy.expiresAt === null ? "undated-token" : "older-token",
    }))

    const live = list.some(copy => LIVE_SOURCE_KINDS.has(copy.source.kind))
    plans.push({
      accountUserId,
      accountId: winner.accountId ?? sorted.find(copy => copy.accountId)?.accountId ?? null,
      email: winner.email ?? sorted.find(copy => copy.email)?.email ?? null,
      winner,
      copies,
      distinctTokens: new Set(list.map(copy => copy.refreshToken)).size,
      onlyInBackups: !live,
      winnerFromBackup: live && winner.source.kind === "backup",
      tieBrokenBySource,
      disabled: list.some(copy => LIVE_SOURCE_KINDS.has(copy.source.kind) && copy.disabled),
    })
  }
  return plans.sort((a, b) => (a.email ?? a.accountUserId).localeCompare(b.email ?? b.accountUserId))
}
