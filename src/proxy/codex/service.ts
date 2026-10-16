/**
 * Read-only ChatGPT (Codex) account usage, assembled for the dashboard.
 *
 * NOTE: agent-specific. This is the one place that knows the integration as a
 * whole exists: it gates on the operator's setting, reads the oc-codex pool,
 * and fans out to the usage endpoint once per account. Everything above it —
 * the HTTP route, the landing page — talks only to `getCodexUsage`.
 *
 * The stateful parts live here rather than in `usage.ts` so that module stays a
 * pure fetch-and-validate leaf. Three of them matter:
 *
 * - The dashboard polls every ten seconds. Six accounts times two endpoints
 *   would be seventy-two authenticated requests a minute against undocumented
 *   vendor endpoints, so a short cache is a correctness requirement, not an
 *   optimisation.
 * - A refused or rate-limited account is held off for a while, so a dead token
 *   is asked about once every few minutes instead of six times a minute.
 * - Outbound requests are bounded process-wide, so several open dashboards
 *   cannot multiply into an unbounded fan-out.
 *
 * Nothing here writes the pool and nothing renews a credential; see
 * `codex-no-write.test.ts`, which pins that structurally.
 */

import { createHash } from "node:crypto"
import { isCodexUsageEnabled, loadSettings, type MeridianSettings } from "../../settings"
import { codexAccountIdentity, readCodexPool, type CodexPoolAccount, type CodexPoolResult } from "./pool"
import { describeCodexPlan } from "./plan"
import { decodeCodexToken, type CodexTokenClaims } from "./token"
import { fetchCodexAccountUsage, fetchCodexWorkspaceNames, type CodexAccountUsage, type CodexUsageOutcome } from "./usage"
import type { CodexPlan, CodexUsageEntry, CodexUsageError, CodexUsageFailure, CodexUsageResponse } from "./types"

const SUCCESS_TTL_MS = 30_000
const STALE_MAX_MS = 15 * 60_000
const RATE_LIMIT_COOLDOWN_MS = 60_000
const REFUSED_CREDENTIAL_COOLDOWN_MS = 5 * 60_000
const MAX_CONCURRENT_FETCHES = 4
/**
 * A workspace is renamed far less often than its usage moves, and one answer
 * names every workspace its user belongs to, so a name is kept for hours and
 * shared by every seat of that workspace - one whose own token has expired
 * included. A failed read is tried again sooner.
 */
const WORKSPACE_NAME_TTL_MS = 12 * 60 * 60_000
const WORKSPACE_NAME_RETRY_MS = 10 * 60_000

interface CachedUsage {
  usage: CodexAccountUsage
  fetchedAt: number
}

const lastGood = new Map<string, CachedUsage>()
const inFlight = new Map<string, Promise<CodexUsageOutcome>>()
const heldOffUntil = new Map<string, { until: number; error: CodexUsageError }>()
const failureRuns = new Map<string, CodexUsageFailure>()
const workspaceNames = new Map<string, { name: string | null; until: number }>()
const workspaceLookups = new Map<string, Promise<void>>()

export function resetCodexUsageCache(): void {
  lastGood.clear()
  inFlight.clear()
  heldOffUntil.clear()
  failureRuns.clear()
  workspaceNames.clear()
  workspaceLookups.clear()
}

/**
 * Bound concurrent upstream work process-wide.
 *
 * A finishing task hands its slot straight to the next waiter rather than
 * decrementing and letting it re-enter; decrementing first would let a caller
 * arriving in between take the freed slot as well, so the limit could be
 * exceeded by exactly the number of waiters woken.
 */
function createGate(limit: number) {
  let active = 0
  const waiting: Array<() => void> = []

  const yieldSlot = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  return async function enter<T>(task: () => Promise<T>): Promise<T> {
    if (active < limit) active++
    else await new Promise<void>((resolve) => waiting.push(resolve))
    try {
      return await task()
    } finally {
      yieldSlot()
    }
  }
}

