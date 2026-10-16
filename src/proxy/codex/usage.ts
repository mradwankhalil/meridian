/**
 * Codex usage fetching, identity validation and normalization.
 *
 * NOTE: agent-specific. These are undocumented `chatgpt.com/backend-api/wham/*`
 * endpoints; every field is validated here so a vendor change degrades a card
 * rather than corrupting the dashboard.
 *
 * This module reads usage and nothing else. It NEVER refreshes a token:
 * ChatGPT refresh tokens are single-use, and spending one would invalidate the
 * copy oc-codex-multi-auth holds and permanently break the account. An expired
 * token is reported as expired and left alone for oc-codex to rotate.
 *
 * Identity validation is essential rather than defensive. Upstream answers a
 * request whose `ChatGPT-Account-ID` header disagrees with the bearer token
 * with HTTP 200 and the *token's* account, silently ignoring the header. A
 * caller that trusted the response would show one account's quota on another
 * account's card, so a mismatch discards the payload entirely.
 */

import { release } from "node:os"
import { decodeCodexToken, isCodexTokenExpired, type CodexTokenClaims } from "./token"
import { codexWindowLabel } from "./windows"
import type {
  CodexCredits,
  CodexRemoteError,
  CodexResetCredit,
  CodexResetCredits,
  CodexUsageError,
  CodexUsageWindow,
} from "./types"

/** Fixed by construction: an operator-supplied base URL would be a way to aim a bearer token at an arbitrary host. */
const CHATGPT_ORIGIN = "https://chatgpt.com"
const USAGE_URL = `${CHATGPT_ORIGIN}/backend-api/wham/usage`
const RESET_CREDITS_URL = `${CHATGPT_ORIGIN}/backend-api/wham/rate-limit-reset-credits`
const WORKSPACES_URL = `${CHATGPT_ORIGIN}/backend-api/wham/accounts/check`
const DEFAULT_TIMEOUT_MS = 10_000
const WORKSPACE_NAME_MAX_CHARS = 64

/**
 * The client identity oc-codex-multi-auth's `createCodexHeaders` sends to
 * these endpoints - originator, beta flag and Codex user agent - so Meridian
 * reads usage and reset credits exactly as `codex-reset status` does. The
 * version is the plugin's own default (`DEFAULT_CODEX_CLIENT_VERSION`).
 */
const CODEX_CLIENT_VERSION = "0.155.0"
const PLATFORM_LABELS: Record<string, string> = { win32: "Windows", darwin: "Mac OS", linux: "Linux" }

function codexUserAgent(): string {
  const os = PLATFORM_LABELS[process.platform] ?? process.platform
  return `codex_cli_rs/${CODEX_CLIENT_VERSION} (${os} ${release().replace(/[^\x20-\x7e]/g, "").trim()}; ${process.arch}) unknown`
}

export interface CodexCredentials {
  accountId: string | null
  accountUserId: string | null
  accessToken: string | null
  email: string | null
}

export interface CodexAccountUsage {
  windows: CodexUsageWindow[]
  planType: string | null
  email: string | null
  resetCredits: CodexResetCredits | null
  credits: CodexCredits | null
  fetchedAt: number
}

export interface CodexUsageOutcome {
  usage: CodexAccountUsage | null
  error: CodexUsageError | null
}

export interface FetchCodexUsageOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  timeoutMs?: number
  now?: number
}

export async function fetchCodexAccountUsage(
  credentials: CodexCredentials,
  options: FetchCodexUsageOptions = {},
): Promise<CodexUsageOutcome> {
  const now = options.now ?? Date.now()
  const doFetch = options.fetchImpl ?? fetch

  const usable = usableToken(credentials, now)
  if ("error" in usable) return { usage: null, error: usable.error }
  const { token, claims } = usable

  const usageResult = await getJson(doFetch, USAGE_URL, token, credentials.accountId, options.timeoutMs)
  if (usageResult.error) return { usage: null, error: usageResult.error }

  const body = asRecord(usageResult.body)
  if (!body) return { usage: null, error: "invalid_response" }

  // The response is only trustworthy once it names the account that was asked
  // for. `user_id` is the bare chatgpt_user_id, not the pool's composite
  // accountUserId, so it is compared against the token's own claim.
  if (disagrees(credentials.accountId, stringOrNull(body.account_id))) {
    return { usage: null, error: "identity_mismatch" }
  }
  if (disagrees(claims.userId, stringOrNull(body.user_id))) {
    return { usage: null, error: "identity_mismatch" }
  }

  const resetCredits = await collectResetCredits(
    doFetch,
    token,
    credentials.accountId,
    body.rate_limit_reset_credits,
    options.timeoutMs,
  )

  return {
    usage: {
      windows: normalizeWindows(body.rate_limit),
      planType: stringOrNull(body.plan_type),
      email: stringOrNull(body.email) ?? credentials.email,
      resetCredits,
      credits: normalizeCredits(body.credits),
      fetchedAt: now,
    },
    error: null,
  }
}

