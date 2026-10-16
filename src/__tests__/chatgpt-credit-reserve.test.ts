/**
 * Codex credits as a reserve: a seat whose plan quota is spent may still
 * serve on purchased credits, but only once no seat with plan quota is left.
 *
 * Measured 2026-09-30 on a Pro seat at 100% of its weekly window with 62,500
 * credits: `/wham/usage` said `allowed: true, limit_reached: false` and
 * `codex/responses` served 200 with no opt-in of any kind. The backend spends
 * credits by itself; what kept that seat idle was local state - the credential
 * owner's `quotaExhaustedUntil` stamp and Meridian's own `quota_spent` bench.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createChatGptBackend, type ChatGptRoute, type ChatGptTurnEvent } from "../proxy/backends/chatgpt"
import { createExternalCredentialSource } from "../proxy/chatgpt/external"
import { chatGptCreditsFromHeaders, creditsCanServe } from "../proxy/chatgpt/windows"
import type { ChatGptCreditsPolicy, ChatGptFreeSeatOrder } from "../proxy/chatgpt/features"
import type { CodexCredits, CodexUsageWindow } from "../proxy/codex/types"
import { ProfileExhaustion } from "../proxy/routing"

const NOW = 1_800_000_000_000
const WEEK_S = 7 * 24 * 3600

const seatId = (n: number) => `user-${n}__workspace-${n}`
function account(n: number, extra: Record<string, unknown> = {}) {
  return {
    accountId: `workspace-${n}`, accountUserId: seatId(n), email: `seat${n}@example.test`, planType: "pro",
    refreshToken: `rt-${n}`, accessToken: `at-${n}`, expiresAt: NOW + 3_600_000, addedAt: 1, lastUsed: 1, ...extra,
  }
}
const stamped = (n: number) => account(n, { quotaExhaustedUntil: NOW + 3 * 24 * 3_600_000, quotaExhaustedStampAt: NOW - 1 })

const PAYABLE: CodexCredits = { hasCredits: true, unlimited: false, overageLimitReached: false, balance: 62_500 }
const EMPTY: CodexCredits = { hasCredits: false, unlimited: false, overageLimitReached: false, balance: 0 }

/** A served Codex answer, optionally stating a spent weekly window and a credits balance. */
function served(headers: Record<string, string> = {}): Response {
  const events = [
    { type: "response.created", response: { id: "r1", output: [] } },
    { type: "response.output_text.delta", delta: "pong" },
    { type: "response.completed", response: { id: "r1", model: "gpt-5.6-luna", output: [], usage: { input_tokens: 16, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 } } } },
  ]
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200, headers: { "content-type": "text/event-stream", ...headers },
  })
}
const spentWeekly = (): Record<string, string> => ({
  "x-codex-primary-window-minutes": String(WEEK_S / 60),
  "x-codex-primary-used-percent": "100",
  "x-codex-primary-reset-at": String(Math.floor(NOW / 1000) + 3 * 24 * 3600),
})
const creditHeaders = (hasCredits: boolean, balance: string): Record<string, string> => ({
  "x-codex-credits-has-credits": hasCredits ? "True" : "False",
  "x-codex-credits-unlimited": "False",
  "x-codex-credits-balance": balance,
})
const usageLimit = () => new Response(JSON.stringify({ error: { type: "usage_limit_reached", message: "The usage limit has been reached" } }), {
  status: 429, headers: { "content-type": "application/json", ...spentWeekly(), ...creditHeaders(false, "") },
})

let dir: string
let poolPath: string
function writePool(accounts: unknown[]) {
  writeFileSync(poolPath, JSON.stringify({ version: 3, accounts, activeIndex: 0 }))
}

interface Harness {
  calls: string[]
  events: ChatGptTurnEvent[]
  refreshes: number
  exhaustion: ProfileExhaustion
  turn(): Promise<Response>
}