const gate = createGate(MAX_CONCURRENT_FETCHES)

export interface CodexUsageDeps {
  settings?: MeridianSettings
  loadPool?: () => CodexPoolResult
  fetchImpl?: typeof fetch
  now?: number
}

export async function getCodexUsage(deps: CodexUsageDeps = {}): Promise<CodexUsageResponse> {
  const now = deps.now ?? Date.now()

  // Off means off: no pool read, no request, no trace of another tool's
  // credentials having been looked at.
  if (!isCodexUsageEnabled(deps.settings ?? loadSettings())) {
    return { entries: [], error: "disabled", asOf: now }
  }

  const { pool, error } = (deps.loadPool ?? readCodexPool)()
  if (!pool) return { entries: [], error: error ?? "not_configured", asOf: now }
  if (pool.accounts.length === 0) return { entries: [], error: "not_configured", asOf: now }

  const entries = await Promise.all(
    pool.accounts.map((account) => resolveAccount(account, now, deps.fetchImpl)),
  )
  // Named once every lookup has settled: a seat whose own token cannot be used
  // is named through a sibling in its workspace, whose lookup may finish after
  // that seat's entry was built.
  return {
    entries: entries.map((entry, index) => ({ ...entry, workspaceName: workspaceNameOf(pool.accounts[index]!) })),
    error: null,
    asOf: now,
  }
}

function workspaceNameOf(account: CodexPoolAccount): string | null {
  return account.accountId ? workspaceNames.get(account.accountId)?.name ?? null : null
}

async function resolveAccount(
  account: CodexPoolAccount,
  now: number,
  fetchImpl: typeof fetch | undefined,
): Promise<CodexUsageEntry> {
  const claims = decodeCodexToken(account.accessToken)
  const key = cacheKey(account)
  const cached = lastGood.get(key)

  if (cached && now - cached.fetchedAt < SUCCESS_TTL_MS) {
    return toEntry(account, claims, cached.usage, false, null, null)
  }

  let outcome: CodexUsageOutcome
  try {
    outcome = await obtainUsage(account, key, now, fetchImpl)
  } catch {
    // Promise.all rejects on the first failure, so an unforeseen throw here
    // would take the whole card grid down with one account.
    outcome = { usage: null, error: "upstream_error" }
  }

  if (outcome.usage) {
    lastGood.set(key, { usage: outcome.usage, fetchedAt: outcome.usage.fetchedAt })
    // Only once a usage read has shown this token good for this account.
    await learnWorkspaceName(account, now, fetchImpl)
    return toEntry(account, claims, outcome.usage, false, null, null)
  }

  const failure = failureRuns.get(key) ?? null
  // Old numbers are worth showing through a blip, but never through a
  // credential the vendor has just refused or that does not match the account.
  if (outcome.error && isTransient(outcome.error) && cached && now - cached.fetchedAt < STALE_MAX_MS) {
    return toEntry(account, claims, cached.usage, true, outcome.error, failure)
  }
  return toEntry(account, claims, null, false, outcome.error, failure)
}

async function obtainUsage(
  account: CodexPoolAccount,
  key: string,
  now: number,
  fetchImpl: typeof fetch | undefined,
): Promise<CodexUsageOutcome> {
  const heldOff = heldOffUntil.get(key)
  if (heldOff) {
    if (now < heldOff.until) return { usage: null, error: heldOff.error }
    heldOffUntil.delete(key)
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const request = gate(() => fetchCodexAccountUsage(
    {
      accountId: account.accountId,
      accountUserId: account.accountUserId,
      accessToken: account.accessToken,
      email: account.email,
    },
    { fetchImpl, now },
  )).then((outcome) => {
    if (outcome.error) {
      const cooldown = cooldownFor(outcome.error)
      if (cooldown !== null) heldOffUntil.set(key, { until: now + cooldown, error: outcome.error })
      const run = failureRuns.get(key)
      failureRuns.set(key, { reason: outcome.error, consecutiveFailures: (run?.consecutiveFailures ?? 0) + 1, lastFailureAt: now })
    } else {
      failureRuns.delete(key)
    }
    return outcome
  }).finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, request)
  return request
}

