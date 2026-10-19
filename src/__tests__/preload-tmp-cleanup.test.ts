import { describe, expect, it } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { isProcessAlive, removeTestDir, sweepStaleTestDirs, testDirsFor } from "./test-tmp-dirs"

const PRELOAD = resolve(import.meta.dir, "preload.ts")

function withRoot(fn: (root: string) => void | Promise<void>) {
  return async () => {
    const root = mkdtempSync(join(tmpdir(), "meridian-preload-tmp-"))
    try {
      await fn(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

function childEnv(root: string) {
  return { ...process.env, TMPDIR: root, TMP: root, TEMP: root }
}

function testDirsIn(root: string) {
  return readdirSync(root).filter(name => name.startsWith("meridian-test-")).sort()
}

function writeFixture(root: string, body: string, name = "fixture") {
  const fixture = join(root, `${name}.test.ts`)
  writeFileSync(fixture, `import { expect, test } from "bun:test"\nimport { existsSync } from "node:fs"\n${body}\n`)
  return fixture
}

function runSuite(root: string, fixture: string, extraArgs: string[] = [], preloads = [PRELOAD]) {
  const result = spawnSync(process.execPath, ["test", ...preloads.flatMap(path => ["--preload", path]), ...extraArgs, fixture], {
    cwd: root, env: childEnv(root), encoding: "utf8", timeout: 15_000,
  })
  if (result.error) throw result.error
  return result
}

describe("test preload scratch directories", () => {
  it("are removed when a passing run exits", withRoot(root => {
    const fixture = writeFixture(root, `
      test("dirs exist under the redirected tmpdir while the run is live", () => {
        expect(process.env.MERIDIAN_CONFIG_DIR!.startsWith(${JSON.stringify(root)})).toBe(true)
        expect(existsSync(process.env.MERIDIAN_CONFIG_DIR!)).toBe(true)
        expect(existsSync(process.env.MERIDIAN_SESSION_DIR!)).toBe(true)
      })
    `)
    const result = runSuite(root, fixture)
    expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({ status: 0 })
    expect(testDirsIn(root)).toEqual([])
  }), 20_000)

  it("redirect the run's TMPDIR, so fixtures and children spawned with process.env are removed with it", withRoot(root => {
    const fixture = writeFixture(root, `
      import { spawnSync } from "node:child_process"
      import { mkdtempSync } from "node:fs"
      import { tmpdir } from "node:os"
      import { join } from "node:path"
      test("tmpdir() is this process's own directory", () => {
        expect(tmpdir()).toBe(join(${JSON.stringify(root)}, \`meridian-test-tmp-\${process.pid}\`))
        mkdtempSync(join(tmpdir(), "leaked-fixture-"))
        const child = spawnSync(process.execPath, ["-e", 'require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "leaked-child-"))'], { env: { ...process.env } })
        expect(child.status).toBe(0)
      })
    `)
    const result = runSuite(root, fixture)
    expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({ status: 0 })
    expect(readdirSync(root).filter(name => name.startsWith("meridian-test-") || name.startsWith("leaked-"))).toEqual([])
  }), 20_000)

  it("are removed when a run fails", withRoot(root => {
    const fixture = writeFixture(root, `test("fails", () => { expect(1).toBe(2) })`)
    const result = runSuite(root, fixture)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("fails")
    expect(testDirsIn(root)).toEqual([])
  }), 20_000)

  it("are removed when a test times out", withRoot(root => {
    const fixture = writeFixture(root, `test("hangs", () => new Promise(r => setTimeout(r, 10_000)))`)
    const result = runSuite(root, fixture, ["--timeout", "200"])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("timed out")
    expect(testDirsIn(root)).toEqual([])
  }), 20_000)

  it("left behind by a killed run are swept by the next run, sparing live owners", withRoot(async root => {
    const hanging = writeFixture(root, `test("hangs", () => new Promise(r => setTimeout(r, 60_000)))`)
    const child = spawn(process.execPath, ["test", "--preload", PRELOAD, "--timeout", "120000", hanging], {
      cwd: root, env: childEnv(root), stdio: "ignore",
    })
    let spawnError: Error | undefined
    const exited = new Promise<void>(resolve => {
      child.once("exit", () => resolve())
      child.once("error", error => { spawnError = error; resolve() })
    })
    try {
      if (child.pid === undefined) throw new Error("child has no process id")
      const killedDirs = testDirsFor(root, child.pid)
      const deadline = Date.now() + 10_000
      while (!(existsSync(killedDirs.configDir) && existsSync(killedDirs.sessionDir) && existsSync(killedDirs.tempDir))) {
        if (spawnError) throw spawnError
        if (child.exitCode !== null || child.signalCode !== null) throw new Error("child exited before creating scratch directories")
        if (Date.now() > deadline) throw new Error("child never created its scratch directories")
        await Bun.sleep(50)
      }
      expect(child.kill("SIGKILL")).toBe(true)
      await exited
      expect(existsSync(killedDirs.configDir)).toBe(true)
      expect(existsSync(killedDirs.sessionDir)).toBe(true)
      expect(existsSync(killedDirs.tempDir)).toBe(true)

      // This process is alive, so a directory carrying its pid must survive.
      const liveDirs = testDirsFor(root, process.pid)
      mkdirSync(liveDirs.configDir)
      mkdirSync(join(root, "meridian-test-settings-notapid"))

      const fixture = writeFixture(root, `test("passes", () => {})`)
      const result = runSuite(root, fixture)
      expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({ status: 0 })
      expect(testDirsIn(root)).toEqual([`meridian-test-settings-${process.pid}`, "meridian-test-settings-notapid"])
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await exited
    }
  }), 30_000)

  it("starts clean when the current pid already has scratch state", withRoot(root => {
    const seed = join(root, "seed-preload.ts")
    writeFileSync(seed, `
      import { mkdirSync, writeFileSync } from "node:fs"
      import { join } from "node:path"
      for (const kind of ["settings", "sessions"]) {
        const dir = join(${JSON.stringify(root)}, \`meridian-test-\${kind}-\${process.pid}\`)
        mkdirSync(dir)
        writeFileSync(join(dir, "stale-sentinel"), "old run")
      }
    `)
    const fixture = writeFixture(root, `
      test("old state is gone", () => {
        for (const dir of [process.env.MERIDIAN_CONFIG_DIR!, process.env.MERIDIAN_SESSION_DIR!]) {
          expect(existsSync(dir)).toBe(true)
          expect(existsSync(dir + "/stale-sentinel")).toBe(false)
        }
      })
    `)
    const result = runSuite(root, fixture, [], [seed, PRELOAD])
    expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({ status: 0 })
    expect(testDirsIn(root)).toEqual([])
  }), 20_000)

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("aborts when stale own-pid state cannot be reset", withRoot(root => {
    const seed = join(root, "denied-preload.ts")
    writeFileSync(seed, `
      import { chmodSync, mkdirSync } from "node:fs"
      import { join } from "node:path"
      mkdirSync(join(${JSON.stringify(root)}, \`meridian-test-settings-\${process.pid}\`))
      chmodSync(${JSON.stringify(root)}, 0o500)
    `)
    const fixture = writeFixture(root, `test("must not execute with inherited state", () => {})`)
    try {
      const result = runSuite(root, fixture, [], [seed, PRELOAD])
      expect(result.status).toBe(1)
      expect(result.stderr).toContain("Could not reset test scratch directory")
      expect(result.stderr).not.toContain("(pass)")
      expect(testDirsIn(root)).toHaveLength(1)
    } finally {
      chmodSync(root, 0o700)
    }
  }), 20_000)

  it("keeps scratch state through every file's teardown", withRoot(root => {
    const body = `
      import { afterAll } from "bun:test"
      function assertDirsExist() {
        expect(existsSync(process.env.MERIDIAN_CONFIG_DIR!)).toBe(true)
        expect(existsSync(process.env.MERIDIAN_SESSION_DIR!)).toBe(true)
      }
      test("dirs remain available", assertDirsExist)
      afterAll(assertDirsExist)
    `
    const first = writeFixture(root, body, "first")
    const second = writeFixture(root, body, "second")
    const result = runSuite(root, first, [second])
    expect({ status: result.status, output: result.stdout + result.stderr }).toMatchObject({ status: 0 })
    expect(testDirsIn(root)).toEqual([])
  }), 20_000)

  it("sweep removes only dead owners' directories", withRoot(root => {
    const dead = testDirsFor(root, 111111)
    const live = testDirsFor(root, 222222)
    for (const dir of [dead.configDir, dead.sessionDir, dead.tempDir, live.configDir, live.sessionDir, live.tempDir]) {
      mkdirSync(join(dir, "nested"), { recursive: true })
    }
    const removed = sweepStaleTestDirs(root, pid => pid === 222222)
    expect(removed.sort()).toEqual([dead.sessionDir, dead.configDir, dead.tempDir].sort())
    expect(testDirsIn(root)).toEqual(["meridian-test-sessions-222222", "meridian-test-settings-222222", "meridian-test-tmp-222222"])
  }))
})

describe("scratch directory deletion safety", () => {
  it("preserves owners unless the process probe confirms ESRCH", () => {
    const probeError = (code: string) => () => { throw Object.assign(new Error(code), { code }) }
    expect(isProcessAlive(process.pid)).toBe(true)
    expect(isProcessAlive(123, probeError("ESRCH"))).toBe(false)
    expect(isProcessAlive(123, probeError("EPERM"))).toBe(true)
    expect(isProcessAlive(123, probeError("EINVAL"))).toBe(true)
    expect(isProcessAlive(123, () => { throw new Error("unavailable") })).toBe(true)
  })

  it("preserves foreign names, files, symlinks and invalid pid encodings", withRoot(root => {
    const preserved = [
      "unrelated-directory",
      "meridian-test-settings-notapid",
      "meridian-test-settings-0",
      "meridian-test-settings-000123",
      "meridian-test-sessions-2147483648",
      "meridian-test-settings-999999999999999999999999",
    ]
    for (const name of preserved) mkdirSync(join(root, name))
    const foreignFile = join(root, "meridian-test-settings-111111")
    writeFileSync(foreignFile, "foreign file")
    const target = join(root, "foreign-target")
    mkdirSync(target)
    writeFileSync(join(target, "sentinel"), "keep")
    const link = join(root, "meridian-test-sessions-111111")
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir")
    expect(sweepStaleTestDirs(root, () => false)).toEqual([])
    for (const name of preserved) expect(existsSync(join(root, name))).toBe(true)
    expect(existsSync(foreignFile)).toBe(true)
    expect(existsSync(link)).toBe(true)
    expect(existsSync(join(target, "sentinel"))).toBe(true)
  }))

  it("keeps a live pair while removing a confirmed dead pair", withRoot(root => {
    const live = testDirsFor(root, process.pid)
    const dead = testDirsFor(root, 111111)
    for (const dir of [live.configDir, live.sessionDir, dead.configDir, dead.sessionDir]) mkdirSync(dir)
    expect(sweepStaleTestDirs(root, () => false).sort()).toEqual([dead.configDir, dead.sessionDir].sort())
    expect(existsSync(live.configDir)).toBe(true)
    expect(existsSync(live.sessionDir)).toBe(true)
  }))

  it("does not claim a failed deletion or prevent a later retry", withRoot(root => {
    const dirs = testDirsFor(root, 111111)
    mkdirSync(dirs.configDir)
    expect(sweepStaleTestDirs(root, () => false, () => false)).toEqual([])
    expect(existsSync(dirs.configDir)).toBe(true)
    expect(sweepStaleTestDirs(root, () => false)).toEqual([dirs.configDir])
    expect(existsSync(dirs.configDir)).toBe(false)
    const file = join(root, "file")
    writeFileSync(file, "not a directory")
    expect(removeTestDir(join(file, "child"))).toBe(false)
    expect(sweepStaleTestDirs(file)).toEqual([])
  }))
})
