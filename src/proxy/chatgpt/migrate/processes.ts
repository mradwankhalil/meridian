/**
 * Which running opencode processes still own ChatGPT refresh tokens.
 *
 * oc-codex-multi-auth caches its accounts in memory (`AccountManager`) and
 * refreshes from that copy, writing the rotated token back to disk. Emptying
 * the file does not stop it, and nothing reloads it. A process that loaded the
 * plugin therefore keeps spending refresh tokens after the migration, and
 * because they are single-use, every exchange it makes kills the copy Meridian
 * imported - and the reverse. opencode's own OpenAI OAuth in `auth.json` has
 * the same property for any running opencode process.
 *
 * The scan is Linux `/proc` only. Elsewhere it reports that it could not look,
 * which the caller must treat as "unknown", never as "none running".
 *
 * Process environments are read for a fixed allow-list of variables that
 * change where opencode looks for config. Nothing else from `environ` is kept,
 * and `OPENCODE_CONFIG_CONTENT` is kept only to be parsed, never printed.
 */

import { readdirSync, readFileSync, readlinkSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import Database from "libsql"
import { isTruthyFlag, type MigrationEnvironment } from "./layout"
import { backupsOf } from "./files"
import {
  contextFor,
  loadsPlugin,
  pluginEntriesIn,
  resolvePlugins,
  UnparseableOpencodeConfigError,
  type PluginResolution,
} from "./opencodeConfig"

export type ProcessRole = "serve" | "web" | "run" | "acp" | "tui"

export interface SystemdUnit {
  name: string
  scope: "user" | "system"
}

export interface OpencodeProcess {
  pid: number
  exe: string | null
  /** argv[0] and the subcommand only: arguments can carry prompts or paths the operator did not ask to see. */
  command: string
  role: ProcessRole
  cwd: string | null
  startedAt: number | null
  unit: SystemdUnit | null
  /** False when `/proc/<pid>/environ` could not be read, so its config is the default one. */
  environmentKnown: boolean
  environment: MigrationEnvironment
  plugins: PluginResolution | null
  /** Effective config loads oc-codex-multi-auth now. */
  loadsPlugin: boolean
  /** A config file it reads changed after it started, and may have listed the plugin then (see changedFromPluginConfig). */
  configChangedSinceStart: boolean
  /** This process is an ancestor of the one running the migration. */
  isAncestor: boolean
}

export interface ProcessScan {
  supported: boolean
  processes: OpencodeProcess[]
}

export interface ProcessScanOptions {
  procRoot?: string
  selfPid?: number
  /** Environment used for processes whose `environ` is unreadable. */
  fallbackEnvironment: MigrationEnvironment
  /** Linux `CLK_TCK`; 100 on every mainstream kernel build. */
  clockTicks?: number
}

const ENVIRONMENT_ALLOW_LIST = new Set([
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_TUI_CONFIG",
  "OPENCODE_DISABLE_PROJECT_CONFIG",
  "CODEX_KEYCHAIN",
])

const OPENCODE_BINARY = /^opencode\d*(\..*)?$/
const INTERPRETERS = new Set(["bun", "node", "nodejs"])
const ROLES: ReadonlySet<string> = new Set(["serve", "web", "run", "acp"])

export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

export function readLink(path: string): string | null {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}

/** The kernel appends " (deleted)" when a running binary was replaced, as rebuilds do. */
function cleanExe(exe: string | null): string | null {
  return exe?.replace(/ \(deleted\)$/, "") ?? null
}

export function isOpencodeCommand(exe: string | null, argv: readonly string[]): boolean {
  if (exe && OPENCODE_BINARY.test(basename(exe))) return true
  const interpreter = basename(exe ?? argv[0] ?? "")
  if (!INTERPRETERS.has(interpreter) && !OPENCODE_BINARY.test(basename(argv[0] ?? ""))) return false
  return argv.some(arg =>
    OPENCODE_BINARY.test(basename(arg))
    || arg.includes("/packages/opencode/src/index.ts")
    || arg.includes("/node_modules/opencode-ai/"),
  )
}

export function roleOf(argv: readonly string[]): ProcessRole {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("-")) continue
    if (ROLES.has(arg)) return arg as ProcessRole
  }
  return "tui"
}