function normalizeCredits(value: unknown): CodexCredits | null {
  const raw = asRecord(value)
  if (!raw) return null
  const stated = typeof raw.balance === "string" ? raw.balance.trim() : typeof raw.balance === "number" ? String(raw.balance) : ""
  const balance = stated === "" ? Number.NaN : Number(stated)
  return {
    hasCredits: raw.has_credits === true,
    unlimited: raw.unlimited === true,
    overageLimitReached: raw.overage_limit_reached === true,
    balance: Number.isFinite(balance) ? balance : null,
  }
}

/**
 * Names of the ChatGPT Business workspaces the token's user belongs to, keyed
 * by workspace (account) id: the `GET /wham/accounts/check` that
 * oc-codex-multi-auth's `fetchCodexWorkspaceNames` reads for its own
 * "Business account" line. One answer covers every workspace the user is a
 * member of; a personal account carries no name and is left out. Null when the
 * token may not be sent or the read failed, which is not the same as "no
 * workspace".
 *
 * The name is chosen by the workspace owner, so control, bidi and zero-width
 * characters are dropped and the length is bounded before it reaches a page.
 */
export async function fetchCodexWorkspaceNames(
  credentials: CodexCredentials,
  options: FetchCodexUsageOptions = {},
): Promise<Map<string, string> | null> {
  const usable = usableToken(credentials, options.now ?? Date.now())
  if ("error" in usable) return null
  const result = await getJson(options.fetchImpl ?? fetch, WORKSPACES_URL, usable.token, credentials.accountId, options.timeoutMs)
  if (result.error) return null
  const accounts = asRecord(result.body)?.accounts
  if (!Array.isArray(accounts)) return null

  const names = new Map<string, string>()
  for (const entry of accounts) {
    const account = asRecord(entry)
    const id = stringOrNull(account?.id)
    const name = workspaceDisplayName(account?.name)
    if (!id || !name) continue
    if (account?.structure !== undefined && account.structure !== "workspace") continue
    names.set(id, name)
  }
  return names
}

function workspaceDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null
  const chars = [...cleaned]
  return chars.length > WORKSPACE_NAME_MAX_CHARS ? `${chars.slice(0, WORKSPACE_NAME_MAX_CHARS - 1).join("")}\u2026` : cleaned
}

type UsableToken = { token: string; claims: CodexTokenClaims } | { error: CodexUsageError }

/**
 * The access token, when it may be sent at all: present, decodable, not
 * expired, and filed under the account it claims. Checked before the
 * credential leaves the process - if the token belongs to a different account
 * than the pool record says, no request is made.
 */
function usableToken(credentials: CodexCredentials, now: number): UsableToken {
  const token = credentials.accessToken
  if (!token) return { error: "no_token" }
  const claims = decodeCodexToken(token)
  if (!claims) return { error: "invalid_token" }
  if (isCodexTokenExpired(claims.expiresAt, now)) return { error: "token_expired" }
  if (disagrees(credentials.accountUserId, claims.accountUserId)) return { error: "identity_mismatch" }
  if (disagrees(credentials.accountId, claims.accountId)) return { error: "identity_mismatch" }
  return { token, claims }
}

/** Two identifiers disagree only when both are present and differ. */
function disagrees(expected: string | null, actual: string | null): boolean {
  return expected !== null && actual !== null && expected !== actual
}

interface JsonResult {
  body: unknown
  error: CodexRemoteError | null
}

