/**
 * The outbound ChatGPT request, built from nothing.
 *
 * Pure: no I/O, no config, no inbound request. That last one is the point
 * rather than a convenience. The reference implementation starts from the
 * CLIENT's headers and deletes what it does not want, which is safe only
 * while the delete list keeps pace with everything clients send. Building
 * from an empty Headers inverts that: a header reaches the provider because
 * it is named below, and for no other reason.
 *
 * The origin is a compile-time constant with no override. An operator-supplied
 * base URL would let a bearer token be aimed at an arbitrary host, and the
 * token in question belongs to a subscription rather than to the operator.
 */

const CODEX_ORIGIN = "https://chatgpt.com"
const CODEX_BASE_PATH = "/backend-api"

export const CODEX_RESPONSES_URL = `${CODEX_ORIGIN}${CODEX_BASE_PATH}/codex/responses`

/**
 * The image endpoints the Codex CLI calls with a ChatGPT sign-in: plain JSON
 * in, `{ data: [{ b64_json }] }` out, billed to the seat's plan.
 * https://github.com/openai/codex/blob/a4ebc509f4cdff88a8e58e175541970a30a2d385/codex-rs/codex-api/src/endpoint/images.rs
 */
export const CODEX_IMAGES_URLS = {
  image_generations: `${CODEX_ORIGIN}${CODEX_BASE_PATH}/codex/images/generations`,
  image_edits: `${CODEX_ORIGIN}${CODEX_BASE_PATH}/codex/images/edits`,
} as const

const ORIGINATOR = "codex_cli_rs"
const RESPONSES_BETA = "responses=experimental"
const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite"

/**
 * The tiers that accept the responses-lite hint at all. Necessary rather than
 * sufficient - see `bodySupportsResponsesLite`.
 */
const RESPONSES_LITE_MODELS: ReadonlySet<string> = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.6-cyber",
  "gpt-6-astra",
  "gpt-daybreak-blue",
  "gpt-daybreak-red",
])

/**
 * Whether the client's own body already meets the responses-lite mode's
 * preconditions.
 *
 * Measured against the provider on 2026-09-05: the header selects a mode, and
 * a body that does not already satisfy it is refused - first `400 ... requires
 * reasoning.context to be all_turns`, then `400 ... requires
 * parallel_tool_calls to be false`. Ordinary Codex traffic satisfies neither,
 * so gating on the model alone 400s every request on those tiers.
 *
 * The body is NOT adjusted to fit. This path is raw passthrough and the body
 * belongs to the client; all-turns reasoning and serialised tool calls are
 * behavioural changes, not formatting. Dropping the header costs an
 * optimisation, which is why both reads are strict - an absent
 * `parallel_tool_calls` is not a false one.
 */
function bodySupportsResponsesLite(body: Record<string, unknown>): boolean {
  if (body.parallel_tool_calls !== false) return false
  const reasoning = body.reasoning
  if (typeof reasoning !== "object" || reasoning === null) return false
  return "context" in reasoning && reasoning.context === "all_turns"
}

export interface CodexRequestAccount {
  /** The workspace, sent as the scope header. */
  accountId: string
  accessToken: string
}

export interface CodexRequestOptions {
  /**
   * Off by default and deliberately opt-in: sending it changes how upstream
   * scopes and bills the request, so it is never inferred from an id merely
   * being available.
   */
  sendOrganizationHeader?: boolean
  organizationId?: string | null
}

export interface CodexRequest {
  url: string
  headers: Headers
}

export function buildCodexRequest(
  body: Record<string, unknown> | null | undefined,
  account: CodexRequestAccount,
  options?: CodexRequestOptions,
): CodexRequest {
  const headers = new Headers()
  headers.set("authorization", `Bearer ${account.accessToken}`)
  headers.set("chatgpt-account-id", account.accountId)
  headers.set("openai-beta", RESPONSES_BETA)
  headers.set("originator", ORIGINATOR)
  headers.set("accept", "text/event-stream")
  headers.set("content-type", "application/json")

  const model = body?.model
  if (
    body
    && typeof model === "string"
    && RESPONSES_LITE_MODELS.has(model)
    && bodySupportsResponsesLite(body)
  ) {
    headers.set(RESPONSES_LITE_HEADER, "true")
  }

  // Both names carry the same key: it is what the provider reads for prompt
  // cache affinity, and a request with no key must go without one rather than
  // be given a fresh one, which would land it on a cold cache every turn.
  const cacheKey = body?.prompt_cache_key
  if (typeof cacheKey === "string" && cacheKey.length > 0) {
    try {
      headers.set("conversation_id", cacheKey)
      headers.set("session_id", cacheKey)
    } catch {
      headers.delete("conversation_id")
      headers.delete("session_id")
    }
  }

  if (options?.sendOrganizationHeader && options.organizationId) {
    headers.set("openai-organization", options.organizationId)
  }

  return { url: CODEX_RESPONSES_URL, headers }
}

/**
 * The outbound image request: the seat's credential and the Codex originator,
 * nothing from the client but the body. No Responses beta, no stream accept:
 * these endpoints answer one JSON document.
 */
export function buildCodexImagesRequest(operation: keyof typeof CODEX_IMAGES_URLS, account: CodexRequestAccount): CodexRequest {
  const headers = new Headers()
  headers.set("authorization", `Bearer ${account.accessToken}`)
  headers.set("chatgpt-account-id", account.accountId)
  headers.set("originator", ORIGINATOR)
  headers.set("content-type", "application/json")
  return { url: CODEX_IMAGES_URLS[operation], headers }
}
