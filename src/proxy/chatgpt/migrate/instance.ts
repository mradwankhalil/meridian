/**
 * Which files the Meridian at `--meridian-url` actually uses.
 *
 * The migration runs in an operator's shell, whose HOME and MERIDIAN_* are
 * rarely the service's: an instance started by systemd with an isolated HOME
 * or its own `MERIDIAN_CHATGPT_STORE_PATH` keeps its ChatGPT store and its
 * settings somewhere the shell's defaults never point. Importing into the
 * shell's store gives the service nothing; naming seats in the shell's
 * settings names them for another instance.
 *
 * So the running server is found in `/proc` - a `bin/cli.ts` or `dist/cli.js`
 * of the `@rynfar/meridian` package, started without a subcommand, listening
 * on the URL's port - and its paths are derived from its environment the way
 * `configDir.ts` and `chatgpt/paths.ts` derive them. Only the four variables
 * that decide those paths are read from `environ`; nothing else is kept.
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { readLink, readText } from "./processes"

const PACKAGE_NAME = "@rynfar/meridian"
const DEFAULT_PORT = "3456"
const ENVIRONMENT_ALLOW_LIST = new Set(["HOME", "MERIDIAN_CONFIG_DIR", "MERIDIAN_CHATGPT_STORE_PATH", "MERIDIAN_PORT", "CLAUDE_PROXY_PORT", "MERIDIAN_HOST"])
const SCRIPT = /(^|\/)(bin\/cli\.ts|dist\/cli\.js|meridian)$/
const INTERPRETER_FLAGS = new Set(["run", "--bun", "--smol", "--watch", "--hot"])

export interface MeridianInstance {
  pid: number
  port: string
  configDir: string
  storePath: string
}

function packageNameAbove(start: string): string | null {
  let current = start
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(current, "package.json")
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, "utf8"))
        return typeof parsed === "object" && parsed !== null ? (Reflect.get(parsed, "name") as string | null) ?? null : null
      } catch {
        return null
      }
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** The Meridian entry script in `argv` and what follows it, or null when this is not Meridian. */
function meridianScript(argv: readonly string[], cwd: string | null): { rest: string[] } | null {
  const index = argv.findIndex((arg, position) => (position === 0 ? basename(arg) === "meridian" : SCRIPT.test(arg)))
  if (index < 0) return null
  const arg = argv[index]!
  let script = isAbsolute(arg) ? arg : cwd ? resolve(cwd, arg) : null
  if (!script) return null
  try {
    script = realpathSync(script)
  } catch {
    return null
  }
  if (packageNameAbove(dirname(script)) !== PACKAGE_NAME) return null
  return { rest: argv.slice(index + 1).filter(part => !INTERPRETER_FLAGS.has(part)) }
}

function environmentOf(raw: string | null): Map<string, string> {
  const values = new Map<string, string>()
  for (const pair of (raw ?? "").split("\0")) {
    const eq = pair.indexOf("=")
    if (eq <= 0) continue
    const key = pair.slice(0, eq)
    if (ENVIRONMENT_ALLOW_LIST.has(key)) values.set(key, pair.slice(eq + 1))
  }
  return values
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"])

/**
 * The running Meridian server that answers `url`, or null when none can be
 * found (not running, not on this host, or `/proc` unreadable). A server is
 * one started without a subcommand: `meridian chatgpt-migrate` itself is not.
 */
export function findMeridianInstance(url: string, options: { procRoot?: string; selfPid?: number } = {}): MeridianInstance | null {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  const port = target.port || (target.protocol === "https:" ? "443" : "80")
  const procRoot = options.procRoot ?? "/proc"
  const selfPid = options.selfPid ?? process.pid
  let pids: number[]
  try {
    pids = readdirSync(procRoot).filter(name => /^\d+$/.test(name)).map(Number).sort((a, b) => a - b)
  } catch {
    return null
  }
  for (const pid of pids) {
    if (pid === selfPid) continue
    const dir = join(procRoot, String(pid))
    const argv = (readText(join(dir, "cmdline")) ?? "").split("\0").filter(Boolean)
    const script = meridianScript(argv, readLink(join(dir, "cwd")))
    if (!script || script.rest.some(part => !part.startsWith("-"))) continue
    const env = environmentOf(readText(join(dir, "environ")))
    const listens = env.get("MERIDIAN_PORT") || env.get("CLAUDE_PROXY_PORT") || DEFAULT_PORT
    if (listens !== port) continue
    const host = env.get("MERIDIAN_HOST")
    if (!LOOPBACK.has(target.hostname) && host !== target.hostname) continue
    const home = env.get("HOME")
    const configDir = env.get("MERIDIAN_CONFIG_DIR") || (home ? join(home, ".config", "meridian") : null)
    if (!configDir) continue
    return { pid, port, configDir, storePath: env.get("MERIDIAN_CHATGPT_STORE_PATH") || join(configDir, "chatgpt-accounts.json") }
  }
  return null
}
