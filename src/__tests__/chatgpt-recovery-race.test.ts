import { afterEach, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const roots: string[] = []
const children: ReturnType<typeof Bun.spawn>[] = []
const worker = join(import.meta.dir, "fixtures/chatgpt-lease-process.ts")

function spawn(mode: string, root: string, name: string) {
  const child = Bun.spawn([process.execPath, worker, mode, root, name], { stdout: "ignore", stderr: "inherit" })
  children.push(child)
  return child
}

async function waitFile(root: string, file: string): Promise<string> {
  const path = join(root, file)
  const deadline = Date.now() + 20_000
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Worker did not publish ${file}`)
    await Bun.sleep(10)
  }
  return readFileSync(path, "utf8")
}

async function deadOwner(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "chatgpt-recovery-"))
  roots.push(root)
  expect(await spawn("dead", root, "dead").exited).toBe(0)
  utimesSync(join(root, "writer.lock"), new Date(0), new Date(0))
  return root
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill("SIGKILL")
    await child.exited
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it("excludes a second reclaimer while the first pauses before canonical retirement", async () => {
  const root = await deadOwner()
  const first = spawn("pause-writer", root, "first")
  await waitFile(root, "first.paused")
  const second = spawn("attempt", root, "second")
  expect(await waitFile(root, "second.result")).toBe("denied")
  expect(await second.exited).toBe(0)
  writeFileSync(join(root, "first.resume"), "resume")
  expect(await waitFile(root, "first.result")).toBe("admitted")
  expect(first.exitCode).toBeNull()
}, 60_000)

it("cannot retire a live successor when two processes recover a crashed claimant", async () => {
  const root = await deadOwner()
  expect(await spawn("crash-claim", root, "crashed").exited).toBe(0)
  spawn("pause-claim", root, "first")
  await waitFile(root, "first.paused")
  const winner = spawn("attempt", root, "winner")
  expect(await waitFile(root, "winner.result")).toBe("admitted")
  writeFileSync(join(root, "first.resume"), "resume")
  expect(await waitFile(root, "first.result")).toBe("denied")
  expect(winner.exitCode).toBeNull()
  writeFileSync(join(root, "winner.validate"), "validate")
  expect(await waitFile(root, "winner.validated")).toBe("still-valid")
  spawn("attempt", root, "third")
  expect(await waitFile(root, "third.result")).toBe("denied")
}, 60_000)

it("recovers after killing a paused reclaimer and can reacquire after release", async () => {
  const root = await deadOwner()
  const first = spawn("pause-writer", root, "first")
  await waitFile(root, "first.paused")
  first.kill("SIGKILL")
  await first.exited
  const second = spawn("attempt", root, "second")
  expect(await waitFile(root, "second.result")).toBe("admitted")
  writeFileSync(join(root, "second.release"), "release")
  expect(await second.exited).toBe(0)
  spawn("attempt", root, "third")
  expect(await waitFile(root, "third.result")).toBe("admitted")
}, 60_000)

it.skipIf(process.platform !== "linux")("never steals from a SIGSTOPed admitted writer with an expired heartbeat", async () => {
  const root = await deadOwner()
  const writer = spawn("attempt", root, "writer")
  expect(await waitFile(root, "writer.result")).toBe("admitted")
  process.kill(writer.pid, "SIGSTOP")
  utimesSync(join(root, "writer.lock"), new Date(0), new Date(0))
  spawn("attempt", root, "contender")
  expect(await waitFile(root, "contender.result")).toBe("denied")
  process.kill(writer.pid, "SIGCONT")
  writeFileSync(join(root, "writer.validate"), "validate")
  expect(await waitFile(root, "writer.validated")).toBe("still-valid")
}, 60_000)
