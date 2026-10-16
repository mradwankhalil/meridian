/**
 * Unit tests for the Codex usage service — the layer that turns a pool of
 * accounts into a dashboard's worth of cards.
 *
 * Three properties are load-bearing here and each has its own test:
 *
 * - Off means off. When the operator disables the integration, nothing reads
 *   the pool and nothing touches the network. Anything less would mean Meridian
 *   quietly using another tool's credentials after being told not to.
 * - One account's failure never sinks its siblings. Six accounts on one card
 *   grid means five working cards must survive the sixth being broken.
 * - The dashboard polls every ten seconds. Without caching, six accounts would
 *   mean seventy-two authenticated requests a minute against an undocumented
 *   vendor endpoint, so the cache is a correctness requirement rather than an
 *   optimisation.
 *
 * Every token here is synthetic and every identifier is invented.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { getCodexUsage, resetCodexUsageCache } from "../proxy/codex/service"
import type { CodexPoolAccount, CodexPoolResult } from "../proxy/codex/pool"
import type { CodexUsageEntry, CodexUsageResponse } from "../proxy/codex/types"

const NOW = 1_800_000_000_000
const NOW_SECONDS = Math.floor(NOW / 1000)
const RESET_AT_SECONDS = NOW_SECONDS + 86_400

function jwt(claims: Record<string, unknown>, expSeconds: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode({ exp: expSeconds, "https://api.openai.com/auth": claims }),
    "signature",
  ].join(".")
}

/** A pool record paired with an access token that agrees about whose it is. */
function poolAccount(
  n: number,
  opts: { planType?: string; expSeconds?: number; accountId?: string } = {},
): CodexPoolAccount {
  const accountId = opts.accountId ?? `aaaaaaaa-0000-4000-8000-00000000000${n}`
  const userId = `user-USER${n}`
  const accountUserId = `${userId}__${accountId}`
  const expSeconds = opts.expSeconds ?? NOW_SECONDS + 3600
  return {
    accountId,
    accountUserId,
    organizationId: `org-ORG${n}`,
    email: `account${n}@example.com`,
    accountLabel: null,
    planType: null,
    accessToken: jwt({
      chatgpt_account_id: accountId,
      chatgpt_account_user_id: accountUserId,
      chatgpt_user_id: userId,
      chatgpt_plan_type: opts.planType ?? "pro",
    }, expSeconds),
    expiresAt: expSeconds * 1000,
    enabled: true,
  }
}

function usageBody(account: CodexPoolAccount): Record<string, unknown> {
  return {
    user_id: account.accountUserId?.split("__")[0] ?? null,
    account_id: account.accountId,
    email: account.email,
    plan_type: "pro",
    rate_limit: {
      primary_window: {
        used_percent: 40,
        limit_window_seconds: 604800,
        reset_at: RESET_AT_SECONDS,
      },
      secondary_window: null,
    },
    rate_limit_reset_credits: { available_count: 2, applicable_available_count: 0 },
  }
}

interface StubReply {
  status: number
  body?: unknown
}

function stubFetch(
  reply: (url: string, headers: Headers) => StubReply,
  opts: { delayMs?: number } = {},
) {
  const calls: Array<{ url: string; accountId: string | null }> = []
  let inFlight = 0
  let peakInFlight = 0

  const impl = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    calls.push({ url, accountId: headers.get("chatgpt-account-id") })

    inFlight++
    peakInFlight = Math.max(peakInFlight, inFlight)
    if (opts.delayMs) await new Promise((resolve) => setTimeout(resolve, opts.delayMs))
    inFlight--

    const { status, body } = reply(url, headers)
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }) as typeof fetch

  return { impl, calls, peak: () => peakInFlight }
}

function bearer(account: CodexPoolAccount): string {
  return `Bearer ${account.accessToken}`
}

/** Answer every account correctly, so only the orchestration is under test. */
function serveAll(accounts: CodexPoolAccount[]) {
  return (url: string, headers: Headers): StubReply => {
    const account = accounts.find((candidate) => headers.get("authorization") === bearer(candidate))
    if (!account) return { status: 404 }
    return { status: 200, body: url.endsWith("/usage") ? usageBody(account) : { credits: [] } }
  }
}

