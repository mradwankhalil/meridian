/**
 * `meridian chatgpt-migrate`: moving ChatGPT subscription accounts from
 * oc-codex-multi-auth (and opencode's own OpenAI OAuth) into Meridian, one
 * step at a time.
 *
 *   processes  which running opencode processes still hold refresh tokens
 *   import     copy the freshest token of every seat into Meridian's store
 *   strip      remove refresh authority from the plugin and opencode
 *   plugin     remove oc-codex-multi-auth from every opencode config
 *   provider   point an opencode provider at Meridian
 *   validate   check each imported seat through the running Meridian
 *
 * Each step can run alone, and all of them honour `dryRun`, which reads
 * everything and writes nothing. `import` and `strip` refuse while a process
 * that could spend the same single-use tokens is alive, unless `force`; strip
 * also refuses a source whose seat Meridian does not hold the live token of,
 * unless `stripUnowned` - a separate override, so forcing past a process that
 * merely looks like a holder never destroys a token's only working copy.
 *
 * NOTHING HERE PRINTS A TOKEN. Reports carry emails, seat ids, the last six
 * characters of workspace ids, paths and counts. Token values stay inside the
 * objects handed to the store adapter.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { KeychainBackend } from "./keychain"
import { opencodeAuthPath, type MigrationEnvironment } from "./layout"
import {
  contextFor,
  describeLayer,
  highestPrecedenceGlobalFile,
  pointProviderAtMeridian,
  providerBaseUrlOverrides,
  removePluginEntries,
  resolvePlugins,
  resolveTuiPlugins,
  UnparseableOpencodeConfigError,
  type OpencodeContext,
  type PluginEntry,
} from "./opencodeConfig"
import {
  holdsRefreshAuthority,
  knownProjectDirectories,
  scanOpencodeProcesses,
  type OpencodeProcess,
  type ProcessScan,
} from "./processes"
import { compareFreshness, discoverCredentials, planAccounts, type AccountPlan, type Discovery } from "./sources"
import { executeStrip, heldAsCandidate, ownershipBlockers, planStrip, type MeridianHeldAccount } from "./strip"
import { preserveOriginal, replaceFileAtomically } from "./files"
import { planImportNaming, possibleDuplicateSentence } from "./duplicates"

export const MIGRATION_STEPS = ["processes", "import", "strip", "plugin", "provider", "validate"] as const
export type MigrationStep = (typeof MIGRATION_STEPS)[number]

/** One seat, as Meridian's store receives it. */
export interface ImportAccount {
  accountUserId: string
  accountId: string
  email: string | null
  refreshToken: string
  accessToken: string | null
  expiresAt: number | null
  tokenRotatedAt: number | null
}

export interface SeatValidation {
  ok: boolean
  /** A one-line, token-free description: plan, window usage, or the failure. */
  detail: string
}

/** Meridian's own ChatGPT store and gateway, as the migration needs them. */
export interface ChatGptStoreAdapter {
  storePath: string
  /** Throws when the store exists but cannot be read. */
  readHeld(): MeridianHeldAccount[]
  importAccounts(accounts: readonly ImportAccount[]): Promise<void>
  validateSeat?(accountUserId: string): Promise<SeatValidation>
  /** Send one short prompt on the cheapest model through the running Meridian. */
  testPrompt?(): Promise<SeatValidation>
  /** The `chatGptProfileNames` setting: seat -> operator-chosen profile id. */
  profileNames?(): Readonly<Record<string, unknown>>
  /** Profile ids a ChatGPT seat may not take (Claude profiles and their aliases). */
  reservedProfileIds?(): ReadonlySet<string>
  /** Add seat -> profile id entries to `chatGptProfileNames`, keeping the rest. */
  saveProfileNames?(names: ReadonlyMap<string, string>): void
  /**
   * Hand seats back to another refresher. Under the writer lease: reads the
   * seats, lets `write` put them where the new owner reads them, and only
   * then drops them from Meridian's store. `write` throwing leaves Meridian's
   * store untouched. Returns the seats removed.
   */
  handBack?(accountUserIds: readonly string[], write: (accounts: readonly MeridianHeldAccount[]) => void): Promise<MeridianHeldAccount[]>
}

