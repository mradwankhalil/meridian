/**
 * Argument parsing for `meridian instance-import`. Lives under `src/` so the
 * typecheck and the tests cover it; `bin/cli.ts` only dispatches here.
 */

import { join, resolve } from "node:path"
import { runInstanceImport, type InstancePaths } from "./importer"

export const INSTANCE_IMPORT_USAGE = `Move one Meridian instance's ChatGPT seats, with their history, into another.

  meridian instance-import --from <config dir> --to <config dir> [--apply]

Reads the source's ChatGPT store, settings (seat names, former names, the
active seat, ChatGPT features), price overrides and telemetry, and adds
them to the destination's. Without --apply it prints
what it would do and writes nothing.

Every seat keeps its profile name and former names, so its requests and
estimated value stay on its card. A name the destination already uses is a
conflict, and nothing is written; --rename files the seat under another.

With --apply, neither instance may be serving ChatGPT: stop the source, and
the destination unless it has no ChatGPT seats yet. Telemetry is copied
first and the seats last. Every copied request is read back and compared,
and only then is the source retired: each file it read is renamed to
<name>.imported-<time>. Nothing is deleted. A run that stops part-way leaves
the source in place, and running the command again continues it.

Options:
  --from <dir>             The source's config directory (its MERIDIAN_CONFIG_DIR,
                           else ~/.config/meridian of its HOME)
  --to <dir>               The destination's config directory
  --from-store <path>      The source's ChatGPT store, when its
                           MERIDIAN_CHATGPT_STORE_PATH names one
                           (default: <from>/chatgpt-accounts.json)
  --to-store <path>        The same, for the destination
  --from-telemetry <path>  The source's telemetry database, when its
                           MERIDIAN_TELEMETRY_DB names one (default: <from>/telemetry.db)
  --to-telemetry <path>    The same, for the destination
  --rename <old>=<new>     File the source's profile <old> under <new> (repeatable)
  --apply                  Import, verify, and retire the source
  -h, --help               Show this help

Exit status: 0 imported, or a dry run with nothing in the way; 1 refused or
not verified; 2 usage error.`

export class InstanceImportUsageError extends Error {}

export interface ParsedInstanceImportArgs {
  help: boolean
  apply: boolean
  from: InstancePaths
  to: InstancePaths
  renames: Map<string, string>
}

export function parseInstanceImportArgs(argv: readonly string[]): ParsedInstanceImportArgs {
  const given: Record<string, string> = {}
  const renames = new Map<string, string>()
  let help = false
  let apply = false
  const value = (index: number, flag: string): string => {
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) throw new InstanceImportUsageError(`${flag} needs a value`)
    return next
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case "-h": case "--help": help = true; break
      case "--apply": apply = true; break
      case "--from": case "--to": case "--from-store": case "--to-store": case "--from-telemetry": case "--to-telemetry":
        given[arg] = resolve(value(i, arg))
        i++
        break
      case "--rename": {
        const pair = value(i, arg)
        const at = pair.indexOf("=")
        if (at <= 0 || at === pair.length - 1) throw new InstanceImportUsageError(`--rename needs <old>=<new>, not "${pair}"`)
        renames.set(pair.slice(0, at), pair.slice(at + 1))
        i++
        break
      }
      default:
        throw new InstanceImportUsageError(`unknown option "${arg}"`)
    }
  }
  const paths = (side: "from" | "to"): InstancePaths => {
    const configDir = given[`--${side}`]
    // No default: the shell running this is rarely the service, and the
    // shell's own config directory is the wrong instance to read or fill.
    if (!configDir) throw new InstanceImportUsageError(`--${side} is required`)
    return {
      configDir,
      storePath: given[`--${side}-store`] ?? join(configDir, "chatgpt-accounts.json"),
      telemetryPath: given[`--${side}-telemetry`] ?? join(configDir, "telemetry.db"),
    }
  }
  if (help) {
    const none = { configDir: "", storePath: "", telemetryPath: "" }
    return { help, apply, from: none, to: none, renames }
  }
  return { help, apply, from: paths("from"), to: paths("to"), renames }
}

export async function runInstanceImportCli(argv: readonly string[]): Promise<number> {
  let args: ParsedInstanceImportArgs
  try {
    args = parseInstanceImportArgs(argv)
  } catch (error) {
    if (!(error instanceof InstanceImportUsageError)) throw error
    console.error(`instance-import: ${error.message}\n\n${INSTANCE_IMPORT_USAGE}`)
    return 2
  }
  if (args.help) {
    console.log(INSTANCE_IMPORT_USAGE)
    return 0
  }
  const result = await runInstanceImport({
    from: args.from,
    to: args.to,
    renames: args.renames,
    apply: args.apply,
    log: line => console.log(line),
  })
  return result.exitCode
}
