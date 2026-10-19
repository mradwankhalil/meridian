// Offline runtime diagnostic only: /bin/sh prints a fixed public fixture.
// Run with Bun 1.3.11: bun auth-owned-process-probe.ts /path/to/meridian
import { exec, execFile } from "node:child_process"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"

const events: string[] = []
const child = execFile("/bin/sh", ["-c", "printf offline"], { encoding: "utf8", timeout: 2_000 }, () => {
  events.push("callback")
})
child.once("error", () => events.push("error"))
child.once("exit", () => events.push("exit"))
child.once("close", () => events.push("close"))
child.stdout?.once("close", () => events.push("stdout.close"))
child.stderr?.once("close", () => events.push("stderr.close"))
await new Promise(resolve => setTimeout(resolve, 200))
console.log(JSON.stringify({ runtime: process.versions.bun ?? process.version, rawEvents: events, exitCode: child.exitCode }))

const shellEvents: string[] = []
const shellChild = exec("printf offline", { encoding: "utf8", timeout: 2_000 }, () => shellEvents.push("callback"))
shellChild.once("error", () => shellEvents.push("error"))
shellChild.once("exit", () => shellEvents.push("exit"))
shellChild.once("close", () => shellEvents.push("close"))
shellChild.stdout?.once("close", () => shellEvents.push("stdout.close"))
shellChild.stderr?.once("close", () => shellEvents.push("stderr.close"))
await new Promise(resolve => setTimeout(resolve, 200))
console.log(JSON.stringify({ rawShellEvents: shellEvents, exitCode: shellChild.exitCode }))

if (process.argv[2]) {
  const moduleUrl = pathToFileURL(join(resolve(process.argv[2]), "src/proxy/authStatusProcess.ts")).href
  const { startOwnedClaudeProcess } = await import(moduleUrl)
  const started = Date.now()
  const owned = startOwnedClaudeProcess({ file: "/bin/sh", args: ["-c", "printf offline"] }, { timeoutMs: 2_000 })
  const result = await owned.result.then(() => "success", (error: { reason?: string }) => error.reason ?? "other-error")
  console.log(JSON.stringify({ ownedResult: result, joined: owned.isJoined(), elapsedMs: Date.now() - started }))
  const shellStarted = Date.now()
  const ownedShell = startOwnedClaudeProcess({ shell: "printf offline" }, { timeoutMs: 2_000 })
  const shellResult = await ownedShell.result.then(() => "success", (error: { reason?: string }) => error.reason ?? "other-error")
  console.log(JSON.stringify({ ownedShellResult: shellResult, joined: ownedShell.isJoined(), elapsedMs: Date.now() - shellStarted }))
}