export interface MigrationOptions {
  env: MigrationEnvironment
  steps: readonly MigrationStep[]
  dryRun: boolean
  /** Run import and strip although opencode processes may hold the tokens. Nothing else. */
  force: boolean
  /** Strip a source although Meridian does not hold its seat, or holds an older token: that token's only working copy goes. */
  stripUnowned?: boolean
  providerId: string
  baseURL: string
  apiKey: string
  /** Directories whose project-level opencode configs should be edited too. */
  projectDirs: readonly string[]
  /** opencode's database, for every project directory it has seen. Null skips it. */
  opencodeDatabasePath: string | null
  includeBackupOnly: boolean
  /** Leave out seats that look like another account Meridian holds, instead of importing them under a flagged name. */
  skipPossibleDuplicates?: boolean
  testPrompt: boolean
  store: ChatGptStoreAdapter | null
  keychain: KeychainBackend | null
  procRoot?: string
  now?: () => Date
  lockWaitMs?: number
  log: (line: string) => void
}

export interface MigrationResult {
  /** 0 when every requested step completed or had nothing to do. */
  exitCode: number
}

const ACCOUNT_ID_TAIL = 6

export function seatLabel(plan: Pick<AccountPlan, "email" | "accountUserId">): string {
  return plan.email ? `${plan.email} (${plan.accountUserId})` : plan.accountUserId
}

function workspaceTail(accountId: string | null): string {
  return accountId ? `…${accountId.slice(-ACCOUNT_ID_TAIL)}` : "unknown workspace"
}

// ---------------------------------------------------------------------------
// Reporting discovery
// ---------------------------------------------------------------------------

function reportDiscovery(discovery: Discovery, plans: readonly AccountPlan[], options: MigrationOptions): void {
  const { log } = options
  log(`Credential sources (${discovery.scanned.length} found${discovery.keychainChecked ? ", keychain checked" : ", keychain not checked"}):`)
  for (const scanned of discovery.scanned) {
    log(`  ${scanned.source.kind.padEnd(16)} ${scanned.source.location}  ${scanned.records} account(s), ${scanned.candidates} with a refresh token`)
  }
  for (const problem of discovery.problems) log(`  ! ${problem.kind} ${problem.location}: ${problem.detail}`)
  for (const record of discovery.unplaced) {
    log(`  ! ${record.location} account #${record.index + 1}${record.email ? ` (${record.email})` : ""}: ${record.reason}`)
  }
  log(`Seats (${plans.length}), freshest copy first:`)
  for (const plan of plans) {
    const older = plan.copies.filter(copy => copy.relation === "older-token").length
    const undated = plan.copies.filter(copy => copy.relation === "undated-token").length
    const same = plan.copies.filter(copy => copy.relation === "same-token").length
    const flags = [
      plan.disabled ? "disabled in the plugin" : null,
      plan.onlyInBackups ? (options.includeBackupOnly ? "only in backups (included)" : "only in backups (skipped; --include-backup-only)") : null,
      plan.winnerFromBackup ? "freshest copy is a backup" : null,
      plan.tieBrokenBySource ? "copies could not be ordered by time; source rank decided" : null,
      plan.accountId ? null : "no workspace id (cannot be imported)",
    ].filter(Boolean)
    log(`  ${seatLabel(plan)}  ${workspaceTail(plan.accountId)}`)
    log(`      use ${plan.winner.source.kind} ${plan.winner.source.location}; other copies: ${same} same token, ${older} older, ${undated} undated${flags.length ? `; ${flags.join("; ")}` : ""}`)
  }
}

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

export interface ProcessGate {
  blocking: OpencodeProcess[]
  supported: boolean
}

