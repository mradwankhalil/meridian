/**
 * Argument parsing for `meridian chatgpt-migrate`. Lives under `src/` so the
 * typecheck and the tests cover it; `bin/cli.ts` only dispatches here.
 */

import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { loadNativeKeychainBackend } from "./keychain"
import { environmentFromProcess } from "./layout"
import { findMeridianInstance, type MeridianInstance } from "./instance"
import { createOwnedStoreAdapter } from "./ownedStore"
import { defaultConfigDir } from "../../../configDir"
import { REVERSE_STEPS, runReverseMigration, type ReverseStep } from "./reverse"
import {
  MIGRATION_STEPS,
  defaultOpencodeDatabasePath,
  runMigration,
  type MigrationOptions,
  type MigrationStep,
} from "./migrate"

export const MIGRATE_USAGE = `Move ChatGPT subscription accounts from oc-codex-multi-auth (and opencode's
own OpenAI login) into Meridian, step by step.

  meridian chatgpt-migrate [--dry-run] [--step <steps>] [options]

Steps, run in this order (default: all):
  processes   List running opencode processes that still hold refresh tokens
  import      Copy the freshest token of every account into Meridian's store
  strip       Remove refresh tokens from the plugin and opencode's auth.json
              (originals kept as <name>.meridian-backup, mode 0600)
  plugin      Remove oc-codex-multi-auth from every opencode config
  provider    Point an opencode provider at Meridian
  validate    Check every imported account through the running Meridian

Options:
  --dry-run               Report what would change; write nothing
  --step <a,b>            Run only these steps (repeatable)
  --force                 Run import/strip although opencode processes may hold
                          the tokens. Overrides nothing else.
  --strip-unowned         strip: also strip sources whose seat Meridian does not
                          hold, or holds an older token for (that token's only
                          working copy is then a .meridian-backup)
  --provider <id>         opencode provider to point at Meridian (default: openai)
  --meridian-url <url>    Meridian's address (default: http://127.0.0.1:$MERIDIAN_PORT or :3456)
  --base-url <url>        Exact provider baseURL (default: <meridian-url>/v1)
  --api-key-env <VAR>     Write apiKey as {env:VAR} instead of a placeholder
  --project <dir>         Also edit this project's opencode configs (repeatable)
  --no-opencode-db        Do not read opencode's database for project directories
  --store <path>          Meridian's ChatGPT store (default: $MERIDIAN_CHATGPT_STORE_PATH
                          when set, else the store of the Meridian running at
                          --meridian-url, else chatgpt-accounts.json in the
                          config directory)
  --config-dir <dir>      Meridian's config directory, for profile names and
                          Claude profile ids (default: $MERIDIAN_CONFIG_DIR when
                          set, else that of the Meridian running at
                          --meridian-url, else ~/.config/meridian). The command
                          prints both, and the flags to pass once it is stopped.
  --include-backup-only   Import accounts found only in plugin backups
  --skip-possible-duplicates
                          Leave out seats that look like an account Meridian
                          already holds (same email and workspace, another user
                          id) instead of importing them as
                          "<name> (possibly duplicate of <profile>)"
  --keychain              Read the OS keychain even without CODEX_KEYCHAIN=1
  --test-prompt           validate: also send one short prompt on the cheapest model
  --test-model <id>       Model for --test-prompt (default: the cheapest one served)
  -h, --help              This text

A seat Meridian already holds (same user id) is never imported twice: its one
record keeps the fresher token and its profile name.

Hand seats back to oc-codex-multi-auth (reverse):

  meridian chatgpt-migrate --reverse [--dry-run] [--step <steps>] [options]

Steps, run in this order (default: all):
  processes   List opencode processes that hold plugin tokens or need a restart
  handback    Write Meridian's seats into the plugin's store (merged, the old
              store kept as .meridian-backup; an original whose refresh token
              Meridian never renewed is restored whole), then remove them from
              Meridian's store so only the plugin renews them. Stop Meridian first.
  plugin      Put oc-codex-multi-auth back in the opencode configs that listed it,
              and in the global file whose plugin list opencode uses
  provider    Undo the provider step: the provider goes back to the plugin
  verify      Check no seat is renewed by both, and opencode loads the plugin

Reverse options:
  --seat <id>             Hand back only this profile id or seat id (repeatable)
  --include-interrupted   Also hand back seats whose last renewal was interrupted
                          (their refresh token may already be spent)
  --force                 Run handback although opencode processes may hold plugin
                          tokens. Overrides nothing else.
  --plugin-path <repo>    Load the plugin as file://<repo> (a checkout of
                          oc-codex-multi-auth) instead of the spec the preserved
                          config names (else oc-codex-multi-auth@latest)
  --plugin-store <path>   The plugin store to write (default: the global store,
                          ~/.opencode/oc-codex-multi-auth-accounts.json)
  --provider, --meridian-url, --base-url, --api-key-env, --project,
  --no-opencode-db, --store, --config-dir, --dry-run  as above

Both directions also edit oc-codex-multi-auth's entries in opencode's TUI
config (tui.json), which loads its quota status bar.

No token value is ever printed.`

