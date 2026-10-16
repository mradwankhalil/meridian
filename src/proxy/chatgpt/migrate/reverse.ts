/**
 * `meridian chatgpt-migrate --reverse`: handing ChatGPT seats back from
 * Meridian to oc-codex-multi-auth, one step at a time.
 *
 *   processes  which running opencode processes still hold plugin tokens, and
 *              which need a restart to load the plugin again
 *   handback   write the seats into the plugin's store, then drop them from
 *              Meridian's - so exactly one program renews each seat
 *   plugin     put oc-codex-multi-auth back in the opencode config that loads it
 *   provider   point the provider back at the plugin (undo the forward step)
 *   verify     check that no seat is renewed by both, and that opencode loads the plugin
 *
 * Every step honours `dryRun`. NOTHING HERE PRINTS A TOKEN.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { chatGptSeatLabel } from "../profiles"
import { planImportNaming } from "./duplicates"
import { backupsOf, preserveOriginal, replaceFileAtomically, withPluginLocks } from "./files"
import { mergeIntoPluginStore, PluginStoreFormatError, seatsWithRefreshTokens, type HandbackOutcome } from "./handback"
import { ACCOUNTS_FILE_NAME, PLUGIN_PACKAGE_NAME, pluginConfigDir, type MigrationEnvironment } from "./layout"
import { contexts, gateAllows, printableUrl, processStepResult, reportProcesses, type ChatGptStoreAdapter, type ProcessGate } from "./migrate"
import {
  addPluginEntry,
  configLayers,
  describeLayer,
  highestPrecedenceGlobalFile,
  parseConfigText,
  pluginEntriesIn,
  providerBaseUrlOverrides,
  providerBefore,
  resolvePlugins,
  resolveTuiPlugins,
  restoreProvider,
  tuiConfigLayers,
  UnparseableOpencodeConfigError,
  type ConfigLayer,
  type OpencodeContext,
  type ProviderBefore,
} from "./opencodeConfig"
import { holdsRefreshAuthority, scanOpencodeProcesses, type OpencodeProcess } from "./processes"
import { isRecord } from "./sources"
import { locksFor, type MeridianHeldAccount } from "./strip"

export const REVERSE_STEPS = ["processes", "handback", "plugin", "provider", "verify"] as const
export type ReverseStep = (typeof REVERSE_STEPS)[number]

/** What `--reverse` writes when no backup names the spec the operator had. */
export const DEFAULT_PLUGIN_SPEC = `${PLUGIN_PACKAGE_NAME}@latest`