function processGate(scan: ProcessScan, options: MigrationOptions, discovery: Discovery): ProcessGate {
  const includesOpencodeAuth = discovery.candidates.some(candidate => candidate.source.kind === "opencode-auth")
  const blocking = scan.processes.filter(candidate =>
    candidate.environment.home === options.env.home && holdsRefreshAuthority(candidate, includesOpencodeAuth))
  return { blocking, supported: scan.supported }
}

function describeProcess(candidate: OpencodeProcess): string {
  const why = candidate.loadsPlugin ? "loads oc-codex-multi-auth"
    : candidate.configChangedSinceStart ? "config changed since it started, so it may have loaded the plugin"
    : "refreshes opencode's own OpenAI OAuth"
  const where = candidate.cwd ? ` in ${candidate.cwd}` : ""
  const ancestor = candidate.isAncestor ? " (runs this command)" : ""
  return `pid ${candidate.pid} ${candidate.command}${where}${ancestor}: ${why}`
}

export function reportProcesses(gate: ProcessGate, options: Pick<MigrationOptions, "log">): void {
  const { log } = options
  if (!gate.supported) {
    log("Running processes: cannot be checked on this platform (no /proc). Stop every opencode process yourself.")
    return
  }
  if (gate.blocking.length === 0) {
    log("Running processes: no opencode process holds these refresh tokens.")
    return
  }
  log(`Running processes that hold refresh tokens (${gate.blocking.length}):`)
  const units = gate.blocking.filter(candidate => candidate.unit)
  for (const candidate of gate.blocking) log(`  ${describeProcess(candidate)}`)
  if (units.length > 0) {
    log("  These are systemd services; stop them with:")
    for (const name of new Set(units.map(candidate => `${candidate.unit!.scope === "user" ? "systemctl --user" : "sudo systemctl"} stop ${candidate.unit!.name}`))) {
      log(`    ${name}`)
    }
  }
  if (gate.blocking.some(candidate => !candidate.unit)) {
    log("  Quit the other opencode sessions (their state is kept and they can be reopened after the migration).")
  }
  log("  Each keeps its refresh tokens in memory and keeps rotating them; Meridian and it would invalidate each other's single-use tokens.")
}

/**
 * The processes step's own result. Holders fail it, unless --force says the
 * operator accepts them: the steps that act on that are then run, and their
 * result is the one that counts.
 */
export function processStepResult(gate: ProcessGate, options: Pick<MigrationOptions, "force" | "log">): boolean {
  if (gate.supported && gate.blocking.length === 0) return true
  if (!options.force) return false
  options.log("  --force: continuing past them.")
  return true
}