export function unitFromCgroup(text: string): SystemdUnit | null {
  const lines = text.split("\n").filter(Boolean)
  const line = lines.find(candidate => candidate.startsWith("0::")) ?? lines[0]
  if (!line) return null
  const path = line.slice(line.indexOf(":", line.indexOf(":") + 1) + 1)
  const segments = path.split("/").filter(Boolean)
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!
    if (!segment.endsWith(".service") || /^user@\d+\.service$/.test(segment)) continue
    return { name: segment, scope: segments.some(part => /^user@\d+\.service$/.test(part)) ? "user" : "system" }
  }
  return null
}

function environmentOf(raw: string | null, fallback: MigrationEnvironment): { known: boolean; environment: MigrationEnvironment } {
  if (raw === null) return { known: false, environment: fallback }
  const values = new Map<string, string>()
  for (const pair of raw.split("\0")) {
    const eq = pair.indexOf("=")
    if (eq <= 0) continue
    const key = pair.slice(0, eq)
    if (ENVIRONMENT_ALLOW_LIST.has(key)) values.set(key, pair.slice(eq + 1))
  }
  return {
    known: true,
    environment: {
      home: values.get("HOME") || fallback.home,
      xdgConfigHome: values.get("XDG_CONFIG_HOME") || undefined,
      xdgDataHome: values.get("XDG_DATA_HOME") || undefined,
      opencodeConfig: values.get("OPENCODE_CONFIG") || undefined,
      opencodeConfigDir: values.get("OPENCODE_CONFIG_DIR") || undefined,
      opencodeConfigContent: values.get("OPENCODE_CONFIG_CONTENT") || undefined,
      opencodeTuiConfig: values.get("OPENCODE_TUI_CONFIG") || undefined,
      disableProjectConfig: isTruthyFlag(values.get("OPENCODE_DISABLE_PROJECT_CONFIG")),
      codexKeychain: values.get("CODEX_KEYCHAIN") === "1",
      managedConfigDir: fallback.managedConfigDir,
    },
  }
}

function bootTimeMs(procRoot: string): number | null {
  const match = readText(join(procRoot, "stat"))?.match(/^btime (\d+)$/m)
  return match ? Number(match[1]) * 1000 : null
}

function startedAtOf(stat: string | null, bootMs: number | null, clockTicks: number): number | null {
  if (!stat || bootMs === null) return null
  // Fields after the parenthesised command name; starttime is field 22.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
  const ticks = Number(fields[19])
  return Number.isFinite(ticks) ? bootMs + (ticks / clockTicks) * 1000 : null
}

function parentOf(stat: string | null): number | null {
  if (!stat) return null
  const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1])
  return Number.isInteger(ppid) && ppid > 0 ? ppid : null
}

function ancestorsOf(procRoot: string, pid: number): Set<number> {
  const ancestors = new Set<number>()
  let current = parentOf(readText(join(procRoot, String(pid), "stat")))
  while (current && !ancestors.has(current)) {
    ancestors.add(current)
    current = parentOf(readText(join(procRoot, String(current), "stat")))
  }
  return ancestors
}

function listsPlugin(backup: string, configPath: string): boolean | null {
  const text = readText(backup)
  if (text === null) return null
  try {
    return pluginEntriesIn(text, configPath).length > 0
  } catch (error) {
    if (error instanceof UnparseableOpencodeConfigError) return null
    throw error
  }
}

/**
 * Whether a config file that changed after `startedAt` may have listed the
 * plugin when the process read it.
 *
 * Every edit the migration makes keeps the file's previous bytes as a
 * `.meridian-backup`, written at the moment of the edit. A backup listing the
 * plugin and written after the start means the plugin was removed after the
 * process loaded it. One written before the start means it was already gone,
 * so a later change - any tool rewriting the file - says nothing about the
 * plugin. Backups that never list it mean the migration found the file without
 * it. Only a file with no backup at all, or one that cannot be read, is
 * unknown, and unknown counts as loaded.
 */