function pool(accounts: CodexPoolAccount[]): () => CodexPoolResult {
  return () => ({ pool: { path: "/nonexistent/oc-codex-multi-auth-accounts.json", accounts }, error: null })
}

function entryFor(result: CodexUsageResponse, account: CodexPoolAccount): CodexUsageEntry | undefined {
  return result.entries.find((entry) => entry.id === account.accountUserId)
}

describe("codex usage service", () => {
  beforeEach(() => resetCodexUsageCache())
  afterEach(() => resetCodexUsageCache())

  test("reads nothing and calls nothing when the integration is off", async () => {
    let poolReads = 0
    const loadPool = (): CodexPoolResult => {
      poolReads++
      return { pool: null, error: null }
    }
    const { impl, calls } = stubFetch(() => ({ status: 200, body: {} }))

    const result = await getCodexUsage({
      settings: { integrations: { codexUsage: false } },
      loadPool,
      fetchImpl: impl,
      now: NOW,
    })

    expect(result).toEqual({ entries: [], error: "disabled", asOf: NOW })
    expect(poolReads).toBe(0)
    expect(calls).toHaveLength(0)
  })

  test("is on for an untouched install and renders the account", async () => {
    const account = poolAccount(1)
    const { impl } = stubFetch(serveAll([account]))

    const result = await getCodexUsage({
      settings: {},
      loadPool: pool([account]),
      fetchImpl: impl,
      now: NOW,
    })

    expect(result.error).toBeNull()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      id: account.accountUserId,
      type: "codex",
      identity: "account1@example.com, id:000001",
      email: "account1@example.com",
      plan: { slug: "pro", label: "ChatGPT Pro", multiplier: "20x" },
      fetchedAt: NOW,
      stale: false,
      error: null,
    })
    expect(result.entries[0]?.windows).toEqual([{
      type: "7d",
      utilization: 0.4,
      resetsAt: RESET_AT_SECONDS * 1000,
      limitWindowSeconds: 604800,
    }])
    expect(result.entries[0]?.resetCredits).toEqual({
      availableCount: 2,
      applicableAvailableCount: 0,
      listedCount: 0,
      credits: [],
      error: null,
    })
  })

  test("passes a pool failure through without touching the network", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: {} }))

    for (const error of ["not_configured", "pool_unreadable", "invalid_pool"] as const) {
      const result = await getCodexUsage({
        settings: {},
        loadPool: () => ({ pool: null, error }),
        fetchImpl: impl,
        now: NOW,
      })
      expect(result).toEqual({ entries: [], error, asOf: NOW })
    }
    expect(calls).toHaveLength(0)
  })

  test("stays quiet when the pool is present but holds no accounts", async () => {
    const { impl, calls } = stubFetch(() => ({ status: 200, body: {} }))

    const result = await getCodexUsage({
      settings: {},
      loadPool: pool([]),
      fetchImpl: impl,
      now: NOW,
    })

    expect(result).toEqual({ entries: [], error: "not_configured", asOf: NOW })
    expect(calls).toHaveLength(0)
  })

  test("keys entries by accountUserId, so a shared accountId still yields two cards", async () => {
    // Not hypothetical: the real pool this was built against has one accountId
    // shared by two different people.
    const shared = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
    const one = poolAccount(1, { accountId: shared })
    const two = poolAccount(2, { accountId: shared })
    const { impl } = stubFetch(serveAll([one, two]))

    const result = await getCodexUsage({
      settings: {},
      loadPool: pool([one, two]),
      fetchImpl: impl,
      now: NOW,
    })

    expect(result.entries).toHaveLength(2)
    expect(entryFor(result, one)?.email).toBe("account1@example.com")
    expect(entryFor(result, two)?.email).toBe("account2@example.com")
    expect(entryFor(result, one)?.error).toBeNull()
    expect(entryFor(result, two)?.error).toBeNull()
  })

  test("keeps one account's failure from sinking its siblings", async () => {
    const healthy = poolAccount(1)
    const broken = poolAccount(2)
    const { impl } = stubFetch((url, headers) => {
      if (headers.get("authorization") === bearer(broken)) return { status: 401 }
      return serveAll([healthy])(url, headers)
    })

    const result = await getCodexUsage({
      settings: {},
      loadPool: pool([healthy, broken]),
      fetchImpl: impl,
      now: NOW,
    })

    expect(result.error).toBeNull()
    expect(result.entries).toHaveLength(2)
    expect(entryFor(result, healthy)?.error).toBeNull()
    expect(entryFor(result, healthy)?.windows).toHaveLength(1)
    expect(entryFor(result, broken)?.error).toBe("unauthorized")
    expect(entryFor(result, broken)?.windows).toEqual([])
  })

  test("names the plan from the token even when usage cannot be fetched", async () => {
    const expired = poolAccount(1, {
      planType: "self_serve_business_prolite",
      expSeconds: NOW_SECONDS - 60,
    })
    const { impl, calls } = stubFetch(() => ({ status: 200, body: {} }))

    const result = await getCodexUsage({
      settings: {},
      loadPool: pool([expired]),
      fetchImpl: impl,
      now: NOW,
    })

    expect(result.entries[0]?.error).toBe("token_expired")
    expect(result.entries[0]?.plan).toEqual({
      slug: "self_serve_business_prolite",
      label: "ChatGPT Business Premium",
      multiplier: "5x",
    })
    expect(calls).toHaveLength(0)
  })

  test("makes no request when a token is filed under another account", async () => {
    const impostor = { ...poolAccount(1), accountUserId: "user-SOMEONEELSE__cccccccc" }
    const { impl, calls } = stubFetch(() => ({ status: 200, body: {} }))

    const result = await getCodexUsage({
      settings: {},
      loadPool: pool([impostor]),
      fetchImpl: impl,
      now: NOW,
    })

    expect(result.entries[0]?.error).toBe("identity_mismatch")
    expect(calls).toHaveLength(0)
  })

  test("serves cached usage inside the TTL without asking upstream again", async () => {
    const account = poolAccount(1)
    const { impl, calls } = stubFetch(serveAll([account]))

    const first = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW,
    })
    // Usage, its reset credits, and the workspace names.
    expect(calls).toHaveLength(3)

    const second = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW + 5_000,
    })
    expect(calls).toHaveLength(3)
    expect(second.entries[0]?.windows).toEqual(first.entries[0]?.windows ?? [])
    expect(second.entries[0]?.stale).toBe(false)
    expect(second.entries[0]?.fetchedAt).toBe(NOW)
  })

  test("shares one upstream call between concurrent readers of the same account", async () => {
    const account = poolAccount(1)
    const { impl, calls } = stubFetch(serveAll([account]), { delayMs: 5 })

    const [a, b] = await Promise.all([
      getCodexUsage({ settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW }),
      getCodexUsage({ settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW }),
    ])

    expect(calls).toHaveLength(3)
    expect(a.entries[0]?.windows).toEqual(b.entries[0]?.windows ?? [])
  })

  test("serves the last good usage when a refresh fails transiently", async () => {
    const account = poolAccount(1)
    let failing = false
    const { impl } = stubFetch((url, headers) =>
      failing ? { status: 503 } : serveAll([account])(url, headers))

    const first = await getCodexUsage({ settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW })
    expect(first.entries[0]?.failure).toBeNull()
    failing = true
    const second = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW + 60_000,
    })

    expect(second.entries[0]?.stale).toBe(true)
    expect(second.entries[0]?.error).toBe("upstream_error")
    expect(second.entries[0]?.windows).toHaveLength(1)
    expect(second.entries[0]?.fetchedAt).toBe(NOW)
    // The run behind the stale figures, as a Claude card reports its own.
    expect(second.entries[0]?.failure).toEqual({ reason: "upstream_error", consecutiveFailures: 1, lastFailureAt: NOW + 60_000 })

    failing = false
    const recovered = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW + 120_000,
    })
    expect(recovered.entries[0]?.failure).toBeNull()
    expect(recovered.entries[0]?.stale).toBe(false)
  })

  test("withholds stale usage when the credential itself is refused", async () => {
    const account = poolAccount(1)
    let refusing = false
    const { impl } = stubFetch((url, headers) =>
      refusing ? { status: 401 } : serveAll([account])(url, headers))

    await getCodexUsage({ settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW })
    refusing = true
    const second = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW + 60_000,
    })

    expect(second.entries[0]?.error).toBe("unauthorized")
    expect(second.entries[0]?.stale).toBe(false)
    expect(second.entries[0]?.windows).toEqual([])
    expect(second.entries[0]?.fetchedAt).toBeNull()
  })

  test("stops asking upstream while an account is rate limited", async () => {
    const account = poolAccount(1)
    const { impl, calls } = stubFetch(() => ({ status: 429 }))

    const first = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW,
    })
    expect(first.entries[0]?.error).toBe("rate_limited")
    expect(first.entries[0]?.failure).toEqual({ reason: "rate_limited", consecutiveFailures: 1, lastFailureAt: NOW })
    expect(calls).toHaveLength(1)

    const during = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW + 35_000,
    })
    expect(during.entries[0]?.error).toBe("rate_limited")
    // A poll the cooldown turned away is not a check that failed.
    expect(during.entries[0]?.failure?.consecutiveFailures).toBe(1)
    expect(calls).toHaveLength(1)

    const after = await getCodexUsage({
      settings: {}, loadPool: pool([account]), fetchImpl: impl, now: NOW + 61_000,
    })
    expect(calls).toHaveLength(2)
    expect(after.entries[0]?.failure).toEqual({ reason: "rate_limited", consecutiveFailures: 2, lastFailureAt: NOW + 61_000 })
  })

  test("names each workspace once, for every seat in it, and asks again only when due", async () => {
    const workspace = "bbbbbbbb-0000-4000-8000-00000000000b"
    const twoDays = NOW_SECONDS + 2 * 86_400
    const reader = poolAccount(1, { accountId: workspace, expSeconds: twoDays })
    const expired = poolAccount(2, { accountId: workspace, expSeconds: NOW_SECONDS - 60 })
    const personal = poolAccount(3, { expSeconds: twoDays })
    let failing = false
    const { impl, calls } = stubFetch((url, headers) => {
      if (url.endsWith("/wham/accounts/check")) {
        if (failing) return { status: 503 }
        return {
          status: 200,
          body: {
            accounts: [
              { id: workspace, structure: "workspace", name: "Acme Workspace" },
              { id: personal.accountId, structure: "personal", name: null },
            ],
          },
        }
      }
      return serveAll([reader, expired, personal])(url, headers)
    })
    const read = (now: number) => getCodexUsage({ settings: {}, loadPool: pool([reader, expired, personal]), fetchImpl: impl, now })
    const lookups = () => calls.filter((call) => call.url.endsWith("/wham/accounts/check")).length

    const first = await read(NOW)
    // The expired seat is never asked, yet its workspace is named through its sibling.
    expect(first.entries.map((entry) => entry.workspaceName)).toEqual(["Acme Workspace", "Acme Workspace", null])
    expect(lookups()).toBe(2)

    // A usage refresh past its 30 s cache does not ask for names again.
    await read(NOW + 60_000)
    expect(lookups()).toBe(2)

    // Past the name's lifetime it is asked again, and a failed read keeps what was known.
    failing = true
    const later = await read(NOW + 13 * 60 * 60_000)
    expect(lookups()).toBe(4)
    expect(later.entries[0]?.workspaceName).toBe("Acme Workspace")
  })

  test("caps how many accounts it asks upstream about at once", async () => {
    const accounts = [1, 2, 3, 4, 5, 6].map((n) => poolAccount(n))
    const { impl, peak } = stubFetch(serveAll(accounts), { delayMs: 5 })

    const result = await getCodexUsage({
      settings: {}, loadPool: pool(accounts), fetchImpl: impl, now: NOW,
    })

    expect(result.entries).toHaveLength(6)
    expect(result.entries.every((entry) => entry.error === null)).toBe(true)
    // An uncapped fan-out peaks at six here — one in-flight request per account.
    // The lower bound keeps a fully serial implementation from passing.
    expect(peak()).toBeLessThanOrEqual(4)
    expect(peak()).toBeGreaterThan(1)
  })
})