export class MigrateUsageError extends Error {}

export interface ParsedMigrateArgs {
  help: boolean
  reverse: boolean
  steps: MigrationStep[]
  reverseSteps: ReverseStep[]
  seats: string[]
  pluginPath: string | null
  pluginStorePath: string | null
  skipPossibleDuplicates: boolean
  stripUnowned: boolean
  includeInterrupted: boolean
  dryRun: boolean
  force: boolean
  providerId: string
  baseURL: string
  meridianUrl: string
  storePath: string | null
  configDir: string | null
  testModel: string | null
  apiKey: string
  projectDirs: string[]
  useOpencodeDatabase: boolean
  includeBackupOnly: boolean
  keychain: boolean
  testPrompt: boolean
}


export function parseMigrateArgs(argv: readonly string[], env: NodeJS.ProcessEnv): ParsedMigrateArgs {
  const port = env.MERIDIAN_PORT ?? env.CLAUDE_PROXY_PORT ?? "3456"
  let meridianUrl = `http://127.0.0.1:${port}`
  let baseURL: string | undefined
  let apiKeyEnv: string | undefined
  const requested: string[] = []
  const reverseOnly: string[] = []
  const forwardOnly: string[] = []
  const parsed: ParsedMigrateArgs = {
    help: false, reverse: false, steps: [], reverseSteps: [], seats: [], pluginPath: null, pluginStorePath: null, skipPossibleDuplicates: false, stripUnowned: false, includeInterrupted: false, dryRun: false, force: false, providerId: "openai", baseURL: "", meridianUrl: "", storePath: null, configDir: null, testModel: null, apiKey: "meridian",
    projectDirs: [], useOpencodeDatabase: true, includeBackupOnly: false, keychain: false, testPrompt: false,
  }
  const value = (index: number, flag: string): string => {
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) throw new MigrateUsageError(`${flag} needs a value`)
    return next
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case "-h": case "--help": parsed.help = true; break
      case "--dry-run": parsed.dryRun = true; break
      case "--force": parsed.force = true; break
      case "--reverse": parsed.reverse = true; break
      case "--include-backup-only": parsed.includeBackupOnly = true; forwardOnly.push(arg); break
      case "--skip-possible-duplicates": parsed.skipPossibleDuplicates = true; forwardOnly.push(arg); break
      case "--test-prompt": parsed.testPrompt = true; forwardOnly.push(arg); break
      case "--strip-unowned": parsed.stripUnowned = true; forwardOnly.push(arg); break
      case "--include-interrupted": parsed.includeInterrupted = true; reverseOnly.push(arg); break
      case "--seat": parsed.seats.push(value(i, arg)); reverseOnly.push(arg); i++; break
      case "--plugin-path": parsed.pluginPath = resolve(value(i, arg)); reverseOnly.push(arg); i++; break
      case "--plugin-store": parsed.pluginStorePath = resolve(value(i, arg)); reverseOnly.push(arg); i++; break
      case "--keychain": parsed.keychain = true; break
      case "--no-opencode-db": parsed.useOpencodeDatabase = false; break
      case "--step":
        requested.push(...value(i, arg).split(",").map(part => part.trim()).filter(Boolean))
        i++
        break
      case "--provider": parsed.providerId = value(i, arg); i++; break
      case "--meridian-url": meridianUrl = value(i, arg).replace(/\/+$/, ""); i++; break
      case "--base-url": baseURL = value(i, arg); i++; break
      case "--store": parsed.storePath = resolve(value(i, arg)); i++; break
      case "--config-dir": parsed.configDir = resolve(value(i, arg)); i++; break
      case "--test-model": parsed.testModel = value(i, arg); i++; break
      case "--api-key-env":
        apiKeyEnv = value(i, arg)
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new MigrateUsageError(`--api-key-env needs a variable name, not "${apiKeyEnv}"`)
        i++
        break
      case "--project": parsed.projectDirs.push(resolve(value(i, arg))); i++; break
      default:
        // A mistyped flag must not silently fall back to "run every step".
        throw new MigrateUsageError(`unknown option "${arg}"`)
    }
  }
  const known: readonly string[] = parsed.reverse ? REVERSE_STEPS : MIGRATION_STEPS
  for (const step of requested) {
    if (!known.includes(step)) {
      throw new MigrateUsageError(`unknown ${parsed.reverse ? "reverse " : ""}step "${step}" (steps: ${known.join(", ")})`)
    }
  }
  const misplaced = parsed.reverse ? forwardOnly : reverseOnly
  if (misplaced.length > 0) throw new MigrateUsageError(`${misplaced[0]} ${parsed.reverse ? "does not apply to --reverse" : "needs --reverse"}`)
  if (parsed.reverse) parsed.reverseSteps = (requested.length > 0 ? requested : [...REVERSE_STEPS]) as ReverseStep[]
  else parsed.steps = (requested.length > 0 ? requested : [...MIGRATION_STEPS]) as MigrationStep[]
  parsed.meridianUrl = meridianUrl
  parsed.baseURL = baseURL ?? `${meridianUrl}/v1`
  if (!/^https?:\/\//.test(parsed.baseURL)) throw new MigrateUsageError(`the provider baseURL must be an http(s) URL, not "${parsed.baseURL}"`)
  if (apiKeyEnv) parsed.apiKey = `{env:${apiKeyEnv}}`
  return parsed
}

