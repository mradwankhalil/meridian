/**
 * Per-process scratch directories the test preload creates, and their cleanup.
 *
 * Every `bun test` process gets its own settings, session and temp directory
 * under the system temp dir, keyed by pid. The temp directory becomes the
 * run's TMPDIR, so whatever a test makes with `tmpdir()` - and whatever a
 * process it spawns with `process.env` makes there - lands inside it. `npm test` starts a series
 * of such processes, so without cleanup each run leaves its directories
 * behind, indefinitely.
 *
 * The owning process removes its own pair when its run finishes, which covers
 * passing, failing and timed-out runs alike. A process killed by a signal never gets to
 * do that, so each new process also sweeps leftovers whose pid is no longer
 * running. A directory whose pid is alive is never touched: it may belong to a
 * concurrent run.
 */

import { readdirSync, rmSync, type Dirent } from "node:fs"
import { join } from "node:path"

const TEST_DIR_PATTERN = /^meridian-test-(?:settings|sessions|tmp)-([1-9]\d*)$/
const MAX_PID = 0x7fffffff

export function testDirsFor(root: string, pid: number) {
  return {
    configDir: join(root, `meridian-test-settings-${pid}`),
    sessionDir: join(root, `meridian-test-sessions-${pid}`),
    tempDir: join(root, `meridian-test-tmp-${pid}`),
  }
}

export function isProcessAlive(
  pid: number,
  probe: (pid: number) => unknown = pid => process.kill(pid, 0),
): boolean {
  try {
    probe(pid)
    return true
  } catch (error) {
    // Only ESRCH establishes a dead owner. EPERM and unexpected errors must
    // preserve the directory because the process may still be running.
    return !(error instanceof Error && "code" in error && error.code === "ESRCH")
  }
}

/** Remove a scratch directory. Teardown and stale sweeps are best effort and
 *  retry failures on the next run; startup must check this result to avoid
 *  inheriting stale state when resetting its own pair fails. */
export function removeTestDir(dir: string): boolean {
  try {
    rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    // Left for the next run's sweepStaleTestDirs; do not report a removal.
    return false
  }
}

/** Delete preload scratch directories under `root` whose owning pid is gone.
 *  Returns the directories removed. */
export function sweepStaleTestDirs(
  root: string,
  alive: (pid: number) => boolean = isProcessAlive,
  remove: (dir: string) => boolean = removeTestDir,
): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  const removed: string[] = []
  for (const entry of entries) {
    // Do not remove unrelated files or symlinks with a matching basename.
    if (!entry.isDirectory()) continue
    const match = TEST_DIR_PATTERN.exec(entry.name)
    if (!match) continue
    const pid = Number(match[1])
    if (!Number.isSafeInteger(pid) || pid > MAX_PID || pid === process.pid || alive(pid)) continue
    const dir = join(root, entry.name)
    if (remove(dir)) removed.push(dir)
  }
  return removed
}
