/**
 * Unit tests for the Codex usage fetch, identity validation and normalization.
 *
 * The identity check is the load-bearing part of this module, not a
 * defensive nicety. Upstream answers a request whose `ChatGPT-Account-ID`
 * header does not match the bearer token with **HTTP 200 and the token's own
 * account** — it silently ignores the mismatch rather than refusing. Without
 * validation, one account's card would quietly display another account's quota.
 *
 * The two identifiers compared are deliberately different shapes: the pool's
 * `accountUserId` is a composite (`user-ABC__<accountId>`) while the usage
 * response's `user_id` is the bare `chatgpt_user_id` (`user-ABC`). Comparing
 * those two directly would reject every legitimate account.
 */
import { describe, test, expect } from "bun:test"
import { fetchCodexAccountUsage, fetchCodexWorkspaceNames } from "../proxy/codex/usage"

const ACCOUNT_ID = "aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3"
const USER_ID = "user-ABC"
const ACCOUNT_USER_ID = `${USER_ID}__${ACCOUNT_ID}`
const AUTH_NAMESPACE = "https://api.openai.com/auth"

function makeToken(overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
  const body = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 3600,
    [AUTH_NAMESPACE]: {
      chatgpt_account_id: ACCOUNT_ID,
      chatgpt_account_user_id: ACCOUNT_USER_ID,
      chatgpt_user_id: USER_ID,
      chatgpt_plan_type: "pro",
      ...overrides,
    },
  })).toString("base64url")
  return `${header}.${body}.sig`
}

function credentials(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    accountUserId: ACCOUNT_USER_ID,
    accessToken: makeToken(),
    email: "someone@example.com",
    ...overrides,
  }
}

/** A usage payload shaped like the real one, with a weekly primary window. */
function usagePayload(overrides: Record<string, unknown> = {}) {
  return {
    user_id: USER_ID,
    account_id: ACCOUNT_ID,
    email: "someone@example.com",
    plan_type: "pro",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 5,
        limit_window_seconds: 604800,
        reset_after_seconds: 599173,
        reset_at: 1789235170,
      },
      secondary_window: null,
    },
    additional_rate_limits: null,
    credits: { has_credits: false, unlimited: false, overage_limit_reached: false, balance: "0" },
    rate_limit_reset_credits: { available_count: 1, applicable_available_count: 0 },
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

/** Records every request so header and host invariants can be asserted. */
function recordingFetch(handler: (url: string) => Response) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString()
    calls.push({ url, init })
    return handler(url)
  }
  return { impl: impl as unknown as typeof fetch, calls }
}

function usageOnly(payload: unknown, status = 200) {
  return recordingFetch((url) =>
    url.includes("/wham/usage")
      ? jsonResponse(payload, status)
      : jsonResponse({ credits: [], available_count: 0 }))
}

describe("fetchCodexAccountUsage — normalization", () => {
  test("converts used_percent to a 0..1 utilization and reset_at to milliseconds", async () => {
    const { impl } = usageOnly(usagePayload())
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(result.error).toBeNull()
    expect(result.usage?.windows).toEqual([
      { type: "7d", utilization: 0.05, resetsAt: 1789235170000, limitWindowSeconds: 604800 },
    ])
  })

  test("labels a 5h primary and weekly secondary without relying on position", async () => {
    const { impl } = usageOnly(usagePayload({
      rate_limit: {
        primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_at: 1788653996 },
        secondary_window: { used_percent: 100, limit_window_seconds: 604800, reset_at: 1788755316 },
      },
    }))
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(result.usage?.windows.map((w) => w.type)).toEqual(["5h", "7d"])
    expect(result.usage?.windows.map((w) => w.utilization)).toEqual([0, 1])
  })

  test("labels the free tier's 30-day window as 30d", async () => {
    const { impl } = usageOnly(usagePayload({
      rate_limit: {
        primary_window: { used_percent: 100, limit_window_seconds: 2592000, reset_at: 1790763728 },
        secondary_window: null,
      },
    }))
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })
    expect(result.usage?.windows[0]?.type).toBe("30d")
  })

  test("tolerates a missing rate_limit block", async () => {
    const { impl } = usageOnly(usagePayload({ rate_limit: null }))
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })
    expect(result.error).toBeNull()
    expect(result.usage?.windows).toEqual([])
  })

  test("reads the plan slug from the response", async () => {
    const { impl } = usageOnly(usagePayload({ plan_type: "self_serve_business_prolite" }))
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })
    expect(result.usage?.planType).toBe("self_serve_business_prolite")
  })
})