function harness(options: {
  respond?: (token: string, index: number) => Response
  credits?: Record<string, CodexCredits>
  /** Credits the usage read would find once refreshed. */
  refreshTo?: Record<string, CodexCredits>
  route?: ChatGptRoute
  /** Policy per seat, or one for all; null = the backend's own default. Defaults to reserve. */
  policy?: ChatGptCreditsPolicy | Record<string, ChatGptCreditsPolicy> | null
  /** Plan windows from the usage read, per seat. */
  windows?: Record<string, CodexUsageWindow[]>
} = {}): Harness {
  const credits: Record<string, CodexCredits> = { ...options.credits }
  const policy = options.policy === undefined ? "reserve" : options.policy
  const exhaustion = new ProfileExhaustion(() => NOW)
  const h: Harness = {
    calls: [], events: [], refreshes: 0, exhaustion,
    turn: () => backend.handle({ context: {}, endpoint: "responses", route: "/v1/responses" }),
  }
  const backend = createChatGptBackend<object>({
    source: createExternalCredentialSource({ path: poolPath, now: () => NOW }),
    exhaustion,
    now: () => NOW,
    inboundRequest: () => new Request("http://localhost/v1/responses", {
      method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", stream: true, input: "Hi" }),
    }),
    route: options.route ? () => options.route! : undefined,
    credits: (seat) => credits[seat] ? { credits: credits[seat]!, at: NOW - 60_000 } : null,
    refreshCredits: options.refreshTo ? async () => { h.refreshes++; Object.assign(credits, options.refreshTo) } : undefined,
    creditsPolicy: policy === null ? undefined : (seat) => typeof policy === "string" ? policy : policy[seat] ?? "never",
    planWindows: options.windows ? (seat) => options.windows![seat] ? { windows: options.windows![seat]!, at: NOW - 60_000 } : null : undefined,
    hooks: { onTurn: (event) => h.events.push(event) },
    fetchImpl: async (_url, init) => {
      const token = new Headers(init.headers).get("authorization")!.replace("Bearer ", "")
      h.calls.push(token)
      return (options.respond ?? (() => served()))(token, h.calls.length - 1)
    },
  })
  return h
}

async function drain(response: Response): Promise<string> {
  return await response.text()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chatgpt-credit-reserve-"))
  poolPath = join(dir, "oc-codex-multi-auth-accounts.json")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("Codex credits reserve", () => {
  it("serves a seat with plan quota before a seat that would spend credits", async () => {
    writePool([stamped(0), account(1)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE } })
    const response = await h.turn()
    await drain(response)
    expect(response.status).toBe(200)
    expect(h.calls).toEqual(["at-1"])
    expect(h.events[0]?.servedOnCredits).toBeUndefined()
  })

  it("serves on credits once no seat has plan quota left", async () => {
    writePool([stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE } })
    const response = await h.turn()
    expect(await drain(response)).toContain("pong")
    expect(response.status).toBe(200)
    expect(h.calls).toEqual(["at-0"])
    expect(h.events[0]).toMatchObject({ seat: seatId(0), status: 200, servedOnCredits: true })
  })

  it("falls to credits after a plan-quota seat refuses the same turn", async () => {
    writePool([account(1), stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, respond: (token) => token === "at-1" ? usageLimit() : served() })
    const response = await h.turn()
    await drain(response)
    expect(response.status).toBe(200)
    expect(h.calls).toEqual(["at-1", "at-0"])
    expect(h.events[0]).toMatchObject({ seat: seatId(0), servedOnCredits: true })
  })

  it("never sends a request for a spent seat whose credits cannot pay", async () => {
    writePool([stamped(0), stamped(1)])
    const h = harness({ credits: { [seatId(0)]: EMPTY, [seatId(1)]: { ...PAYABLE, overageLimitReached: true } } })
    const response = await h.turn()
    expect(response.status).toBe(429)
    expect(h.calls).toEqual([])
  })

  it("reads usage once when a spent seat's credits are unknown, then serves on them", async () => {
    writePool([stamped(0)])
    const h = harness({ refreshTo: { [seatId(0)]: PAYABLE } })
    const response = await h.turn()
    await drain(response)
    expect(response.status).toBe(200)
    expect(h.refreshes).toBe(1)
    expect(h.calls).toEqual(["at-0"])
  })

  it("keeps a warm off credits", async () => {
    writePool([stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, route: { kind: "pinned", seat: seatId(0), spendCredits: false } })
    const response = await h.turn()
    expect(response.status).toBe(429)
    expect(h.calls).toEqual([])
  })

  it("lets a pinned seat serve on credits", async () => {
    writePool([account(1), stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, route: { kind: "pinned", seat: seatId(0) } })
    const response = await h.turn()
    await drain(response)
    expect(response.status).toBe(200)
    expect(h.calls).toEqual(["at-0"])
  })

  it("keeps a seat Meridian benched after its plan ran out as a credits reserve, known from its headers alone", async () => {
    writePool([account(0), account(1)])
    let seat1Spent = false
    const h = harness({
      respond: (token) => {
        if (token === "at-0") return served({ ...spentWeekly(), ...creditHeaders(true, "62500") })
        if (seat1Spent) return usageLimit()
        return served()
      },
      route: { kind: "pool", excluded: new Set(), preferred: seatId(0) },
    })
    await drain(await h.turn())
    expect(h.exhaustion.snapshot()).toMatchObject([{ id: seatId(0), reason: "quota_spent" }])

    // Plan quota elsewhere comes first ...
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-0", "at-1"])

    // ... and the benched seat pays once that runs out too.
    seat1Spent = true
    const response = await h.turn()
    await drain(response)
    expect(response.status).toBe(200)
    expect(h.calls).toEqual(["at-0", "at-1", "at-1", "at-0"])
    expect(h.events.at(-1)).toMatchObject({ seat: seatId(0), servedOnCredits: true })
  })

  it("stops offering a seat whose credits turn was refused", async () => {
    writePool([stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, respond: () => usageLimit() })
    expect((await h.turn()).status).toBe(429)
    expect(h.calls).toEqual(["at-0"])
    expect((await h.turn()).status).toBe(429)
    expect(h.calls).toEqual(["at-0"])
  })
})