export function changedFromPluginConfig(paths: readonly string[], startedAt: number): boolean {
  return paths.some(path => {
    let modified: number
    try {
      modified = statSync(path).mtimeMs
    } catch {
      return false
    }
    if (modified <= startedAt) return false
    const backups = backupsOf(path)
    if (backups.length === 0) return true
    for (const backup of backups) {
      const listed = listsPlugin(backup, path)
      if (listed === null) return true
      if (!listed) continue
      let takenAt: number
      try {
        takenAt = statSync(backup).mtimeMs
      } catch {
        return true
      }
      if (takenAt > startedAt) return true
    }
    return false
  })
}

export function scanOpencodeProcesses(options: ProcessScanOptions): ProcessScan {
  const procRoot = options.procRoot ?? "/proc"
  const selfPid = options.selfPid ?? process.pid
  let pids: number[]
  try {
    pids = readdirSync(procRoot).filter(name => /^\d+$/.test(name)).map(Number).sort((a, b) => a - b)
  } catch {
    return { supported: false, processes: [] }
  }
  const boot = bootTimeMs(procRoot)
  const clockTicks = options.clockTicks ?? 100
  const ancestors = ancestorsOf(procRoot, selfPid)
  const processes: OpencodeProcess[] = []

  for (const pid of pids) {
    if (pid === selfPid) continue
    const dir = join(procRoot, String(pid))
    const argv = (readText(join(dir, "cmdline")) ?? "").split("\0").filter(Boolean)
    const exe = cleanExe(readLink(join(dir, "exe")))
    if (!isOpencodeCommand(exe, argv)) continue

    const role = roleOf(argv)
    const cwd = readLink(join(dir, "cwd"))
    const stat = readText(join(dir, "stat"))
    const startedAt = startedAtOf(stat, boot, clockTicks)
    const { known, environment } = environmentOf(readText(join(dir, "environ")), options.fallbackEnvironment)
    const plugins = cwd ? resolvePlugins(environment, contextFor(cwd)) : resolvePlugins(environment, null)
    const configPaths = plugins.layers.filter(layer => layer.scope !== "content").map(layer => layer.path)

    processes.push({
      pid,
      exe,
      command: [basename(argv[0] ?? exe ?? "?"), ...(role === "tui" ? [] : [role])].join(" "),
      role,
      cwd,
      startedAt,
      unit: unitFromCgroup(readText(join(dir, "cgroup")) ?? ""),
      environmentKnown: known,
      environment,
      plugins,
      loadsPlugin: loadsPlugin(plugins),
      configChangedSinceStart: startedAt !== null && changedFromPluginConfig(configPaths, startedAt),
      isAncestor: ancestors.has(pid),
    })
  }
  return { supported: true, processes }
}

/**
 * Whether this process can still spend a token the migration moves.
 *
 * Plugin-held tokens: only processes that loaded the plugin, or whose config
 * changed since they started (so the scan cannot tell what they loaded).
 * opencode `auth.json`: every opencode process, because opencode's built-in
 * OpenAI provider refreshes it without any plugin.
 */
export function holdsRefreshAuthority(candidate: OpencodeProcess, includesOpencodeAuth: boolean): boolean {
  return includesOpencodeAuth || candidate.loadsPlugin || candidate.configChangedSinceStart
}

// ---------------------------------------------------------------------------
// Project directories opencode has been used in
// ---------------------------------------------------------------------------

function parseSandboxes(raw: unknown): string[] {
  if (typeof raw !== "string") return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []
  } catch {
    return []
  }
}

/**
 * Every directory opencode recorded a session or project in, so project-level
 * configs are found for projects that are not open right now. Read-only; a
 * missing or locked database yields nothing rather than failing the run.
 */
export function knownProjectDirectories(databasePath: string): { directories: string[]; error: string | null } {
  let db: Database.Database | undefined
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true })
    const directories = new Set<string>()
    for (const row of db.prepare("SELECT worktree, sandboxes FROM project").all() as Array<Record<string, unknown>>) {
      if (typeof row.worktree === "string" && row.worktree !== "/") directories.add(row.worktree)
      for (const sandbox of parseSandboxes(row.sandboxes)) directories.add(sandbox)
    }
    for (const row of db.prepare("SELECT DISTINCT directory FROM session").all() as Array<Record<string, unknown>>) {
      if (typeof row.directory === "string") directories.add(row.directory)
    }
    return { directories: [...directories].sort(), error: null }
  } catch (error) {
    return { directories: [], error: (error as Error).message }
  } finally {
    db?.close()
  }
}