export function gateAllows(gate: ProcessGate, options: Pick<MigrationOptions, "force" | "log">, step: string): boolean {
  if (gate.supported && gate.blocking.length === 0) return true
  if (options.force) {
    options.log(`  --force: running ${step} anyway.`)
    return true
  }
  options.log(`  Refusing the ${step} step. Stop them, or re-run with --force if you accept that they may invalidate the migrated tokens.`)
  return false
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function readHeld(options: MigrationOptions): MeridianHeldAccount[] | null {
  if (!options.store) return null
  try {
    return options.store.readHeld()
  } catch (error) {
    options.log(`  ! Meridian's store at ${options.store.storePath} could not be read: ${(error as Error).message}`)
    return null
  }
}

async function runImport(plans: readonly AccountPlan[], options: MigrationOptions): Promise<boolean> {
  const { log } = options
  if (!options.store) {
    log("  Meridian's ChatGPT store is not available in this build; nothing was imported.")
    return false
  }
  const held = readHeld(options)
  if (held === null) return false
  log(`  Meridian's store: ${options.store.storePath} (${held.length} seat(s) now)`)
  const heldBySeat = new Map(held.map(account => [account.accountUserId, account]))
  const importable = plans.filter(plan => plan.accountId && !(plan.onlyInBackups && !options.includeBackupOnly))
  const naming = planImportNaming({
    held: held.map(account => ({ accountUserId: account.accountUserId, accountId: account.accountId ?? null, email: account.email ?? null })),
    incoming: importable.map(plan => ({ accountUserId: plan.accountUserId, accountId: plan.accountId, email: plan.email })),
    names: options.store.profileNames?.(),
    reserved: options.store.reservedProfileIds?.(),
  })
  const accounts: ImportAccount[] = []
  const newNames = new Map<string, string>()
  for (const plan of plans) {
    const label = seatLabel(plan)
    if (plan.onlyInBackups && !options.includeBackupOnly) {
      log(`  skip ${label}: only in backups`)
      continue
    }
    if (!plan.accountId) {
      log(`  skip ${label}: no workspace id`)
      continue
    }
    const match = naming.matches.get(plan.accountUserId)
    const profileId = naming.ids.get(plan.accountUserId) ?? plan.accountUserId
    // One refresh token in two records would be renewed twice, and the second renewal fails.
    const sharer = held.find(account => account.accountUserId !== plan.accountUserId && account.refreshToken === plan.winner.refreshToken)
    if (sharer) {
      log(`  skip ${label}: Meridian holds this refresh token for another seat (${naming.ids.get(sharer.accountUserId) ?? sharer.accountUserId}); two profiles must not renew one token`)
      continue
    }
    const mine = heldBySeat.get(plan.accountUserId)
    if (mine?.refreshToken === plan.winner.refreshToken) {
      log(`  keep ${label}: already imported as ${profileId}`)
      continue
    }
    if (mine && compareFreshness(plan.winner, heldAsCandidate(mine, plan.winner)) >= 0) {
      log(`  keep ${label}: Meridian's copy (${profileId}) is newer`)
      continue
    }
    let as = `as ${profileId}`
    if (match?.kind === "possible") {
      if (options.skipPossibleDuplicates) {
        log(`  skip ${label}: possibly a duplicate of ${match.profileId} (same email and workspace, another user id; --skip-possible-duplicates)`)
        continue
      }
      const sentence = possibleDuplicateSentence(naming.derived.get(plan.accountUserId) ?? profileId, match.profileId)
      const flagged = naming.names.get(plan.accountUserId)
      if (flagged) newNames.set(plan.accountUserId, flagged)
      as = flagged ? `as ${profileId}: "${sentence}"` : `as ${profileId}, the name it was given ("${sentence}")`
    } else if (match?.kind === "same-seat") {
      as = `into ${profileId}, the profile Meridian already has for this seat`
    }
    log(`  ${options.dryRun ? "would import" : "import"} ${label} ${as} from ${plan.winner.source.location}${mine ? " (replacing an older copy)" : ""}`)
    accounts.push({
      accountUserId: plan.accountUserId,
      accountId: plan.accountId,
      email: plan.email,
      refreshToken: plan.winner.refreshToken,
      accessToken: plan.winner.accessToken,
      expiresAt: plan.winner.expiresAt,
      tokenRotatedAt: plan.winner.tokenRotatedAt,
    })
  }
  if (options.dryRun || accounts.length === 0) return true
  try {
    await options.store.importAccounts(accounts)
  } catch (error) {
    log(`  ! nothing more was imported: ${(error as Error).message}`)
    return false
  }
  log(`  Imported ${accounts.length} seat(s) into ${options.store.storePath}.`)
  if (newNames.size > 0) {
    if (options.store.saveProfileNames) {
      options.store.saveProfileNames(newNames)
      log(`  Named ${newNames.size} possible duplicate(s); rename any of them on /profiles once you have checked.`)
    } else {
      log("  ! this build cannot save profile names; the possible duplicates keep their derived names")
    }
  }
  log("  Meridian refreshes them from now on, once it runs with this store (MERIDIAN_CHATGPT_CREDENTIALS=owned or unset).")
  return true
}

// ---------------------------------------------------------------------------
// Strip
// ---------------------------------------------------------------------------

async function runStrip(discovery: Discovery, options: MigrationOptions): Promise<boolean> {
  const { log } = options
  const held = readHeld(options)
  const blockers = ownershipBlockers(discovery.candidates, held)
  const items = planStrip(discovery, options.env, options.stripUnowned ? new Map() : blockers)
  if (options.stripUnowned && blockers.size > 0) {
    for (const reason of new Set(blockers.values())) log(`  --strip-unowned overrides: ${reason}`)
  } else if (blockers.size > 0) {
    log("  Blocked sources are left alone; --strip-unowned strips them anyway (--force does not).")
  }
  if (items.length === 0) {
    log("  Nothing holds a refresh token.")
    return true
  }
  const verb = (type: string) => type === "backups" ? "move aside" : type === "opencode-auth" ? "remove the openai OAuth entry from" : "remove refresh tokens from"
  if (options.dryRun) {
    for (const item of items) {
      const state = item.blockers.length > 0 ? `  BLOCKED: ${item.blockers.join("; ")}` : ""
      log(`  would ${verb(item.target.type)} ${item.target.location} (${item.tokens} token(s), original kept as .meridian-backup)${state}`)
    }
    return items.every(item => item.blockers.length === 0)
  }
  const outcomes = await executeStrip(items, {
    now: options.now?.() ?? new Date(),
    keychain: options.keychain,
    refreshLock: options.lockWaitMs === undefined ? undefined : { waitMs: options.lockWaitMs },
    transactionLock: options.lockWaitMs === undefined ? undefined : { waitMs: options.lockWaitMs },
  })
  for (const outcome of outcomes) {
    const target = outcome.item.target.location
    if (outcome.status === "stripped") log(`  ${verb(outcome.item.target.type)} ${target}: ${outcome.removed} token(s); original at ${outcome.backup}`)
    else if (outcome.status === "unchanged") log(`  ${target}: already holds no refresh token`)
    else log(`  ! ${target} left untouched: ${outcome.detail}`)
  }
  return outcomes.every(outcome => outcome.status !== "skipped")
}

// ---------------------------------------------------------------------------
// opencode config
// ---------------------------------------------------------------------------

export function contexts(options: Pick<MigrationOptions, "projectDirs" | "opencodeDatabasePath" | "log">, processes: readonly OpencodeProcess[]): OpencodeContext[] {
  const directories = new Set<string>(options.projectDirs)
  for (const candidate of processes) if (candidate.cwd) directories.add(candidate.cwd)
  if (options.opencodeDatabasePath && existsSync(options.opencodeDatabasePath)) {
    const known = knownProjectDirectories(options.opencodeDatabasePath)
    if (known.error) options.log(`  ! opencode's project list could not be read: ${known.error}`)
    for (const directory of known.directories) directories.add(directory)
  }
  return [...directories].filter(directory => existsSync(directory)).sort().map(contextFor)
}

function runPlugin(options: MigrationOptions, processes: readonly OpencodeProcess[]): boolean {
  const { log } = options
  const entriesByFile = new Map<string, PluginEntry[]>()
  const autoloaded = new Set<string>()
  const unparseable = new Set<string>()
  const inline: string[] = []
  for (const context of [null, ...contexts(options, processes)]) {
    const resolution = resolvePlugins(options.env, context)
    const tui = resolveTuiPlugins(options.env, context)
    for (const path of [...resolution.unparseable, ...tui.unparseable]) unparseable.add(path)
    for (const file of resolution.autoloaded) autoloaded.add(file.path)
    for (const entry of [...resolution.entries, ...tui.entries]) {
      if (!entry.match) continue
      if (entry.layer.scope === "content") {
        inline.push(entry.spec)
        continue
      }
      const list = entriesByFile.get(entry.layer.path) ?? []
      if (!list.some(existing => existing.index === entry.index)) list.push(entry)
      entriesByFile.set(entry.layer.path, list)
    }
  }
  for (const candidate of processes) {
    if (!candidate.environment.opencodeConfigContent) continue
    const resolution = resolvePlugins(candidate.environment, null)
    if (resolution.entries.some(entry => entry.layer.scope === "content" && entry.match)) {
      log(`  ! pid ${candidate.pid} loads the plugin from OPENCODE_CONFIG_CONTENT; change how it is started`)
    }
  }
  if (inline.length > 0) log("  ! OPENCODE_CONFIG_CONTENT in this shell loads the plugin; unset it or remove the entry")

  let ok = inline.length === 0 && unparseable.size === 0
  if (entriesByFile.size === 0) log("  No opencode config lists oc-codex-multi-auth.")
  for (const [path, entries] of [...entriesByFile].sort(([a], [b]) => a.localeCompare(b))) {
    const layer = entries[0]!.layer
    const state = entries.some(entry => entry.effective) ? "active" : `inert, shadowed by ${entries[0]!.shadowedBy}`
    const specs = entries.map(entry => entry.spec).join(", ")
    if (options.dryRun) {
      log(`  would remove ${specs} from ${describeLayer(layer)} [${state}]`)
      continue
    }
    try {
      const raw = readFileSync(path, "utf8")
      const edit = removePluginEntries(raw, path)
      if (edit.removed.length === 0) {
        log(`  ${path}: already clean`)
        continue
      }
      const backup = preserveOriginal(path, raw, options.now?.() ?? new Date())
      replaceFileAtomically(path, edit.text)
      log(`  removed ${edit.removed.join(", ")} from ${describeLayer(layer)} [${state}]; original at ${backup.path}`)
    } catch (error) {
      ok = false
      const detail = error instanceof UnparseableOpencodeConfigError ? error.message : (error as Error).message
      log(`  ! ${path} left untouched: ${detail}`)
    }
  }
  for (const path of unparseable) log(`  ! ${path} could not be parsed; check it for the plugin by hand`)
  for (const path of autoloaded) {
    ok = false
    log(`  ! ${path} is loaded as a plugin file without being listed; move it out of the plugin directory yourself`)
  }
  if (!options.dryRun && entriesByFile.size > 0) log("  Restart opencode for the change to take effect.")
  return ok
}

function runProvider(options: MigrationOptions, processes: readonly OpencodeProcess[]): boolean {
  const { log } = options
  const path = highestPrecedenceGlobalFile(options.env)
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "{}\n"
  let ok = true
  try {
    const edit = pointProviderAtMeridian(raw, path, {
      providerId: options.providerId,
      baseURL: options.baseURL,
      apiKey: options.apiKey,
    })
    const from = edit.previousBaseURL ? ` (was ${printableUrl(edit.previousBaseURL)})` : ""
    if (!edit.changed) log(`  provider.${options.providerId} in ${path} already points at ${options.baseURL}`)
    else if (options.dryRun) log(`  would set provider.${options.providerId}.options.baseURL to ${options.baseURL}${from} in ${path}${edit.apiKeyAdded ? ", with a placeholder apiKey" : ""}`)
    else {
      const backup = existsSync(path) ? preserveOriginal(path, raw, options.now?.() ?? new Date()).path : null
      replaceFileAtomically(path, edit.text)
      log(`  set provider.${options.providerId}.options.baseURL to ${options.baseURL}${from} in ${path}${backup ? `; original at ${backup}` : ""}`)
    }
    if (edit.existingApiKeyKept) log(`  note: provider.${options.providerId} already has an apiKey; opencode will send it to Meridian`)
  } catch (error) {
    ok = false
    log(`  ! ${path} left untouched: ${(error as Error).message}`)
  }
  const overrides = new Set<string>()
  for (const context of [null, ...contexts(options, processes)]) {
    for (const override of providerBaseUrlOverrides(options.env, context, options.providerId)) overrides.add(override)
  }
  for (const override of overrides) log(`  ! ${override} sets its own provider.${options.providerId}.options.baseURL and wins over the global file there`)
  if (options.providerId === "openai" && hasOpenaiOauth(options.env)) {
    log("  ! auth.json still holds an openai OAuth login: opencode sends openai/ to chatgpt.com directly until the strip step removes it")
  }
  return ok
}

/** An operator's URL may carry a key in its userinfo or query; only origin and path are shown. */
export function printableUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return "(not a URL)"
  }
}

