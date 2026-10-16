import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { directoryRenameWasBlockedSync, syncDirectoryDurablySync } from "../session/durableFileSystem"
import {
  createRecoveryClaimOwner,
  getRecoveryClaimPath,
  getRecoveryClaimTombstonePath,
  parseRecoveryClaimOwnerJson,
  recoveryClaimOwnerIsDead,
  type RecoveryClaimOwner,
} from "../session/recoveryClaim"

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function readOwner(path: string): RecoveryClaimOwner | undefined {
  try {
    return parseRecoveryClaimOwnerJson(readFileSync(join(path, "owner.json"), "utf8"))
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}

function publish(path: string, owner: RecoveryClaimOwner): boolean {
  const candidate = `${path}.candidate-${owner.token}`
  mkdirSync(candidate, { mode: 0o700 })
  try {
    const fd = openSync(join(candidate, "owner.json"), "wx", 0o600)
    try {
      writeFileSync(fd, JSON.stringify(owner))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    syncDirectoryDurablySync(candidate)
    try {
      renameSync(candidate, path)
      syncDirectoryDurablySync(dirname(path))
      return true
    } catch (error) {
      if (directoryRenameWasBlockedSync(error, path)) return false
      throw error
    }
  } finally {
    rmSync(candidate, { recursive: true, force: true })
  }
}

function retireClaim(path: string, generation: string): boolean {
  const observed = readOwner(path)
  if (!observed || observed.generation !== generation || !recoveryClaimOwnerIsDead(observed)) return false
  const tombstone = getRecoveryClaimTombstonePath(path, observed.token)
  const current = readOwner(path)
  if (current?.token !== observed.token || current.generation !== generation) return false
  try {
    // A nonempty, permanent tombstone is an atomic no-replace fence. If another
    // reclaimer moved this generation first, our delayed rename cannot move its
    // live successor onto the same destination. Never prune these online.
    renameSync(path, tombstone)
    syncDirectoryDurablySync(dirname(path))
    return true
  } catch (error) {
    if (missing(error) || directoryRenameWasBlockedSync(error, tombstone)) return false
    throw error
  }
}

/** Serialize canonical retirement for one dead writer generation, including crash recovery. */
export function withWriterRecoveryClaim(lockPath: string, generation: string, retire: () => boolean): boolean {
  const path = getRecoveryClaimPath(lockPath, generation)
  const owner = createRecoveryClaimOwner(generation)
  if (!publish(path, owner)) {
    if (!retireClaim(path, generation) || !publish(path, owner)) return false
  }
  try {
    return retire()
  } finally {
    // A live claimant cannot be recovered. Only this owner can remove its claim.
    if (readOwner(path)?.token === owner.token) rmSync(path, { recursive: true })
  }
}