export interface ReverseOptions {
  env: MigrationEnvironment
  steps: readonly ReverseStep[]
  dryRun: boolean
  /** Run handback although opencode processes may hold plugin tokens. Nothing else. */
  force: boolean
  /** Hand back seats whose last renewal was interrupted, so their refresh token may already be spent. */
  includeInterrupted?: boolean
  /** Profile ids or seat ids to hand back; empty means every seat Meridian holds. */
  seats: readonly string[]
  /** The plugin store to write; the global store when null. */
  pluginStorePath: string | null
  /** A checkout of the plugin to load as `file://<repo>` instead of the spec the backups name. */
  pluginPath: string | null
  providerId: string
  /** Meridian's provider baseURL: the value the provider step recognises as the forward migration's. */
  baseURL: string
  /** The placeholder apiKey the forward step writes; removed only when it is still that value. */
  apiKey: string
  projectDirs: readonly string[]
  opencodeDatabasePath: string | null
  store: ChatGptStoreAdapter | null
  procRoot?: string
  now?: () => Date
  lockWaitMs?: number
  log: (line: string) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function globalStorePath(options: ReverseOptions): string {
  return options.pluginStorePath ?? join(pluginConfigDir(options.env), ACCOUNTS_FILE_NAME)
}

function readIfExists(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Choosing seats
// ---------------------------------------------------------------------------

interface Selection {
  seats: MeridianHeldAccount[]
  profileIds: Map<string, string>
  unknown: string[]
}

function selectSeats(held: readonly MeridianHeldAccount[], options: ReverseOptions): Selection {
  const { ids } = planImportNaming({
    held: held.map(account => ({ accountUserId: account.accountUserId, accountId: account.accountId ?? null, email: account.email ?? null })),
    incoming: [],
    names: options.store?.profileNames?.(),
    reserved: options.store?.reservedProfileIds?.(),
  })
  if (options.seats.length === 0) return { seats: [...held], profileIds: ids, unknown: [] }
  const chosen = new Set<string>()
  const unknown: string[] = []
  for (const selector of options.seats) {
    const seat = held.find(account => account.accountUserId === selector || ids.get(account.accountUserId) === selector)
    if (seat) chosen.add(seat.accountUserId)
    else unknown.push(selector)
  }
  return { seats: held.filter(account => chosen.has(account.accountUserId)), profileIds: ids, unknown }
}

function describeSeat(seat: MeridianHeldAccount, ids: ReadonlyMap<string, string>): string {
  return `${ids.get(seat.accountUserId) ?? seat.accountUserId} (${chatGptSeatLabel(seat.accountUserId, seat.email ?? null)})`
}

function describeOutcome(outcome: HandbackOutcome): string {
  switch (outcome.action) {
    case "restored-from-backup": return `restore its original record from ${outcome.backup}`
    case "updated": return "lay Meridian's current token over the plugin's own record of it"
    case "added": return "add it as a new account"
  }
}

// ---------------------------------------------------------------------------
// handback
// ---------------------------------------------------------------------------

async function runHandback(options: ReverseOptions, gate: ProcessGate): Promise<boolean> {
  const { log, store } = options
  if (!store?.handBack) {
    log("  Meridian's ChatGPT store cannot hand seats back in this build.")
    return false
  }
  let held: MeridianHeldAccount[]
  try {
    held = store.readHeld()
  } catch (error) {
    log(`  ! Meridian's store at ${store.storePath} could not be read: ${errorMessage(error)}`)
    return false
  }
  const selection = selectSeats(held, options)
  for (const selector of selection.unknown) log(`  ! Meridian holds no seat called "${selector}"`)
  if (selection.unknown.length > 0) return false
  if (selection.seats.length === 0) {
    log(`  Meridian's store (${store.storePath}) holds no seats; nothing to hand back.`)
    return true
  }

  const interrupted = selection.seats.filter(seat => seat.exchangeStartedAt)
  let seats = selection.seats
  if (interrupted.length > 0) {
    for (const seat of interrupted) {
      log(`  ${options.includeInterrupted ? "--include-interrupted: handing back" : "skip"} ${describeSeat(seat, selection.profileIds)}: a renewal was interrupted, so its refresh token may already be spent${options.includeInterrupted ? "" : "; sign it in again with the plugin instead, or pass --include-interrupted"}`)
    }
    if (!options.includeInterrupted) seats = seats.filter(seat => !seat.exchangeStartedAt)
  }

  const storePath = globalStorePath(options)
  const now = (options.now?.() ?? new Date())
  const preview = (() => {
    try {
      return mergeIntoPluginStore({
        storePath,
        currentRaw: readIfExists(storePath),
        backups: backupsOf(storePath).flatMap(path => {
          const raw = readIfExists(path)
          return raw === null ? [] : [{ path, raw }]
        }),
        seats,
        now: now.getTime(),
      })
    } catch (error) {
      if (!(error instanceof PluginStoreFormatError)) throw error
      log(`  ! ${error.message}; left untouched`)
      return null
    }
  })()
  if (!preview) return false
  log(`  The plugin's store: ${storePath}${existsSync(storePath) ? " (merged, every other account kept)" : " (created)"}`)
  for (const outcome of preview.outcomes) {
    const seat = seats.find(candidate => candidate.accountUserId === outcome.accountUserId)!
    log(`  ${options.dryRun ? "would hand back" : "hand back"} ${describeSeat(seat, selection.profileIds)}: ${describeOutcome(outcome)}`)
  }
  if (seats.length === 0) return interrupted.length === 0

  if (options.dryRun) {
    if (!gate.supported || gate.blocking.length > 0) log(`  A real run would refuse the handback step${options.force ? " (but --force is set)" : " without --force"}.`)
    log(`  Meridian would stop renewing ${seats.length} seat(s): each is removed from its store once the plugin's store holds it.`)
    log("  A running Meridian holds its store's writer lease; stop it for this step, as for the import.")
    return true
  }
  if (!gateAllows(gate, options, "handback")) return false

  let written: HandbackOutcome[] = []
  let storeBackup: string | null = null
  let meridianBackup: string | null = null
  let removed: MeridianHeldAccount[]
  try {
    removed = await store.handBack(seats.map(seat => seat.accountUserId), accounts => {
      const meridianRaw = readIfExists(store.storePath)
      if (meridianRaw !== null) meridianBackup = preserveOriginal(store.storePath, meridianRaw, now).path
      const lockWait = options.lockWaitMs === undefined ? undefined : { waitMs: options.lockWaitMs }
      mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 })
      withPluginLocks(locksFor(storePath, { refreshLock: lockWait, transactionLock: lockWait }), () => {
        // Re-read under the plugin's locks: what the preview saw may have been rewritten since.
        const currentRaw = readIfExists(storePath)
        const merged = mergeIntoPluginStore({
          storePath,
          currentRaw,
          backups: backupsOf(storePath).flatMap(path => {
            const raw = readIfExists(path)
            return raw === null ? [] : [{ path, raw }]
          }),
          seats: accounts,
          now: now.getTime(),
        })
        if (currentRaw !== null) storeBackup = preserveOriginal(storePath, currentRaw, now).path
        replaceFileAtomically(storePath, merged.text)
        written = merged.outcomes
      })
    })
  } catch (error) {
    log(`  ! nothing was handed back: ${errorMessage(error)}`)
    return false
  }
  log(`  Wrote ${written.length} seat(s) into ${storePath}${storeBackup ? `; the store as it was is at ${storeBackup}` : ""}.`)
  log(`  Removed ${removed.length} seat(s) from Meridian's store${meridianBackup ? `; it was preserved at ${meridianBackup}` : ""}. Meridian no longer renews them.`)
  log("  The plugin restores opencode's own openai login (auth.json) from its store when it loads; the moved-aside backups/ directory holds spent tokens and stays aside.")
  return interrupted.length === 0 || options.includeInterrupted === true
}