function hasOpenaiOauth(env: MigrationEnvironment): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(opencodeAuthPath(env), "utf8"))
    return typeof parsed === "object" && parsed !== null && Reflect.get(Reflect.get(parsed, "openai") ?? {}, "type") === "oauth"
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

async function runValidate(options: MigrationOptions): Promise<boolean> {
  const { log, store } = options
  if (!store?.validateSeat) {
    log("  Validation needs Meridian's ChatGPT gateway, which is not available in this build.")
    return false
  }
  const held = readHeld(options)
  if (held === null) return false
  if (held.length === 0) {
    log(`  Meridian's store at ${store.storePath} holds no seats. If the running Meridian uses another store, pass --store.`)
    return false
  }
  if (options.dryRun) {
    log(`  would check ${held.length} seat(s)${options.testPrompt ? " and send one test prompt" : ""}`)
    return true
  }
  let ok = true
  for (const account of held) {
    const result = await store.validateSeat(account.accountUserId)
    ok &&= result.ok
    log(`  ${result.ok ? "ok" : "FAILED"} ${account.accountUserId}: ${result.detail}`)
  }
  if (options.testPrompt) {
    if (!store.testPrompt) {
      log("  Test prompts are not available in this build.")
      return false
    }
    const result = await store.testPrompt()
    ok &&= result.ok
    log(`  test prompt ${result.ok ? "ok" : "FAILED"}: ${result.detail}`)
  }
  return ok
}