describe("Codex credits policy", () => {
  const spentWindow = (): CodexUsageWindow[] => [{ type: "weekly", utilization: 1, resetsAt: NOW + 3 * 86_400_000, limitWindowSeconds: WEEK_S }]
  const freshWindow = (): CodexUsageWindow[] => [{ type: "weekly", utilization: 0.4, resetsAt: NOW + 3 * 86_400_000, limitWindowSeconds: WEEK_S }]

  it("spends no credits when no policy is configured: the default is never", async () => {
    writePool([stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, policy: null })
    expect((await h.turn()).status).toBe(429)
    expect(h.calls).toEqual([])
  })

  it("never: a plan-exhausted seat with credits is not sent work, even with nothing else left", async () => {
    writePool([stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, policy: "never" })
    expect((await h.turn()).status).toBe(429)
    expect(h.calls).toEqual([])
  })

  it("never: a seat the usage read shows drained is kept off, though its owner never stamped it", async () => {
    writePool([account(0), account(1)])
    const h = harness({
      credits: { [seatId(0)]: PAYABLE }, policy: "never",
      windows: { [seatId(0)]: spentWindow(), [seatId(1)]: freshWindow() },
      route: { kind: "pool", excluded: new Set(), preferred: seatId(0) },
    })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-1"])
  })

  it("never: a seat Meridian benched after its plan ran out stays benched", async () => {
    writePool([account(0)])
    const h = harness({ policy: "never", respond: () => served({ ...spentWeekly(), ...creditHeaders(true, "62500") }) })
    await drain(await h.turn())
    expect((await h.turn()).status).toBe(429)
    expect(h.calls).toEqual(["at-0"])
  })

  it("reserve: credits only after every seat with plan quota", async () => {
    writePool([stamped(0), account(1)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, policy: "reserve", respond: (token) => token === "at-1" ? usageLimit() : served() })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-1", "at-0"])
    expect(h.events[0]).toMatchObject({ seat: seatId(0), servedOnCredits: true })
  })

  it("immediately: a drained seat serves on credits in normal routing order, before a seat with plan quota behind it", async () => {
    writePool([stamped(0), account(1)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, policy: "immediately" })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-0"])
    expect(h.events[0]).toMatchObject({ seat: seatId(0), servedOnCredits: true })
  })

  it("immediately: still needs credits that can pay", async () => {
    writePool([stamped(0), account(1)])
    const h = harness({ credits: { [seatId(0)]: EMPTY }, policy: "immediately" })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-1"])
    expect(h.events[0]?.servedOnCredits).toBeUndefined()
  })

  it("a per-seat override decides for that seat alone", async () => {
    writePool([stamped(0), stamped(1), account(2)])
    const h = harness({
      credits: { [seatId(0)]: PAYABLE, [seatId(1)]: PAYABLE },
      policy: { [seatId(0)]: "never", [seatId(1)]: "immediately" },
    })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-1"])
  })

  it("leaves seats with plan quota alone under every policy", async () => {
    for (const policy of ["never", "reserve", "immediately"] as const) {
      writePool([account(0), account(1)])
      const h = harness({ credits: { [seatId(0)]: PAYABLE, [seatId(1)]: PAYABLE }, policy })
      await drain(await h.turn())
      expect(h.calls).toEqual(["at-0"])
      expect(h.events[0]?.servedOnCredits).toBeUndefined()
    }
  })

  it("keeps a warm off credits even under immediately", async () => {
    writePool([stamped(0)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, policy: "immediately", route: { kind: "pinned", seat: seatId(0), spendCredits: false } })
    expect((await h.turn()).status).toBe(429)
    expect(h.calls).toEqual([])
  })

  it("does not lead with an active seat that may not spend its credits", async () => {
    writePool([stamped(0), account(1)])
    const h = harness({ credits: { [seatId(0)]: PAYABLE }, policy: "reserve", route: { kind: "pool", excluded: new Set(), preferred: seatId(0) } })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-1"])
  })

  it("reads usage before routing to a seat it never read when that seat may not spend credits", async () => {
    writePool([account(0)])
    let reads = 0
    const windows: Record<string, CodexUsageWindow[]> = {}
    const backend = createChatGptBackend<object>({
      source: createExternalCredentialSource({ path: poolPath, now: () => NOW }),
      exhaustion: new ProfileExhaustion(() => NOW),
      now: () => NOW,
      inboundRequest: () => new Request("http://localhost/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", stream: true, input: "Hi" }) }),
      creditsPolicy: () => "never",
      planWindows: (seat) => windows[seat] ? { windows: windows[seat]!, at: NOW } : null,
      refreshCredits: async () => { reads++; windows[seatId(0)] = spentWindow() },
      fetchImpl: async () => served(),
    })
    const response = await backend.handle({ context: {}, endpoint: "responses", route: "/v1/responses" })
    expect(reads).toBe(1)
    expect(response.status).toBe(429)
  })

  it("states on the seat's card whether its plan is spent and whether it is serving on credits", async () => {
    writePool([stamped(0), account(1)])
    const exhaustion = new ProfileExhaustion(() => NOW)
    const backend = createChatGptBackend<object>({
      source: createExternalCredentialSource({ path: poolPath, now: () => NOW }),
      exhaustion,
      now: () => NOW,
      inboundRequest: () => new Request("http://localhost/v1/responses", { method: "POST", body: JSON.stringify({ model: "gpt-5.6-luna", stream: true, input: "Hi" }) }),
      creditsPolicy: () => "immediately",
      credits: () => ({ credits: PAYABLE, at: NOW }),
      fetchImpl: async () => served(),
    })
    expect(backend.seatCreditState(seatId(0))).toEqual({ planSpent: true, servingOnCredits: false })
    await drain(await backend.handle({ context: {}, endpoint: "responses", route: "/v1/responses" }))
    expect(backend.seatCreditState(seatId(0))).toEqual({ planSpent: true, servingOnCredits: true })
    expect(backend.seatCreditState(seatId(1))).toEqual({ planSpent: false, servingOnCredits: false })
  })
})

