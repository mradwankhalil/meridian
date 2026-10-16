/**
 * The ChatGPT half of `/health`, and how it combines with the Claude half.
 *
 * An instance is judged by the backends it serves. A ChatGPT-only instance has
 * no Claude login by design, so the Claude probe alone would call it degraded
 * forever while it serves every GPT turn; one serving both is degraded when
 * either half cannot serve, and down only when neither can.
 */
import type { ChatGptCredentialMode, SeatUnavailableReason } from "./source"

export type BackendStatus = "healthy" | "degraded" | "unhealthy"

export interface BackendVerdict {
  status: BackendStatus
  error?: string
}

/** The counts `/health` reports for the ChatGPT pool. No seat identity. */
export interface ChatGptSeatCounts {
  mode: ChatGptCredentialMode
  serving: boolean
  accounts: number
  eligible: number
  /** Eligible seats not benched by a rate limit: the ones that can take a turn now. */
  ready: number
  unavailable: Record<string, number>
  nextSeatFreeAt?: string
}

/** Reasons a seat recovers from on its own, without anybody signing in. */
const TEMPORARY: ReadonlySet<SeatUnavailableReason> = new Set(["cooling_down", "quota_exhausted", "expired"])

const REASON_PHRASE: Record<SeatUnavailableReason, string> = {
  unknown: "missing from the credential store",
  disabled: "disabled by the credential owner",
  cooling_down: "cooling down",
  quota_exhausted: "out of quota",
  no_token: "without an access token",
  expired: "waiting for a token refresh",
  requires_reauth: "needing sign-in",
  no_authority: "not refreshable by this Meridian",
  excluded: "excluded from work routing",
}

function describeUnavailable(unavailable: Record<string, number>): string {
  return Object.entries(unavailable)
    .map(([reason, count]) => `${count} ${REASON_PHRASE[reason as SeatUnavailableReason] ?? reason}`)
    .join(", ")
}

export function chatGptVerdict(counts: ChatGptSeatCounts): BackendVerdict {
  if (!counts.serving) {
    return {
      status: "unhealthy",
      error: counts.mode === "owned"
        ? "This Meridian does not hold refresh authority for its ChatGPT accounts."
        : "The oc-codex-multi-auth store could not be read.",
    }
  }
  if (counts.accounts === 0) {
    return { status: "unhealthy", error: "No ChatGPT account is connected. Connect one in /profiles." }
  }
  if (counts.ready > 0) return { status: "healthy" }

  const benched = counts.eligible
  const parts = [
    ...(benched > 0 ? [`${benched} rate-limited`] : []),
    ...(Object.keys(counts.unavailable).length > 0 ? [describeUnavailable(counts.unavailable)] : []),
  ].join(", ")
  const recovers = benched > 0
    || Object.keys(counts.unavailable).some(reason => TEMPORARY.has(reason as SeatUnavailableReason))
  if (recovers) {
    const next = counts.nextSeatFreeAt ? ` The next one frees at ${counts.nextSeatFreeAt}.` : ""
    return { status: "degraded", error: `No ChatGPT account can take a turn right now: ${parts}.${next}` }
  }
  return { status: "unhealthy", error: `No ChatGPT account can serve: ${parts}.` }
}

const BACKEND_NAME = { claude: "Claude", chatgpt: "ChatGPT" } as const

/**
 * One verdict for the instance. A single backend is reported as it is; with
 * two, the instance is healthy when both are, down when neither can serve,
 * and degraded in between, naming the backend each error belongs to.
 */
export function combineBackendVerdicts(verdicts: Partial<Record<keyof typeof BACKEND_NAME, BackendVerdict>>): BackendVerdict {
  const served = (Object.keys(BACKEND_NAME) as Array<keyof typeof BACKEND_NAME>)
    .flatMap(id => verdicts[id] ? [[id, verdicts[id]] as const] : [])
  if (served.length === 1) return served[0]![1]
  const statuses = served.map(([, verdict]) => verdict.status)
  const status: BackendStatus = statuses.every(s => s === "healthy")
    ? "healthy"
    : statuses.every(s => s === "unhealthy") ? "unhealthy" : "degraded"
  const errors = served
    .filter(([, verdict]) => verdict.status !== "healthy" && verdict.error)
    .map(([id, verdict]) => `${BACKEND_NAME[id]}: ${verdict.error}`)
  return { status, ...(errors.length > 0 ? { error: errors.join(" ") } : {}) }
}