// ---------------------------------------------------------------------------
// plugin
// ---------------------------------------------------------------------------

function fileLayers(
  options: ReverseOptions,
  processes: readonly OpencodeProcess[],
  layersFor: (env: MigrationEnvironment, context: OpencodeContext | null) => ConfigLayer[],
): ConfigLayer[] {
  const seen = new Map<string, ConfigLayer>()
  for (const context of [null, ...contexts(options, processes)]) {
    for (const layer of layersFor(options.env, context)) {
      if (layer.scope === "content" || layer.scope === "managed") continue
      if (!seen.has(layer.path)) seen.set(layer.path, layer)
    }
  }
  return [...seen.values()]
}

interface RememberedEntry { path: string; index: number; spec: string }

/** Every config file whose preserved original listed the plugin, with the oldest such entry. */
function rememberedEntries(layers: readonly ConfigLayer[]): RememberedEntry[] {
  const found: RememberedEntry[] = []
  for (const layer of layers) {
    for (const backup of backupsOf(layer.path)) {
      const raw = readIfExists(backup)
      if (raw === null) continue
      let entries: Array<{ index: number; spec: string }>
      try {
        entries = pluginEntriesIn(raw, layer.path)
      } catch (error) {
        if (error instanceof UnparseableOpencodeConfigError) continue
        throw error
      }
      if (entries[0]) {
        found.push({ path: layer.path, ...entries[0] })
        break
      }
    }
  }
  return found
}