/** Look the account's workspace name up when it is not known, or is due again; never throws. */
async function learnWorkspaceName(
  account: CodexPoolAccount,
  now: number,
  fetchImpl: typeof fetch | undefined,
): Promise<void> {
  const workspace = account.accountId
  if (!workspace) return
  const known = workspaceNames.get(workspace)
  if (known && now < known.until) return
  const pending = workspaceLookups.get(workspace)
  if (pending) return pending

  const keepUntilRetry = () => {
    workspaceNames.set(workspace, { name: known?.name ?? null, until: now + WORKSPACE_NAME_RETRY_MS })
  }
  const lookup = gate(() => fetchCodexWorkspaceNames(
    {
      accountId: account.accountId,
      accountUserId: account.accountUserId,
      accessToken: account.accessToken,
      email: account.email,
    },
    { fetchImpl, now },
  )).then((names) => {
    if (!names) { keepUntilRetry(); return }
    for (const [id, name] of names) workspaceNames.set(id, { name, until: now + WORKSPACE_NAME_TTL_MS })
    if (!names.has(workspace)) workspaceNames.set(workspace, { name: null, until: now + WORKSPACE_NAME_TTL_MS })
  }, keepUntilRetry).finally(() => {
    workspaceLookups.delete(workspace)
  })

  workspaceLookups.set(workspace, lookup)
  return lookup
}

function cooldownFor(error: CodexUsageError): number | null {
  if (error === "rate_limited") return RATE_LIMIT_COOLDOWN_MS
  if (error === "unauthorized" || error === "identity_mismatch") return REFUSED_CREDENTIAL_COOLDOWN_MS
  return null
}

function isTransient(error: CodexUsageError): boolean {
  return error === "rate_limited" || error === "upstream_error" || error === "invalid_response"
}

/**
 * Key on identity plus a fingerprint of the credential, never the credential.
 *
 * Including the token is what makes a rotated credential a cache miss rather
 * than a stale hit, and what lifts a refused account's cooldown the moment
 * oc-codex replaces its token.
 */
function cacheKey(account: CodexPoolAccount): string {
  const fingerprint = account.accessToken
    ? createHash("sha256").update(account.accessToken).digest("hex").slice(0, 16)
    : "none"
  return `${account.accountUserId ?? ""}|${account.accountId ?? ""}|${fingerprint}`
}

function toEntry(
  account: CodexPoolAccount,
  claims: CodexTokenClaims | null,
  usage: CodexAccountUsage | null,
  stale: boolean,
  error: CodexUsageError | null,
  failure: CodexUsageFailure | null,
): CodexUsageEntry {
  return {
    id: account.accountUserId ?? account.accountId ?? account.email ?? "unknown",
    type: "codex",
    identity: codexAccountIdentity(account),
    email: usage?.email ?? account.email,
    // The token names the tier without a network call, so a card whose usage
    // could not be fetched still says which plan it is.
    plan: toPlan(usage?.planType ?? claims?.planType ?? account.planType),
    workspaceName: workspaceNameOf(account),
    windows: usage?.windows ?? [],
    resetCredits: usage?.resetCredits ?? null,
    credits: usage?.credits ?? null,
    fetchedAt: usage?.fetchedAt ?? null,
    stale,
    error,
    failure,
  }
}

function toPlan(slug: string | null | undefined): CodexPlan | null {
  const described = describeCodexPlan(slug)
  if (described.slug === null) return null
  return { slug: described.slug, label: described.label, multiplier: described.multiplier }
}