export interface InstancePaths {
  storePath: string
  /** Null leaves `MERIDIAN_CONFIG_DIR` as the shell has it. */
  configDir: string | null
  notes: string[]
}

/** What this shell says about Meridian's paths; the two variables are null when unset. */
export interface ShellPaths {
  configDir: string | null
  storePath: string | null
  defaultConfigDir: string
}

/**
 * Flags first, then a path this shell sets explicitly, then the running
 * instance at --meridian-url, then the defaults. An explicit variable outranks
 * the instance because setting one is a statement about which files are meant.
 */
export function resolveInstancePaths(
  args: Pick<ParsedMigrateArgs, "storePath" | "configDir" | "meridianUrl">,
  instance: MeridianInstance | null,
  shell: ShellPaths,
): InstancePaths {
  const chosenConfigDir = args.configDir ?? shell.configDir
  const configDir = chosenConfigDir ?? instance?.configDir ?? null
  // Meridian keeps its store in its config directory unless told otherwise, so another config directory brings its own store.
  const instanceStore = instance && (chosenConfigDir === null || chosenConfigDir === instance.configDir) ? instance.storePath : null
  const storePath = args.storePath ?? shell.storePath ?? instanceStore ?? join(configDir ?? shell.defaultConfigDir, "chatgpt-accounts.json")
  const notes: string[] = []
  if (instance) {
    notes.push(`Meridian at ${args.meridianUrl} is pid ${instance.pid}: store ${instance.storePath}, config directory ${instance.configDir}.`)
    if (storePath !== instance.storePath || (configDir ?? shell.defaultConfigDir) !== instance.configDir) {
      notes.push(`  ! using store ${storePath} and config directory ${configDir ?? shell.defaultConfigDir} (from flags or this shell's MERIDIAN_*); that instance will not see what is written there.`)
    }
    notes.push(`  Once it is stopped (handback needs that), pass: --store ${instance.storePath} --config-dir ${instance.configDir}`)
  } else {
    notes.push(`No Meridian server is running at ${args.meridianUrl}; using store ${storePath}${configDir ? ` and config directory ${configDir}` : " and this shell's config directory"}.`)
    if (!args.storePath || !args.configDir) {
      notes.push("  If the instance runs with its own HOME, MERIDIAN_CONFIG_DIR or MERIDIAN_CHATGPT_STORE_PATH, pass --store and --config-dir.")
    }
  }
  return { storePath, configDir, notes }
}