describe("fetchCodexAccountUsage — request shape", () => {
  test("sends the bearer token and account scope, and refuses redirects", async () => {
    const { impl, calls } = usageOnly(usagePayload())
    await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    const usageCall = calls.find((c) => c.url.includes("/wham/usage"))
    const headers = usageCall?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${credentials().accessToken}`)
    expect(headers["ChatGPT-Account-ID"]).toBe(ACCOUNT_ID)
    // A bearer credential must never follow a redirect to an unexpected host.
    expect(usageCall?.init?.redirect).toBe("error")
  })

  test("only ever contacts the fixed chatgpt.com host", async () => {
    const { impl, calls } = usageOnly(usagePayload())
    await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe("https://chatgpt.com")
    }
  })

  test("never contacts a token endpoint", async () => {
    const { impl, calls } = usageOnly(usagePayload())
    await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })
    for (const call of calls) {
      expect(call.url).not.toContain("oauth/token")
      expect(call.url).not.toContain("auth.openai.com")
      expect(String(call.init?.method ?? "GET").toUpperCase()).toBe("GET")
    }
  })
})

describe("fetchCodexAccountUsage — identity validation", () => {
  test("discards a response whose account_id is not the one requested", async () => {
    const { impl } = usageOnly(usagePayload({ account_id: "bbbbbbbb-2222-4222-8222-bbbbbbb4d5e6" }))
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(result.error).toBe("identity_mismatch")
    // The foreign account's quota must not survive anywhere in the result.
    expect(result.usage).toBeNull()
  })

  test("discards a response whose user_id is not the token's user", async () => {
    const { impl } = usageOnly(usagePayload({ user_id: "user-SOMEONE-ELSE" }))
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(result.error).toBe("identity_mismatch")
    expect(result.usage).toBeNull()
  })

  test("refuses before making a request when the token is filed under another account", async () => {
    const { impl, calls } = usageOnly(usagePayload())
    const result = await fetchCodexAccountUsage(
      credentials({ accountUserId: "user-OTHER__aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3" }),
      { fetchImpl: impl },
    )

    expect(result.error).toBe("identity_mismatch")
    // No credential should leave the process once the mismatch is known.
    expect(calls).toHaveLength(0)
  })

  test("accepts the composite accountUserId against the bare response user_id", async () => {
    // The pool stores `user-ABC__<accountId>`; the response returns `user-ABC`.
    // Comparing them literally would reject every legitimate account.
    const { impl } = usageOnly(usagePayload())
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })
    expect(result.error).toBeNull()
  })
})

describe("fetchCodexAccountUsage — failure states", () => {
  test("maps 401 to unauthorized without leaking the upstream detail", async () => {
    const { impl } = usageOnly({ detail: "Could not parse your authentication token." }, 401)
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(result.error).toBe("unauthorized")
    expect(result.usage).toBeNull()
    expect(JSON.stringify(result)).not.toContain("Could not parse")
  })

  test("maps 429 to rate_limited", async () => {
    const { impl } = usageOnly({ detail: "slow down" }, 429)
    expect((await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })).error).toBe("rate_limited")
  })

  test("maps 5xx to upstream_error", async () => {
    const { impl } = usageOnly({ detail: "boom" }, 503)
    expect((await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })).error).toBe("upstream_error")
  })

  test("maps an unparseable body to invalid_response", async () => {
    const impl = (async () => new Response("<html>nope</html>", { status: 200 })) as unknown as typeof fetch
    expect((await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })).error).toBe("invalid_response")
  })

  test("maps a transport failure to upstream_error", async () => {
    const impl = (async () => { throw new Error("ECONNRESET") }) as unknown as typeof fetch
    expect((await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })).error).toBe("upstream_error")
  })

  test("reports a missing access token without making a request", async () => {
    const { impl, calls } = usageOnly(usagePayload())
    const result = await fetchCodexAccountUsage(credentials({ accessToken: null }), { fetchImpl: impl })
    expect(result.error).toBe("no_token")
    expect(calls).toHaveLength(0)
  })

  test("reports an undecodable access token without making a request", async () => {
    const { impl, calls } = usageOnly(usagePayload())
    const result = await fetchCodexAccountUsage(credentials({ accessToken: "not-a-jwt" }), { fetchImpl: impl })
    expect(result.error).toBe("invalid_token")
    expect(calls).toHaveLength(0)
  })

  test("reports an expired token as expired rather than as an auth failure", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
    const body = Buffer.from(JSON.stringify({
      exp: Math.floor(Date.now() / 1000) - 60,
      [AUTH_NAMESPACE]: {
        chatgpt_account_id: ACCOUNT_ID,
        chatgpt_account_user_id: ACCOUNT_USER_ID,
        chatgpt_user_id: USER_ID,
      },
    })).toString("base64url")
    const { impl, calls } = usageOnly(usagePayload())

    const result = await fetchCodexAccountUsage(
      credentials({ accessToken: `${header}.${body}.sig` }),
      { fetchImpl: impl },
    )

    expect(result.error).toBe("token_expired")
    // oc-codex owns the refresh; Meridian must not spend the single-use token.
    expect(calls).toHaveLength(0)
  })
})

describe("fetchCodexAccountUsage — reset credits", () => {
  test("carries the counts from the usage payload", async () => {
    const { impl } = usageOnly(usagePayload({
      rate_limit_reset_credits: { available_count: 2, applicable_available_count: 2 },
    }))
    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(result.usage?.resetCredits?.availableCount).toBe(2)
    expect(result.usage?.resetCredits?.applicableAvailableCount).toBe(2)
  })

  test("keeps the available credits, soonest expiry first, and one with no readable expiry last", async () => {
    const impl = recordingFetch((url) =>
      url.includes("/wham/usage")
        ? jsonResponse(usagePayload())
        : jsonResponse({
          available_count: 3,
          credits: [
            { status: "available", expires_at: "2026-10-05T04:19:17.689022Z" },
            { status: "redeemed", expires_at: "2026-09-01T00:00:00.000Z" },
            { status: "available", expires_at: "not-a-date" },
            { status: "available", expires_at: "2026-10-04T02:14:20.623942Z" },
          ],
        })).impl

    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })
    const credits = result.usage?.resetCredits?.credits ?? []

    // A banked reset whose expiry cannot be read is still banked: dropping it
    // would print one reset fewer than the seat holds.
    expect(credits.map(credit => credit.expiresAt)).toEqual([
      Date.parse("2026-10-04T02:14:20.623942Z"),
      Date.parse("2026-10-05T04:19:17.689022Z"),
      null,
    ])
    expect(result.usage?.resetCredits?.listedCount).toBe(3)
  })

  test("counts the credits as the list states them, like codex-reset status", async () => {
    const listed = (body: unknown) => recordingFetch((url) =>
      url.includes("/wham/usage") ? jsonResponse(usagePayload()) : jsonResponse(body)).impl

    // The list's own count wins over the usage payload's (1 in usagePayload).
    const stated = await fetchCodexAccountUsage(credentials(), {
      fetchImpl: listed({ available_count: 2, credits: [{ status: "available", expires_at: "2026-10-04T00:00:00Z" }] }),
    })
    expect(stated.usage?.resetCredits).toMatchObject({ availableCount: 1, listedCount: 2 })

    // Without a sane stated count, the available credits it lists are counted.
    for (const count of [undefined, -1, 1.5, "2"]) {
      const derived = await fetchCodexAccountUsage(credentials(), {
        fetchImpl: listed({
          available_count: count,
          credits: [{ status: "available", expires_at: "2026-10-04T00:00:00Z" }, { status: "redeemed", expires_at: "2026-09-01T00:00:00Z" }],
        }),
      })
      expect(derived.usage?.resetCredits?.listedCount).toBe(1)
    }
  })

  test("reads credits with the plugin's own client identity, and only ever with a GET", async () => {
    const { impl, calls } = usageOnly(usagePayload())
    await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    const creditCall = calls.find((c) => c.url.includes("rate-limit-reset-credits"))
    expect(creditCall?.url).toBe("https://chatgpt.com/backend-api/wham/rate-limit-reset-credits")
    expect(creditCall?.init?.method).toBe("GET")
    expect(creditCall?.init?.redirect).toBe("error")
    const headers = creditCall?.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${credentials().accessToken}`)
    expect(headers["ChatGPT-Account-ID"]).toBe(ACCOUNT_ID)
    expect(headers.originator).toBe("codex_cli_rs")
    expect(headers["OpenAI-Beta"]).toBe("responses=experimental")
    expect(headers["User-Agent"]).toMatch(/^codex_cli_rs\/0\.155\.0 \(.+; .+\) unknown$/)
    // Redeeming a credit is irreversible; nothing here may reach that endpoint.
    expect(calls.every((c) => c.init?.method === "GET" && !c.url.includes("/consume"))).toBe(true)
  })

  test("a failing detail lookup does not sink the card", async () => {
    const impl = recordingFetch((url) =>
      url.includes("/wham/usage")
        ? jsonResponse(usagePayload())
        : jsonResponse({ detail: "boom" }, 500)).impl

    const result = await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(result.error).toBeNull()
    expect(result.usage?.windows).toHaveLength(1)
    expect(result.usage?.resetCredits?.availableCount).toBe(1)
    // null credits distinguishes "lookup failed" from "successfully empty".
    expect(result.usage?.resetCredits?.credits).toBeNull()
    expect(result.usage?.resetCredits?.listedCount).toBeNull()
    expect(result.usage?.resetCredits?.error).toBe("upstream_error")
  })

  test("does not look up credit detail when identity validation failed", async () => {
    const { impl, calls } = usageOnly(usagePayload({ account_id: "bbbbbbbb-2222-4222-8222-bbbbbbb4d5e6" }))
    await fetchCodexAccountUsage(credentials(), { fetchImpl: impl })

    expect(calls.filter((c) => c.url.includes("rate-limit-reset-credits"))).toHaveLength(0)
  })
})

