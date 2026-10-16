/**
 * Wire and internal types for the read-only ChatGPT (Codex) usage integration.
 *
 * NOTE: agent-specific. This integration reads a file owned by the
 * oc-codex-multi-auth OpenCode plugin and calls undocumented
 * `chatgpt.com/backend-api/wham/*` endpoints. Both can change independently of
 * Meridian, so every field below is validated at the boundary and degrades to
 * null rather than propagating a surprise. Keep this coupling inside
 * `src/proxy/codex/` — do not spread it into adapters or the existing OAuth
 * usage path.
 *
 * The window vocabulary mirrors `OAuthUsageWindow` in `../oauthUsage`
 * structurally — `utilization` is a 0..1 consumed fraction, `resetsAt` is epoch
 * milliseconds — so the dashboard renders a Codex window with the helpers it
 * already has. It is a separate declaration rather than a shared import
 * because Codex must not depend on the Claude-specific usage module.
 */

/**
 * Why the pool yielded no accounts.
 *
 * `not_configured` is the quiet one: oc-codex-multi-auth is simply not
 * installed, which is not a fault and must not be reported as one. The other
 * two say the pool is there and wrong, which is worth telling the operator.
 */
export type CodexPoolError =
  /** No pool file. oc-codex-multi-auth is simply not installed here. */
  | "not_configured"
  /** The pool exists but its bytes could not be read or parsed. */
  | "pool_unreadable"
  /** The pool parsed but is not a schema this build understands. */
  | "invalid_pool"

/** Why the integration as a whole produced nothing. */
export type CodexIntegrationError =
  /** The operator turned the integration off. Nothing was read or fetched. */
  | "disabled"
  | CodexPoolError

/** Why a single upstream request failed. */
export type CodexRemoteError =
  | "unauthorized"
  | "rate_limited"
  | "upstream_error"
  | "invalid_response"

/** Why a single account's usage is missing. */
export type CodexUsageError =
  /** The pool record carries no access token. */
  | "no_token"
  /** The access token is present but not a decodable JWT. */
  | "invalid_token"
  /** The access token has expired; oc-codex will refresh it on next use. */
  | "token_expired"
  /**
   * The credentials do not belong to the account they are filed under. Upstream
   * answers a mismatched `ChatGPT-Account-ID` with HTTP 200 and the token's own
   * account, so this is a real, reachable state — never a theoretical one.
   */
  | "identity_mismatch"
  | CodexRemoteError

export interface CodexUsageWindow {
  /** Label derived from the window's width, e.g. "5h", "7d", "30d". */
  type: string
  /** Consumed fraction of the window, 0..1. Remaining is `1 - utilization`. */
  utilization: number | null
  /** Epoch milliseconds at which the window resets. */
  resetsAt: number | null
  /** Vendor-declared window width in seconds, or null when absent. */
  limitWindowSeconds: number | null
}

export interface CodexPlan {
  /** The vendor slug verbatim. */
  slug: string
  /** Human-facing label, e.g. "ChatGPT Pro". */
  label: string
  /**
   * Allowance multiplier where the slug implies one, e.g. "20x". The token
   * carries no multiplier field, so this is null wherever the tier's name does
   * not determine it — `pro` alone cannot distinguish 20x from legacy 5x.
   */
  multiplier: string | null
}

export interface CodexResetCredit {
  /** Vendor status; only "available" credits are listed. */
  status: string
  /** Epoch milliseconds, or null when unparseable. */
  expiresAt: number | null
}

/**
 * Redeemable rate-limit resets.
 *
 * The counts come from the usage payload and always stand. The per-credit
 * expiry list comes from a second, best-effort endpoint: `credits: null` means
 * that lookup failed or was not attempted, which is deliberately distinct from
 * a successful empty list.
 */
export interface CodexResetCredits {
  /** Total resets the account holds, as the usage payload states it. */
  availableCount: number | null
  /** How many are redeemable right now — normally 0 unless currently limited. */
  applicableAvailableCount: number | null
  /** Total resets as the credit list states it - what `codex-reset status` reports; null when the list read failed. */
  listedCount: number | null
  credits: CodexResetCredit[] | null
  error: CodexRemoteError | null
}

/**
 * Purchased Codex credits: what keeps a seat serving once its plan's windows
 * are spent - ChatGPT's counterpart of a Claude account's extra usage. The
 * vendor states the balance as a decimal string, in credits, not currency.
 */
export interface CodexCredits {
  hasCredits: boolean
  unlimited: boolean
  overageLimitReached: boolean
  /** Null when the payload stated no readable balance. */
  balance: number | null
}

/**
 * The run of failed usage checks since the last successful one, in the shape
 * of Claude's `OAuthUsageFailure`. Only checks that ran count - not polls a
 * cooldown turned away before they reached the token or upstream.
 */
export interface CodexUsageFailure {
  reason: CodexUsageError
  /** Always >= 1: a success clears the record rather than zeroing it. */
  consecutiveFailures: number
  lastFailureAt: number
}

export interface CodexUsageEntry {
  /** `accountUserId` — never `accountId`, which is not unique across accounts. */
  id: string
  type: "codex"
  /** Display identity, `<email>, id:<last 6>`, matching oc-codex's own surfaces. */
  identity: string
  email: string | null
  plan: CodexPlan | null
  /**
   * The ChatGPT Business workspace the account belongs to, by name - null for
   * a personal account, or while no seat of that workspace has been read.
   */
  workspaceName: string | null
  windows: CodexUsageWindow[]
  resetCredits: CodexResetCredits | null
  credits: CodexCredits | null
  /** Epoch milliseconds when the displayed usage was accepted, or null. */
  fetchedAt: number | null
  /** True when `windows` came from cache after a transient failure. */
  stale: boolean
  error: CodexUsageError | null
  /** The failing run in progress, or null when the last check succeeded. */
  failure: CodexUsageFailure | null
}

export interface CodexUsageResponse {
  entries: CodexUsageEntry[]
  /** Non-null when the integration produced no entries at all. */
  error: CodexIntegrationError | null
  asOf: number
}