export async function runMigrateCli(argv: readonly string[]): Promise<number> {
  let args: ParsedMigrateArgs
  try {
    args = parseMigrateArgs(argv, process.env)
  } catch (error) {
    if (!(error instanceof MigrateUsageError)) throw error
    console.error(`chatgpt-migrate: ${error.message}\n\n${MIGRATE_USAGE}`)
    return 2
  }
  if (args.help) {
    console.log(MIGRATE_USAGE)
    return 0
  }
  const env = environmentFromProcess(process.env, homedir())
  const paths = resolveInstancePaths(args, findMeridianInstance(args.meridianUrl), {
    configDir: process.env.MERIDIAN_CONFIG_DIR || null,
    storePath: process.env.MERIDIAN_CHATGPT_STORE_PATH || null,
    defaultConfigDir: defaultConfigDir(),
  })
  // Settings and Claude profiles are read through MERIDIAN_CONFIG_DIR, resolved per call.
  if (paths.configDir) process.env.MERIDIAN_CONFIG_DIR = paths.configDir
  for (const note of paths.notes) console.log(note)
  console.log("")
  const store = createOwnedStoreAdapter({
    storePath: paths.storePath,
    meridianUrl: args.meridianUrl,
    apiKey: process.env.MERIDIAN_API_KEY || undefined,
    ...(args.testModel ? { testModels: [args.testModel] } : {}),
  })
  if (args.reverse) {
    return (await runReverseMigration({
      env,
      steps: args.reverseSteps,
      dryRun: args.dryRun,
      force: args.force,
      includeInterrupted: args.includeInterrupted,
      seats: args.seats,
      pluginStorePath: args.pluginStorePath,
      pluginPath: args.pluginPath,
      providerId: args.providerId,
      baseURL: args.baseURL,
      apiKey: args.apiKey,
      projectDirs: args.projectDirs,
      opencodeDatabasePath: args.useOpencodeDatabase ? defaultOpencodeDatabasePath(env) : null,
      store,
      log: line => console.log(line),
    })).exitCode
  }
  const keychain = args.keychain || env.codexKeychain ? await loadNativeKeychainBackend() : null
  if ((args.keychain || env.codexKeychain) && !keychain) {
    console.log("The OS keychain could not be opened (@napi-rs/keyring is not installed); keychain entries were not checked.\n")
  }
  const options: MigrationOptions = {
    env,
    steps: args.steps,
    dryRun: args.dryRun,
    force: args.force,
    providerId: args.providerId,
    baseURL: args.baseURL,
    apiKey: args.apiKey,
    projectDirs: args.projectDirs,
    opencodeDatabasePath: args.useOpencodeDatabase ? defaultOpencodeDatabasePath(env) : null,
    includeBackupOnly: args.includeBackupOnly,
    stripUnowned: args.stripUnowned,
    skipPossibleDuplicates: args.skipPossibleDuplicates,
    testPrompt: args.testPrompt,
    store,
    keychain,
    log: line => console.log(line),
  }
  return (await runMigration(options)).exitCode
}