export function pluginPathSpec(repo: string): { spec: string; problem: string | null; warning: string | null } {
  const directory = resolve(repo)
  const spec = pathToFileURL(directory).href
  const manifest = readIfExists(join(directory, "package.json"))
  if (manifest === null) return { spec, problem: `${directory} has no package.json; --plugin-path needs a checkout of ${PLUGIN_PACKAGE_NAME}`, warning: null }
  let name: unknown
  try {
    name = Reflect.get(JSON.parse(manifest) as object, "name")
  } catch {
    return { spec, problem: `${directory}/package.json is not valid JSON`, warning: null }
  }
  if (name !== PLUGIN_PACKAGE_NAME) return { spec, problem: `${directory} is ${JSON.stringify(name)}, not ${PLUGIN_PACKAGE_NAME}`, warning: null }
  const warning = existsSync(join(directory, "dist", "index.js")) ? null : `${directory} has no dist/index.js; run npm ci && npm run build there before restarting opencode`
  return { spec, problem: null, warning }
}

/** The global file whose `plugin` list opencode uses: the last that declares one, else the one a new key goes in. */
function effectiveGlobalPluginFile(env: MigrationEnvironment): string {
  const globals = configLayers(env, null).filter(layer => layer.scope === "global").reverse()
  for (const layer of globals) {
    const raw = readIfExists(layer.path)
    if (raw === null) continue
    try {
      if (Array.isArray(parseConfigText(raw, layer.path).plugin)) return layer.path
    } catch (error) {
      if (!(error instanceof UnparseableOpencodeConfigError)) throw error
    }
  }
  return highestPrecedenceGlobalFile(env)
}

function runPluginRestore(options: ReverseOptions, processes: readonly OpencodeProcess[]): boolean {
  const { log } = options
  const layers = fileLayers(options, processes, configLayers)
  const tuiLayers = fileLayers(options, processes, tuiConfigLayers)
  const remembered = rememberedEntries(layers)
  const rememberedTui = rememberedEntries(tuiLayers)
  let pathSpec: string | null = null
  if (options.pluginPath) {
    const fromPath = pluginPathSpec(options.pluginPath)
    if (fromPath.problem) {
      log(`  ! ${fromPath.problem}`)
      return false
    }
    if (fromPath.warning) log(`  ! ${fromPath.warning}`)
    pathSpec = fromPath.spec
    log(`  Plugin: ${pathSpec} (--plugin-path)`)
  }
  const first = remembered[0] ?? rememberedTui[0]
  const spec = pathSpec ?? first?.spec ?? DEFAULT_PLUGIN_SPEC
  if (!pathSpec) log(`  Plugin: ${spec} (${first ? `as ${first.path} listed it before the migration` : "no preserved config names one"})`)

  interface Target { index: number | undefined; spec: string; layer: ConfigLayer; active: boolean }
  const targets = new Map<string, Target>()
  const layerOf = (path: string, among: readonly ConfigLayer[]): ConfigLayer => among.find(layer => layer.path === path) ?? { path, scope: "global" }
  for (const entry of remembered) targets.set(entry.path, { index: entry.index, spec: pathSpec ?? entry.spec, layer: layerOf(entry.path, layers), active: false })
  const effective = effectiveGlobalPluginFile(options.env)
  if (targets.has(effective)) targets.get(effective)!.active = true
  else targets.set(effective, { index: undefined, spec, layer: layerOf(effective, layers), active: true })
  for (const entry of rememberedTui) targets.set(entry.path, { index: entry.index, spec: pathSpec ?? entry.spec, layer: layerOf(entry.path, tuiLayers), active: false })
  // The plugin's installer enables its TUI status bar in the global tui.json; a migration that never saw one still gets it back there.
  if (rememberedTui.length === 0 && resolveTuiPlugins(options.env, null).entries.length === 0) {
    const tuiJson = tuiConfigLayers(options.env, null)[0]!
    targets.set(tuiJson.path, { index: undefined, spec, layer: tuiJson, active: false })
  }

  let ok = true
  let changed = false
  for (const [path, target] of [...targets].sort(([a], [b]) => a.localeCompare(b))) {
    const where = `${describeLayer(target.layer)}${target.active ? " [active]" : ""}`
    const raw = readIfExists(path)
    const spec = target.spec
    try {
      const edit = addPluginEntry(raw ?? "{}\n", path, spec, { index: target.index, replace: pathSpec !== null })
      if (edit.outcome === "present") {
        log(`  ${where}: already lists the plugin`)
        continue
      }
      const what = edit.outcome === "replaced" ? `replace ${edit.previousSpec} with ${spec} in` : `add ${spec} to`
      if (options.dryRun) {
        log(`  would ${what} ${where}`)
        continue
      }
      const backup = raw === null ? null : preserveOriginal(path, raw, options.now?.() ?? new Date()).path
      if (raw === null) mkdirSync(dirname(path), { recursive: true })
      replaceFileAtomically(path, edit.text)
      changed = true
      log(`  ${what.replace(/^add/, "added").replace(/^replace/, "replaced")} ${where}${backup ? `; original at ${backup}` : ""}`)
    } catch (error) {
      ok = false
      log(`  ! ${path} left untouched: ${errorMessage(error)}`)
    }
  }
  if (changed) log("  Restart opencode for the plugin to load.")
  return ok
}

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------