async function getJson(
  doFetch: typeof fetch,
  url: string,
  token: string,
  accountId: string | null,
  timeoutMs: number | undefined,
): Promise<JsonResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "OpenAI-Beta": "responses=experimental",
    originator: "codex_cli_rs",
    "User-Agent": codexUserAgent(),
  }
  // Without this header the endpoint answers with an empty account_id, which
  // would fail validation below.
  if (accountId) headers["ChatGPT-Account-ID"] = accountId

  let response: Response
  try {
    response = await doFetch(url, {
      method: "GET",
      headers,
      // A bearer credential must never be replayed to a redirect target.
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch {
    return { body: null, error: "upstream_error" }
  }

  if (!response.ok) return { body: null, error: classifyStatus(response.status) }

  try {
    return { body: await response.json(), error: null }
  } catch {
    // Upstream detail strings are deliberately not surfaced: they are attacker-
    // influenced text about a credential and have no diagnostic value here.
    return { body: null, error: "invalid_response" }
  }
}

function classifyStatus(status: number): CodexRemoteError {
  if (status === 401 || status === 403) return "unauthorized"
  if (status === 429) return "rate_limited"
  return "upstream_error"
}

function normalizeWindows(rateLimit: unknown): CodexUsageWindow[] {
  const raw = asRecord(rateLimit)
  if (!raw) return []
  const windows: CodexUsageWindow[] = []
  for (const key of ["primary_window", "secondary_window"]) {
    const window = normalizeWindow(raw[key])
    if (window) windows.push(window)
  }
  return windows
}

function normalizeWindow(value: unknown): CodexUsageWindow | null {
  const raw = asRecord(value)
  if (!raw) return null

  const usedPercent = finiteNumberOrNull(raw.used_percent)
  const resetSeconds = finiteNumberOrNull(raw.reset_at)
  if (usedPercent === null && resetSeconds === null) return null

  const limitWindowSeconds = finiteNumberOrNull(raw.limit_window_seconds)
  return {
    type: codexWindowLabel(limitWindowSeconds),
    // The vendor reports a consumed percentage; Meridian's window vocabulary is
    // a 0..1 consumed fraction.
    utilization: usedPercent === null ? null : usedPercent / 100,
    resetsAt: resetSeconds === null ? null : resetSeconds * 1000,
    limitWindowSeconds,
  }
}

/**
 * Combine the counts carried by the usage payload with the separate per-credit
 * list - the `GET /wham/rate-limit-reset-credits` that oc-codex-multi-auth's
 * `codex-reset status` reads. Only ever a GET: this module has no path to the
 * endpoint that redeems a credit.
 *
 * The list is best-effort: its failure leaves the counts standing and is
 * reported in place rather than failing the whole card. `credits: null`
 * therefore means "not known", which is distinct from a successful empty list.
 */
async function collectResetCredits(
  doFetch: typeof fetch,
  token: string,
  accountId: string | null,
  summary: unknown,
  timeoutMs: number | undefined,
): Promise<CodexResetCredits> {
  const raw = asRecord(summary)
  const detail = await getJson(doFetch, RESET_CREDITS_URL, token, accountId, timeoutMs)
  const credits = detail.error ? null : availableCredits(detail.body)

  return {
    availableCount: finiteNumberOrNull(raw?.available_count),
    applicableAvailableCount: finiteNumberOrNull(raw?.applicable_available_count),
    // The plugin's own rule (parseCodexResetCredits): the list's stated count
    // when it is a whole number, else the credits it lists as available.
    listedCount: credits === null ? null : countOrNull(asRecord(detail.body)?.available_count) ?? credits.length,
    credits,
    error: detail.error,
  }
}

/**
 * The credits still available to redeem, soonest expiry first. One whose
 * expiry cannot be read is kept, last, with a null expiry: it is still a
 * banked reset, and dropping it would understate what the seat holds.
 */
function availableCredits(value: unknown): CodexResetCredit[] {
  const raw = asRecord(value)
  if (!Array.isArray(raw?.credits)) return []

  const credits: CodexResetCredit[] = []
  for (const entry of raw.credits) {
    const credit = asRecord(entry)
    if (credit?.status !== "available") continue
    const expiresAtRaw = stringOrNull(credit.expires_at)
    const parsed = expiresAtRaw ? Date.parse(expiresAtRaw) : Number.NaN
    credits.push({ status: "available", expiresAt: Number.isFinite(parsed) ? parsed : null })
  }
  return credits.sort((a, b) => (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY))
}

function countOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