describe("fetchCodexAccountUsage — purchased credits", () => {
  test("reads the balance the vendor states as a decimal string", async () => {
    const read = async (credits: unknown) =>
      (await fetchCodexAccountUsage(credentials(), { fetchImpl: usageOnly(usagePayload({ credits })).impl })).usage?.credits
    expect(await read({ has_credits: false, unlimited: false, overage_limit_reached: false, balance: "0" }))
      .toEqual({ hasCredits: false, unlimited: false, overageLimitReached: false, balance: 0 })
    expect(await read({ has_credits: true, unlimited: false, overage_limit_reached: true, balance: "14.5" }))
      .toEqual({ hasCredits: true, unlimited: false, overageLimitReached: true, balance: 14.5 })
    expect(await read({ has_credits: true, balance: "0E-10" })).toMatchObject({ balance: 0 })
    expect(await read({ has_credits: true, balance: "lots" })).toMatchObject({ hasCredits: true, balance: null })
    expect(await read(null)).toBeNull()
    expect(await read(undefined)).toBeNull()
  })
})

describe("fetchCodexWorkspaceNames", () => {
  const answering = (body: unknown, status = 200) => recordingFetch(() => jsonResponse(body, status))

  test("names the Business workspaces the token's user belongs to, by workspace id", async () => {
    const { impl, calls } = answering({
      accounts: [
        { id: ACCOUNT_ID, structure: "workspace", name: "  Acme\u202e\u0007  Corp  " },
        { id: "personal-1", structure: "personal", name: "Me" },
        { id: "workspace-2", name: "Beta" },
        { id: 7, structure: "workspace", name: "No id" },
        { id: "workspace-3", structure: "workspace", name: " \u200b " },
      ],
    })

    const names = await fetchCodexWorkspaceNames(credentials(), { fetchImpl: impl })

    expect(names).toEqual(new Map([[ACCOUNT_ID, "Acme Corp"], ["workspace-2", "Beta"]]))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("https://chatgpt.com/backend-api/wham/accounts/check")
    expect(calls[0]!.init?.method).toBe("GET")
    expect(calls[0]!.init?.redirect).toBe("error")
    const headers = calls[0]!.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${credentials().accessToken}`)
    expect(headers["ChatGPT-Account-ID"]).toBe(ACCOUNT_ID)
    expect(headers.originator).toBe("codex_cli_rs")
  })

  test("bounds a long name", async () => {
    const { impl } = answering({ accounts: [{ id: ACCOUNT_ID, structure: "workspace", name: "x".repeat(200) }] })
    const name = (await fetchCodexWorkspaceNames(credentials(), { fetchImpl: impl }))?.get(ACCOUNT_ID) ?? ""
    expect([...name]).toHaveLength(64)
    expect(name.endsWith("\u2026")).toBe(true)
  })

  test("sends nothing without a usable token, and reports a failed or unreadable answer as unknown", async () => {
    const expired = recordingFetch(() => jsonResponse({ accounts: [] }))
    const past = Math.floor(Date.now() / 1000) - 60
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")
    const body = Buffer.from(JSON.stringify({
      exp: past,
      [AUTH_NAMESPACE]: { chatgpt_account_id: ACCOUNT_ID, chatgpt_account_user_id: ACCOUNT_USER_ID, chatgpt_user_id: USER_ID },
    })).toString("base64url")
    expect(await fetchCodexWorkspaceNames(credentials({ accessToken: `${header}.${body}.sig` }), { fetchImpl: expired.impl })).toBeNull()
    expect(await fetchCodexWorkspaceNames(credentials({ accessToken: null }), { fetchImpl: expired.impl })).toBeNull()
    expect(expired.calls).toHaveLength(0)

    expect(await fetchCodexWorkspaceNames(credentials(), { fetchImpl: answering({ detail: "boom" }, 500).impl })).toBeNull()
    expect(await fetchCodexWorkspaceNames(credentials(), { fetchImpl: answering({ unexpected: true }).impl })).toBeNull()
    // A user in no workspace is a known answer, not an unknown one.
    expect(await fetchCodexWorkspaceNames(credentials(), { fetchImpl: answering({ accounts: [] }).impl })).toEqual(new Map())
  })
})