describe("free-plan seats", () => {
  // Seat 0 is the free seat throughout, and the active pointer names it.
  const freePool = (freeSeatOrder: ChatGptFreeSeatOrder): ChatGptRoute => ({
    kind: "pool", excluded: new Set(), preferred: seatId(0), free: new Set([seatId(0)]), freeSeatOrder,
  })

  it("serves a paid seat with plan quota first, though the pointer names the free seat", async () => {
    writePool([account(0, { planType: "free" }), account(1)])
    const h = harness({ route: freePool("before-credits") })
    const response = await h.turn()
    await drain(response)
    expect(response.status).toBe(200)
    expect(h.calls).toEqual(["at-1"])
  })

  it("before-credits: the free seat serves before any seat spends credits", async () => {
    writePool([account(0, { planType: "free" }), stamped(1)])
    const h = harness({ route: freePool("before-credits"), policy: "immediately", credits: { [seatId(1)]: PAYABLE } })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-0"])
    expect(h.events[0]?.servedOnCredits).toBeUndefined()
  })

  it("before-credits: falls to credits when the free seat refuses the turn", async () => {
    writePool([account(0, { planType: "free" }), stamped(1)])
    const h = harness({ route: freePool("before-credits"), credits: { [seatId(1)]: PAYABLE }, respond: (token) => token === "at-0" ? usageLimit() : served() })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-0", "at-1"])
    expect(h.events[0]).toMatchObject({ seat: seatId(1), servedOnCredits: true })
  })

  it("after-credits: a seat on credits serves before the free seat, under either credits policy", async () => {
    for (const policy of ["immediately", "reserve"] as const) {
      writePool([account(0, { planType: "free" }), stamped(1)])
      const h = harness({ route: freePool("after-credits"), policy, credits: { [seatId(1)]: PAYABLE } })
      await drain(await h.turn())
      expect(h.calls).toEqual(["at-1"])
      expect(h.events[0]).toMatchObject({ seat: seatId(1), servedOnCredits: true })
    }
  })

  it("after-credits: the free seat serves once no seat can pay on credits", async () => {
    writePool([account(0, { planType: "free" }), stamped(1)])
    const h = harness({ route: freePool("after-credits"), credits: { [seatId(1)]: EMPTY } })
    const response = await h.turn()
    await drain(response)
    expect(response.status).toBe(200)
    expect(h.calls).toEqual(["at-0"])
  })

  it("after-credits: the free seat is still asked after a credits seat refuses", async () => {
    writePool([account(0, { planType: "free" }), stamped(1)])
    const h = harness({ route: freePool("after-credits"), credits: { [seatId(1)]: PAYABLE }, respond: (token) => token === "at-1" ? usageLimit() : served() })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-1", "at-0"])
  })

  it("serves a turn pinned to the free seat there", async () => {
    writePool([account(0, { planType: "free" }), account(1)])
    const h = harness({ route: { kind: "pinned", seat: seatId(0) } })
    await drain(await h.turn())
    expect(h.calls).toEqual(["at-0"])
  })
})

