/**
 * The file mechanics every migration write shares: preserving the original,
 * replacing a file atomically, and taking oc-codex-multi-auth's own locks.
 *
 * ORIGINALS ARE NEVER OVERWRITTEN. `<name>.meridian-backup` is created with
 * an exclusive open. A re-run that finds it holding the same bytes reuses it;
 * one that finds different bytes - the tokens rotated since the last run -
 * keeps both by adding a timestamp, because the older original may be the
 * only copy of a token the newer one has already spent.
 *
 * THE PLUGIN'S LOCKS ARE proper-lockfile LOCKS: a directory created with
 * `mkdir` at `<store>.transaction.lock` / `<store>.refresh.lock`, considered
 * abandoned once its mtime is older than the holder's stale window (10 s and
 * 60 s in `lib/storage/transaction-lock.ts`). Taking the same directory the
 * same way excludes a live plugin writer without depending on the package.
 */

import { randomBytes } from "node:crypto"
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
  existsSync,
  chmodSync,
  readdirSync,
} from "node:fs"
import { basename, dirname, join } from "node:path"
import { syncDirectoryDurablySync } from "../../session/durableFileSystem"
import { MERIDIAN_BACKUP_SUFFIX } from "./layout"

function errnoCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

/** `20260927T205714Z` - sortable, and valid in a file name on every platform. */
export function backupStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
}

/** Where the original of `path` goes, before anything is written. */
export function plannedBackupPath(path: string, content: Buffer | string, now: Date): { path: string; reused: boolean } {
  const primary = `${path}${MERIDIAN_BACKUP_SUFFIX}`
  if (!existsSync(primary)) return { path: primary, reused: false }
  const bytes = typeof content === "string" ? Buffer.from(content) : content
  if (readFileSync(primary).equals(bytes)) return { path: primary, reused: true }
  // One run may preserve the same file twice within a second (the plugin and provider steps both edit it).
  const stamped = `${primary}.${backupStamp(now)}`
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? stamped : `${stamped}-${n}`
    if (!existsSync(candidate)) return { path: candidate, reused: false }
    if (readFileSync(candidate).equals(bytes)) return { path: candidate, reused: true }
  }
}

function writeExclusive(path: string, content: Buffer | string, mode: number): void {
  const fd = openSync(path, "wx", mode)
  try {
    writeFileSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  chmodSync(path, mode)
}

/** Copy the current bytes of `path` to its `.meridian-backup`, mode 0600. */
export function preserveOriginal(path: string, content: Buffer | string, now: Date): { path: string; reused: boolean } {
  const planned = plannedBackupPath(path, content, now)
  if (planned.reused) return planned
  try {
    writeExclusive(planned.path, content, 0o600)
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      throw new Error(`Refusing to overwrite ${planned.path}, which appeared while the migration was running.`)
    }
    throw error
  }
  syncDirectoryDurablySync(dirname(planned.path))
  return planned
}

/**
 * Every original preserved for `path`, oldest first: `<name>.meridian-backup`
 * is the first one taken, and the timestamped ones sort in the order they were.
 */
export function backupsOf(path: string): string[] {
  const primary = `${basename(path)}${MERIDIAN_BACKUP_SUFFIX}`
  let names: string[]
  try {
    names = readdirSync(dirname(path))
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") return []
    throw error
  }
  const stamped = names.filter(name => name.startsWith(`${primary}.`)).sort()
  return [...(names.includes(primary) ? [primary] : []), ...stamped].map(name => join(dirname(path), name))
}

/** Replace `path` with `content` all at once, keeping its permission bits. */
export function replaceFileAtomically(path: string, content: string): void {
  let mode = 0o600
  try {
    mode = statSync(path).mode & 0o777
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") throw error
  }
  const staging = `${path}.meridian-staging-${process.pid}-${randomBytes(4).toString("hex")}`
  try {
    writeExclusive(staging, content, mode)
    renameSync(staging, path)
  } catch (error) {
    try {
      unlinkSync(staging)
    } catch (cleanupError) {
      if (errnoCode(cleanupError) !== "ENOENT") throw cleanupError
    }
    throw error
  }
  syncDirectoryDurablySync(dirname(path))
}

/** Move a directory aside under a name that does not exist yet. */
export function moveDirectoryAside(path: string, now: Date): string {
  const primary = `${path}${MERIDIAN_BACKUP_SUFFIX}`
  const target = existsSync(primary) ? `${primary}.${backupStamp(now)}` : primary
  renameSync(path, target)
  chmodSync(target, 0o700)
  syncDirectoryDurablySync(dirname(path))
  return target
}

// ---------------------------------------------------------------------------
// proper-lockfile compatible locks
// ---------------------------------------------------------------------------

export const TRANSACTION_LOCK_STALE_MS = 10_000
export const REFRESH_LOCK_STALE_MS = 60_000

export class PluginLockHeldError extends Error {
  readonly lockPath: string

  constructor(lockPath: string) {
    super(`${lockPath} is held by a running oc-codex-multi-auth writer. Stop it, then re-run.`)
    this.name = "PluginLockHeldError"
    this.lockPath = lockPath
  }
}

export interface HeldLock {
  lockPath: string
  release(): void
}

export interface LockOptions {
  staleMs: number
  /** How long to wait for a live holder. Waiting past `staleMs` lets an abandoned lock expire. */
  waitMs: number
  pollMs?: number
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function acquirePluginLock(lockPath: string, options: LockOptions): HeldLock {
  const deadline = Date.now() + options.waitMs
  mkdirSync(dirname(lockPath), { recursive: true })
  while (true) {
    try {
      mkdirSync(lockPath)
      return {
        lockPath,
        release() {
          try {
            rmdirSync(lockPath)
          } catch (error) {
            if (errnoCode(error) !== "ENOENT") throw error
          }
        },
      }
    } catch (error) {
      if (errnoCode(error) !== "EEXIST") throw error
    }
    let mtimeMs: number | null = null
    try {
      mtimeMs = statSync(lockPath).mtimeMs
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error
    }
    if (mtimeMs !== null && mtimeMs < Date.now() - options.staleMs) {
      // Abandoned by a holder that died: the plugin reclaims it the same way.
      try {
        rmdirSync(lockPath)
      } catch (error) {
        if (errnoCode(error) !== "ENOENT") throw error
      }
      continue
    }
    if (Date.now() >= deadline) throw new PluginLockHeldError(lockPath)
    sleepSync(options.pollMs ?? 100)
  }
}

/** Run `operation` holding each lock, taken in order and released in reverse. */
export function withPluginLocks<T>(locks: ReadonlyArray<{ path: string } & LockOptions>, operation: () => T): T {
  const held: HeldLock[] = []
  try {
    for (const lock of locks) held.push(acquirePluginLock(lock.path, lock))
    return operation()
  } finally {
    for (const lock of held.reverse()) lock.release()
  }
}

export async function withPluginLocksAsync<T>(
  locks: ReadonlyArray<{ path: string } & LockOptions>,
  operation: () => Promise<T>,
): Promise<T> {
  const held: HeldLock[] = []
  try {
    for (const lock of locks) held.push(acquirePluginLock(lock.path, lock))
    return await operation()
  } finally {
    for (const lock of held.reverse()) lock.release()
  }
}