// ---------------------------------------------------------------------------

export async function runMigration(options: MigrationOptions): Promise<MigrationResult> {
  const { log } = options
  const steps = MIGRATION_STEPS.filter(step => options.steps.includes(step))
  if (options.dryRun) log("DRY RUN - nothing will be written.\n")

  const discovery = await discoverCredentials({ env: options.env, projectRoots: options.projectDirs, keychain: options.keychain })
  const plans = planAccounts(discovery.candidates)
  reportDiscovery(discovery, plans, options)

  const scan: ProcessScan = steps.some(step => step !== "validate")
    ? scanOpencodeProcesses({ procRoot: options.procRoot, fallbackEnvironment: options.env })
    : { supported: true, processes: [] }
  const gate = processGate(scan, options, discovery)

  // Every requested step runs even after an earlier one fails, so one report shows everything left to do.
  const runStep = async (step: MigrationStep): Promise<boolean> => {
    switch (step) {
      case "processes":
        reportProcesses(gate, options)
        return processStepResult(gate, options)
      case "import":
      case "strip":
        if (!steps.includes("processes")) reportProcesses(gate, options)
        if (options.dryRun) {
          if (!gate.supported || gate.blocking.length > 0) {
            log(`  A real run would refuse the ${step} step${options.force ? " (but --force is set)" : " without --force"}.`)
          }
        } else if (!gateAllows(gate, options, step)) {
          return false
        }
        return step === "import" ? runImport(plans, options) : runStrip(discovery, options)
      case "plugin":
        return runPlugin(options, scan.processes)
      case "provider":
        return runProvider(options, scan.processes)
      case "validate":
        return runValidate(options)
    }
  }

  let ok = true
  for (const step of steps) {
    log(`\n[${step}]`)
    ok = (await runStep(step)) && ok
  }
  return { exitCode: ok ? 0 : 1 }
}

export function defaultOpencodeDatabasePath(env: MigrationEnvironment): string {
  return join(env.xdgDataHome ?? join(env.home, ".local", "share"), "opencode", "opencode.db")
}
