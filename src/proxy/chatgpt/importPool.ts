/**
 * Moving the plugin's ChatGPT accounts into Meridian's own store, once.
 *
 * This runs a single time, during the ownership transfer, with the plugin
 * stopped and no other writer alive. At that moment the plugin's pool is the
 * only surviving copy of the operator's refresh tokens, so this module reads
 * it and never writes it - there is no second attempt to correct a damaged
 * source with.
 *
 * It is its own reader rather than a caller of the dashboard's. That reader
 * deliberately does not project `refreshToken` into Meridian's model, which is
 * the property its no-write test pins; an importer built on it would move
 * every field except the one that matters.
 *
 * Refusal is the default disposition. A partial or approximate import produces
 * a store that looks populated and is wrong about whose token is whose, and
 * the operator's own verification step counts accounts rather than reading
 * them.
 */

import { randomUUID } from "node:crypto"
import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"
import { syncDirectoryDurablySync } from "../session/durableFileSystem"
import { acquireWriterLease, type WriterLease } from "./lease"
import { createChatGptCredentialStore } from "./credentials"
import { chatGptLockPath } from "./paths"

/** The plugin's storage schema this importer was written against. */
const SUPPORTED_POOL_VERSION = 3

const ACCOUNT_ID_TAIL_LENGTH = 6

/** The source pool cannot be used as it stands. Nothing has been written. */
export class PoolSourceError extends Error {
  readonly poolPath: string

  constructor(poolPath: string, detail: string) {
    super(`Cannot import ${poolPath}: ${detail}.`)
    this.name = "PoolSourceError"
    this.poolPath = poolPath
  }
}

/** The import would destroy something. Nothing has been written. */
export class PoolImportRefusedError extends Error {
  constructor(detail: string) {
    super(`Refusing to import: ${detail}.`)
    this.name = "PoolImportRefusedError"
  }
}

/** What an account was, with no part of what it can authenticate as. */
export interface ImportedAccountSummary {
  accountUserId: string
  email: string | null
  /** Last six of the workspace id - enough to recognize, too little to use. */
  accountIdTail: string
  disabledInPool: boolean
}

export interface PoolImportResult {
  imported: ImportedAccountSummary[]
  storePath: string
  /** Present only when an existing store was displaced and preserved. */
  backupPath?: string
}

export interface PoolImportOptions {
  poolPath: string
  storePath: string
  /** Permission to replace an existing store. Useless without `backupPath`. */
  force?: boolean
  backupPath?: string
  /** Default 0: during the transfer, another holder is news rather than a queue. */
  leaseWaitMs?: number
  staleMs?: number
  heartbeatMs?: number
}

interface PoolAccount {
  accountUserId: string
  accountId: string
  email: string | null
  refreshToken: string
  accessToken: string | null
  expiresAt: number | null
  tokenRotatedAt: number | null
  disabledInPool: boolean
}

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Field NAMES appear in the message; a field VALUE never does. */
function requiredString(
  record: Record<string, unknown>,
  field: string,
  index: number,
  poolPath: string,
): string {
  const value = record[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new PoolSourceError(poolPath, `account #${index + 1} has no usable "${field}"`)
  }
  return value
}

function readPool(poolPath: string): PoolAccount[] {
  let raw: string
  try {
    raw = readFileSync(poolPath, "utf8")
  } catch (error) {
    throw new PoolSourceError(poolPath, `it could not be read (${errnoCode(error) ?? "unknown error"})`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PoolSourceError(poolPath, "it is not valid JSON")
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PoolSourceError(poolPath, "it is not a pool document")
  }

  const document = parsed as Record<string, unknown>
  if (document.version !== SUPPORTED_POOL_VERSION) {
    throw new PoolSourceError(
      poolPath,
      `it reports schema version ${JSON.stringify(document.version)} and this importer was written `
      + `against version ${SUPPORTED_POOL_VERSION}`,
    )
  }
  if (!Array.isArray(document.accounts)) {
    throw new PoolSourceError(poolPath, "its accounts are missing or are not a list")
  }
  if (document.accounts.length === 0) {
    throw new PoolSourceError(poolPath, "it holds no accounts")
  }

  const seats = new Set<string>()
  return document.accounts.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new PoolSourceError(poolPath, `account #${index + 1} is not an object`)
    }
    const record = entry as Record<string, unknown>

    // No substitute for a missing seat id, and `accountId` is the tempting
    // one: it is shared between distinct people in a real pool, so falling
    // back to it merges two accounts and files one person's single-use token
    // under the other's name.
    const accountUserId = requiredString(record, "accountUserId", index, poolPath)
    if (seats.has(accountUserId)) {
      throw new PoolSourceError(poolPath, `two accounts claim the seat "${accountUserId}"`)
    }
    seats.add(accountUserId)

    return {
      accountUserId,
      accountId: requiredString(record, "accountId", index, poolPath),
      email: optionalString(record.email),
      refreshToken: requiredString(record, "refreshToken", index, poolPath),
      accessToken: optionalString(record.accessToken),
      expiresAt: optionalNumber(record.expiresAt),
      tokenRotatedAt: optionalNumber(record.tokenRotatedAt),
      disabledInPool: record.enabled === false,
    }
  })
}

