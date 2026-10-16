/**
 * Unit tests for Codex access-token claim decoding.
 *
 * Every token in this file is synthetic. Real access tokens are never checked
 * in, printed, or logged — the module exists precisely so that the parts of a
 * token Meridian needs (account identity, plan tier, expiry) can be read
 * without the token itself travelling any further.
 *
 * Decoding is deliberately signature-free. Meridian has no verification key and
 * does not need one: it is reading a credential it already holds in order to
 * label a card, not accepting one from a caller.
 */
import { describe, test, expect } from "bun:test"
import { decodeCodexToken, isCodexTokenExpired } from "../proxy/codex/token"

const AUTH_NAMESPACE = "https://api.openai.com/auth"

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.not-a-real-signature`
}

describe("decodeCodexToken", () => {
  test("reads identity, plan and expiry from the vendor namespace", () => {
    const token = makeToken({
      exp: 1789494103,
      iat: 1788630103,
      [AUTH_NAMESPACE]: {
        chatgpt_account_id: "aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
        chatgpt_account_user_id: "user-ABC__aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
        chatgpt_user_id: "user-ABC",
        chatgpt_plan_type: "pro",
      },
    })

    expect(decodeCodexToken(token)).toEqual({
      accountId: "aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
      accountUserId: "user-ABC__aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
      userId: "user-ABC",
      planType: "pro",
      expiresAt: 1789494103000,
      issuedAt: 1788630103000,
    })
  })

  test("converts exp from seconds to milliseconds", () => {
    const decoded = decodeCodexToken(makeToken({ exp: 1788905341 }))
    expect(decoded?.expiresAt).toBe(1788905341000)
  })

  test("returns nulls rather than throwing when the namespace is absent", () => {
    const decoded = decodeCodexToken(makeToken({ exp: 1788905341 }))
    expect(decoded).toEqual({
      accountId: null,
      accountUserId: null,
      userId: null,
      planType: null,
      expiresAt: 1788905341000,
      issuedAt: null,
    })
  })

  test("decodes base64url payloads that need padding restored", () => {
    // Payload lengths that are not a multiple of four are the common case; a
    // decoder that forgets to re-pad fails on most real tokens.
    const decoded = decodeCodexToken(makeToken({ [AUTH_NAMESPACE]: { chatgpt_plan_type: "free" } }))
    expect(decoded?.planType).toBe("free")
  })

  test("returns null for anything that is not a three-part token", () => {
    expect(decodeCodexToken(null)).toBeNull()
    expect(decodeCodexToken(undefined)).toBeNull()
    expect(decodeCodexToken("")).toBeNull()
    expect(decodeCodexToken("only-one-part")).toBeNull()
    expect(decodeCodexToken("two.parts")).toBeNull()
    expect(decodeCodexToken("a.b.c.d")).toBeNull()
  })

  test("returns null when the payload is not decodable JSON", () => {
    expect(decodeCodexToken("header.@@@not-base64@@@.sig")).toBeNull()
    expect(decodeCodexToken(`header.${Buffer.from("not json").toString("base64url")}.sig`)).toBeNull()
  })

  test("ignores claim values of the wrong type instead of propagating them", () => {
    const decoded = decodeCodexToken(makeToken({
      exp: "not-a-number",
      [AUTH_NAMESPACE]: { chatgpt_plan_type: 42, chatgpt_account_id: null },
    }))
    expect(decoded?.planType).toBeNull()
    expect(decoded?.accountId).toBeNull()
    expect(decoded?.expiresAt).toBeNull()
  })
})

describe("isCodexTokenExpired", () => {
  const now = 1788635942122

  test("reports an expired token", () => {
    expect(isCodexTokenExpired(now - 1, now)).toBe(true)
  })

  test("reports a live token", () => {
    expect(isCodexTokenExpired(now + 60_000, now)).toBe(false)
  })

  test("does not claim expiry when the expiry is unknown", () => {
    // An undecodable token is a reason to say nothing, not a reason to tell the
    // user their account is broken.
    expect(isCodexTokenExpired(null, now)).toBe(false)
  })
})