/** The newest preserved original in which the provider did not point at Meridian: the state the forward step changed. */
function providerBeforeMigration(path: string, options: ReverseOptions): ProviderBefore | null {
  const meridian = options.baseURL.replace(/\/+$/, "")
  for (const backup of [...backupsOf(path)].reverse()) {
    const raw = readIfExists(backup)
    if (raw === null) continue
    try {
      const before = providerBefore(raw, path, options.providerId)
      if (before.baseURL?.replace(/\/+$/, "") !== meridian) return before
    } catch (error) {
      if (!(error instanceof UnparseableOpencodeConfigError)) throw error
    }
  }
  return null
}

function runProviderRestore(options: ReverseOptions, processes: readonly OpencodeProcess[]): boolean {
  const { log } = options
  const path = highestPrecedenceGlobalFile(options.env)
  const raw = readIfExists(path)
  if (raw === null) {
    log(`  ${path} does not exist; nothing to undo`)
    return true
  }
  let ok = true
  try {
    const before = providerBeforeMigration(path, options)
    const edit = restoreProvider(raw, path, {
      providerId: options.providerId,
      meridianBaseURL: options.baseURL,
      placeholderApiKey: options.apiKey,
      before,
    })
    const key = `provider.${options.providerId}`
    if (edit.outcome === "not-meridian") {
      log(`  ${key} in ${path} does not point at ${printableUrl(options.baseURL)}; left as it is`)
    } else {
      const apiKey = edit.apiKeyRemoved ? ` and the placeholder apiKey` : ""
      const what = edit.outcome === "restored"
        ? [`set ${key}.options.baseURL back to ${printableUrl(edit.restoredBaseURL!)}${apiKey}`, `set ${key}.options.baseURL back to ${printableUrl(edit.restoredBaseURL!)}${apiKey}`]
        : [`remove ${key}.options.baseURL${apiKey}`, `removed ${key}.options.baseURL${apiKey}`]
      const note = `${edit.outcome === "removed" ? `; ${key} goes to the plugin again` : ""}${before ? "" : " (no preserved original; the placeholder apiKey was recognised by value)"}`
      if (options.dryRun) log(`  would ${what[0]} in ${path}${note}`)
      else {
        const backup = preserveOriginal(path, raw, options.now?.() ?? new Date()).path
        replaceFileAtomically(path, edit.text)
        log(`  ${what[1]} in ${path}${note}; original at ${backup}`)
      }
    }
  } catch (error) {
    ok = false
    log(`  ! ${path} left untouched: ${errorMessage(error)}`)
  }
  const overrides = new Set<string>()
  for (const context of [null, ...contexts(options, processes)]) {
    for (const override of providerBaseUrlOverrides(options.env, context, options.providerId)) overrides.add(override)
  }
  for (const override of overrides) log(`  ! ${override} sets its own provider.${options.providerId}.options.baseURL and wins over the global file there`)
  return ok
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

function runVerify(options: ReverseOptions): boolean {
  const { log, store } = options
  const storePath = globalStorePath(options)
  let ok = true
  let pluginSeats = new Set<string>()
  const raw = readIfExists(storePath)
  if (raw !== null) {
    try {
      pluginSeats = seatsWithRefreshTokens(raw, storePath)
    } catch (error) {
      ok = false
      log(`  ! ${errorMessage(error)}`)
    }
  }
  let meridianSeats: string[] = []
  if (store) {
    try {
      meridianSeats = store.readHeld().map(account => account.accountUserId)
    } catch (error) {
      ok = false
      log(`  ! Meridian's store could not be read: ${errorMessage(error)}`)
    }
  }
  const both = meridianSeats.filter(seat => pluginSeats.has(seat))
  for (const seat of both) log(`  ! ${seat} is renewed by both Meridian and the plugin; hand it back or strip it, or one will spend the other's token`)
  ok &&= both.length === 0
  log(`  ${pluginSeats.size} seat(s) renewed by the plugin (${storePath}), ${meridianSeats.length} by Meridian, ${both.length} by both`)

  const loaded = resolvePlugins(options.env, null).entries.some(entry => entry.match && entry.effective)
  log(loaded ? "  opencode's global config loads the plugin" : "  ! opencode's global config does not load the plugin (run the plugin step)")
  ok &&= loaded
  const tuiLoaded = resolveTuiPlugins(options.env, null).entries.length > 0
  log(tuiLoaded ? "  opencode's global TUI config loads the plugin's status bar" : "  ! opencode's global TUI config does not load the plugin's status bar (run the plugin step)")
  ok &&= tuiLoaded
  const path = highestPrecedenceGlobalFile(options.env)
  const current = readIfExists(path)
  if (current !== null) {
    try {
      const config = parseConfigText(current, path)
      const provider = isRecord(config.provider) ? config.provider[options.providerId] : undefined
      const baseURL = isRecord(provider) && isRecord(provider.options) ? provider.options.baseURL : undefined
      const toMeridian = typeof baseURL === "string" && baseURL.replace(/\/+$/, "") === options.baseURL.replace(/\/+$/, "")
      log(toMeridian ? `  ! provider.${options.providerId} still points at Meridian (run the provider step)` : `  provider.${options.providerId} does not point at Meridian`)
      ok &&= !toMeridian
    } catch (error) {
      ok = false
      log(`  ! ${errorMessage(error)}`)
    }
  }
  return ok
}

// ---------------------------------------------------------------------------

export async function runReverseMigration(options: ReverseOptions): Promise<{ exitCode: number }> {
  const { log } = options
  const steps = REVERSE_STEPS.filter(step => options.steps.includes(step))
  if (options.dryRun) log("DRY RUN - nothing will be written.\n")
  log("Handing ChatGPT seats back from Meridian to oc-codex-multi-auth.")

  const scan = steps.some(step => step !== "verify")
    ? scanOpencodeProcesses({ procRoot: options.procRoot, fallbackEnvironment: options.env })
    : { supported: true, processes: [] }
  const sameHome = scan.processes.filter(candidate => candidate.environment.home === options.env.home)
  const gate: ProcessGate = {
    supported: scan.supported,
    blocking: sameHome.filter(candidate => holdsRefreshAuthority(candidate, false)),
  }

  const runStep = async (step: ReverseStep): Promise<boolean> => {
    switch (step) {
      case "processes": {
        reportProcesses(gate, options)
        const restart = sameHome.filter(candidate => !gate.blocking.includes(candidate))
        if (restart.length > 0) {
          log(`  ${restart.length} other opencode process(es) keep the config they started with; restart them after the plugin and provider steps:`)
          for (const candidate of restart) log(`    pid ${candidate.pid} ${candidate.command}${candidate.cwd ? ` in ${candidate.cwd}` : ""}`)
        }
        return processStepResult(gate, options)
      }
      case "handback":
        if (!steps.includes("processes")) reportProcesses(gate, options)
        return runHandback(options, gate)
      case "plugin":
        return runPluginRestore(options, scan.processes)
      case "provider":
        return runProviderRestore(options, scan.processes)
      case "verify":
        return runVerify(options)
    }
  }

  let ok = true
  for (const step of steps) {
    log(`\n[${step}]`)
    ok = (await runStep(step)) && ok
  }
  return { exitCode: ok ? 0 : 1 }
}