function preserveExistingStore(options: PoolImportOptions): string | undefined {
  const { storePath, backupPath } = options
  if (!existsSync(storePath)) return undefined

  if (!options.force) {
    throw new PoolImportRefusedError(
      `a ChatGPT store already exists at ${storePath}. Its tokens may already have been rotated, `
      + "which would leave the pool's copies dead; replacing it needs --force and a --backup path",
    )
  }
  if (!backupPath) {
    throw new PoolImportRefusedError(
      `--force needs a --backup path: the store at ${storePath} is the only copy of its refresh tokens`,
    )
  }

  const displaced = readFileSync(storePath)
  let fd: number
  try {
    // Exclusive create: a backup that overwrites is not a backup.
    fd = openSync(backupPath, "wx", 0o600)
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw new PoolImportRefusedError(`the backup path ${backupPath} already holds a file`)
    }
    throw error
  }
  try {
    fchmodSync(fd, 0o600)
    writeFileSync(fd, displaced)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return backupPath
}

/**
 * Build the whole store beside its destination, then move it into place.
 *
 * Written through the ordinary lease-guarded writer, at a staging path, so
 * this adds no second way to write a credential file. The final rename is the
 * only mutation of the destination: a crash part-way leaves an existing store
 * untouched rather than half-replaced, and leaves a fresh import absent rather
 * than present-and-incomplete - which would then look like a store worth
 * refusing to overwrite.
 */
function publishImportedStore(
  storePath: string,
  accounts: readonly PoolAccount[],
  lease: WriterLease,
): void {
  const staging = `${storePath}.import-${process.pid}-${randomUUID()}`
  try {
    const store = createChatGptCredentialStore({ path: staging, lease })
    for (const account of accounts) {
      store.commitAccount(account.accountUserId, () => ({
        accountUserId: account.accountUserId,
        accountId: account.accountId,
        email: account.email,
        refreshToken: account.refreshToken,
        accessToken: account.accessToken,
        expiresAt: account.expiresAt,
        tokenRotatedAt: account.tokenRotatedAt,
        // An import is not an interrupted exchange. Carrying a stamp in would
        // put every imported account straight into REQUIRES-REAUTH.
        exchangeStartedAt: null,
      }))
    }
    lease.assertValid()
    renameSync(staging, storePath)
    syncDirectoryDurablySync(dirname(storePath))
  } catch (error) {
    try {
      unlinkSync(staging)
    } catch (cleanupError) {
      if (errnoCode(cleanupError) !== "ENOENT") {
        console.error("[chatgpt] import staging cleanup failed:", (cleanupError as Error).message)
      }
    }
    throw error
  }
}

function summarise(account: PoolAccount): ImportedAccountSummary {
  return {
    accountUserId: account.accountUserId,
    email: account.email,
    accountIdTail: account.accountId.slice(-ACCOUNT_ID_TAIL_LENGTH),
    disabledInPool: account.disabledInPool,
  }
}

export async function importCodexPool(options: PoolImportOptions): Promise<PoolImportResult> {
  const { storePath } = options

  // Read and validate BEFORE taking the lease. Holding it is what tells any
  // other Meridian to stand down, and a pool that was never usable should not
  // have interrupted anything to find that out.
  const accounts = readPool(options.poolPath)

  const lease = await acquireWriterLease({
    lockPath: chatGptLockPath(storePath),
    staleMs: options.staleMs,
    heartbeatMs: options.heartbeatMs,
    waitMs: options.leaseWaitMs ?? 0,
  })

  try {
    const backupPath = preserveExistingStore(options)
    publishImportedStore(storePath, accounts, lease)
    return {
      imported: accounts.map(summarise),
      storePath,
      ...(backupPath ? { backupPath } : {}),
    }
  } finally {
    lease.release()
  }
}
