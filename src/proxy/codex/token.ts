/**
 * Codex access-token claim reading.
 *
 * A ChatGPT access token is a JWT whose payload already carries the account
 * identity, the plan tier and the expiry. Reading it locally is what lets a
 * card name its plan without a network call, and what lets Meridian tell an
 * expired token from a failing one.
 *
 * Decoding is signature-free on purpose. Meridian holds these tokens rather
 * than receiving them, has no verification key, and draws no security
 * conclusion from the contents — the claims label a read-only card and nothing
 * else. A malformed token yields null rather than an exception.
 *
 * This module NEVER refreshes a token. ChatGPT refresh tokens are single-use,
 * and exchanging one would invalidate the copy oc-codex holds, permanently
 * breaking the account. There is deliberately no code path here that contacts
 * the token endpoint.
 *
 * This is a leaf module: pure functions, no I/O beyond decoding a string.
 */

const AUTH_CLAIM_NAMESPACE = "https://api.openai.com/auth"

export interface CodexTokenClaims {
  /** `chatgpt_account_id` — NOT unique across accounts; pair it with userId. */
  accountId: string | null
  /** `chatgpt_account_user_id` — the genuinely unique identity key. */
  accountUserId: string | null
  /** `chatgpt_user_id` — distinguishes two accounts sharing an accountId. */
  userId: string | null
  /** `chatgpt_plan_type`, the authoritative plan slug. */
  planType: string | null
  /** `exp`, converted from seconds to epoch milliseconds. */
  expiresAt: number | null
  /** `iat`, converted from seconds to epoch milliseconds: when this token was issued. */
  issuedAt: number | null
}

export function decodeCodexToken(accessToken: string | null | undefined): CodexTokenClaims | null {
  if (typeof accessToken !== "string" || !accessToken) return null
  const parts = accessToken.split(".")
  if (parts.length !== 3) return null

  const payload = decodePayload(parts[1])
  if (!payload) return null

  const auth = asRecord(payload[AUTH_CLAIM_NAMESPACE])
  const expSeconds = finiteNumberOrNull(payload.exp)
  const iatSeconds = finiteNumberOrNull(payload.iat)

  return {
    accountId: stringOrNull(auth?.chatgpt_account_id),
    accountUserId: stringOrNull(auth?.chatgpt_account_user_id),
    userId: stringOrNull(auth?.chatgpt_user_id),
    planType: stringOrNull(auth?.chatgpt_plan_type),
    expiresAt: expSeconds === null ? null : expSeconds * 1000,
    issuedAt: iatSeconds === null ? null : iatSeconds * 1000,
  }
}

/**
 * An unknown expiry is not an expired one — say nothing rather than telling the
 * user an account is broken on the strength of a token we could not read.
 */
export function isCodexTokenExpired(expiresAt: number | null | undefined, nowMs: number): boolean {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return false
  return expiresAt <= nowMs
}

function decodePayload(segment: string | undefined): Record<string, unknown> | null {
  if (!segment) return null
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf-8"))
    return asRecord(parsed)
  } catch {
    return null
  }
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