describe("credits from response headers", () => {
  it("reads the backend's Python-style booleans and decimal balance", () => {
    expect(chatGptCreditsFromHeaders(new Headers(creditHeaders(true, "62500")))).toEqual(
      { hasCredits: true, unlimited: false, overageLimitReached: false, balance: 62_500 })
  })

  it("treats an empty balance as unstated and needs both flags", () => {
    expect(chatGptCreditsFromHeaders(new Headers(creditHeaders(false, "")))?.balance).toBeNull()
    expect(chatGptCreditsFromHeaders(new Headers({ "x-codex-credits-has-credits": "True" }))).toBeNull()
    expect(chatGptCreditsFromHeaders(new Headers())).toBeNull()
  })

  it("pays only from a balance that is not known empty or capped", () => {
    expect(creditsCanServe(PAYABLE)).toBe(true)
    expect(creditsCanServe({ ...PAYABLE, balance: null })).toBe(true)
    expect(creditsCanServe({ ...EMPTY, unlimited: true })).toBe(true)
    expect(creditsCanServe(EMPTY)).toBe(false)
    expect(creditsCanServe({ ...PAYABLE, balance: 0 })).toBe(false)
    expect(creditsCanServe({ ...PAYABLE, overageLimitReached: true })).toBe(false)
    expect(creditsCanServe(null)).toBe(false)
  })
})
