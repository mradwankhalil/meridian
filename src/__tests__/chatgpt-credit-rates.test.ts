/**
 * Codex credits: the rate card, and the pace this instance burns them at.
 */
import { describe, expect, it } from "bun:test"
import {
  BURN_MIN_TURNS,
  CODEX_CREDIT_RATE_CARD,
  codexCreditRate,
  creditBurn,
  rateCardDisagreements,
  turnCredits,
} from "../proxy/chatgpt/creditRates"

const NOW = Date.parse("2026-10-01T12:00:00Z")
const MIN = 60_000

function turn(model: string, minutesAgo: number, tokens: { input?: number; cached?: number; output?: number } = {}) {
  return {
    timestamp: NOW - minutesAgo * MIN,
    model,
    inputTokens: tokens.input ?? 0,
    cacheReadInputTokens: tokens.cached ?? 0,
    outputTokens: tokens.output ?? 0,
  }
}

describe("credits rate card", () => {
  it("prices a turn with uncached input, cached input and output at their own rates", () => {
    const rate = codexCreditRate("gpt-6-sol", NOW)
    expect(rate).toMatchObject({ ok: true, source: "rate_card", rate: { input: 50, cachedInput: 5, output: 250 }, approximate: null })
    if (!rate.ok) throw new Error("unreachable")
    // 1M uncached at 50, 1M cached at 5, 1M out at 250.
    expect(turnCredits({ uncachedInput: 1_000_000, cachedInput: 1_000_000, output: 1_000_000 }, rate.rate)).toBe(305)
    // A cache hit costs a tenth of a miss.
    expect(turnCredits({ uncachedInput: 0, cachedInput: 200_000, output: 0 }, rate.rate)).toBe(1)
    expect(turnCredits({ uncachedInput: 200_000, cachedInput: 0, output: 0 }, rate.rate)).toBe(10)
  })

  it("finds a served snapshot under its base slug", () => {
    expect(codexCreditRate("gpt-6-luna-2026-09-01", NOW)).toMatchObject({ ok: true, rate: { input: 2.5, cachedInput: 0.25, output: 12.5 } })
  })

  it("agrees with the USD API price / $0.04 on every row whose USD price is known", () => {
    expect(rateCardDisagreements()).toEqual([])
    expect(CODEX_CREDIT_RATE_CARD.find(row => row.slug === "gpt-6.1-sol")).toMatchObject({ input: 50, cachedInput: 2.5, output: 250 })
  })

  it("marks GPT-5.6 Sol's promotional rate approximate, and has no rate for it once the promotion ends", () => {
    const promo = codexCreditRate("gpt-5.6-sol", NOW)
    expect(promo).toMatchObject({ ok: true, rate: { input: 100, cachedInput: 10, output: 500 } })
    expect(promo.ok && promo.approximate).toContain("promotional")
    expect(codexCreditRate("gpt-5.6-sol", Date.parse("2026-11-21T23:59:00Z")).ok).toBe(true)
    expect(codexCreditRate("gpt-5.6-sol", Date.parse("2026-11-22T00:00:00Z"))).toEqual({ ok: false, reason: "rate_expired" })
    expect(codexCreditRate("gpt-daybreak-blue-latest", Date.parse("2026-12-01T00:00:00Z"))).toEqual({ ok: false, reason: "rate_expired" })
  })

  it("falls back to the USD API price / $0.04 for an unlisted model, marked approximate", () => {
    const fallback = codexCreditRate("gpt-5.4-mini", NOW)
    expect(fallback).toMatchObject({ ok: true, source: "usd_fallback" })
    if (!fallback.ok) throw new Error("unreachable")
    expect(fallback.rate.input).toBeCloseTo(18.75)
    expect(fallback.rate.cachedInput).toBeCloseTo(1.875)
    expect(fallback.rate.output).toBeCloseTo(112.5)
    expect(fallback.approximate).toContain("not on the credits rate card")
  })

  it("has no rate for a model neither source knows", () => {
    expect(codexCreditRate("gpt-9-mystery", NOW)).toEqual({ ok: false, reason: "unknown_model" })
  })
})

describe("credits burn rate", () => {
  it("is idle with no turn in the last hour", () => {
    expect(creditBurn([], NOW)).toEqual({ status: "idle", windowMinutes: 60 })
    expect(creditBurn([turn("gpt-6-sol", 90, { output: 1000 })], NOW)).toEqual({ status: "idle", windowMinutes: 60 })
    // A turn that carried no tokens (a refusal) is not traffic.
    expect(creditBurn([turn("gpt-6-sol", 5)], NOW).status).toBe("idle")
  })

  it("divides the hour's credits by the whole hour, across every seat's turns", () => {
    const turns = Array.from({ length: BURN_MIN_TURNS }, (_, i) => turn("gpt-6-sol", 10 + i, { output: 200_000 }))
    // 5 turns x 200k output x 250/1M = 250 credits over 60 minutes.
    expect(creditBurn(turns, NOW)).toMatchObject({ status: "burning", creditsPerHour: 250, windowMinutes: 60, turns: 5, approximate: [] })
  })

  it("widens a sparse hour to three hours, so one large turn does not set the pace", () => {
    const turns = [turn("gpt-6-sol", 10, { output: 1_200_000 }), turn("gpt-6-sol", 150, { output: 1_200_000 }), turn("gpt-6-sol", 200, { output: 1_200_000 })]
    // Under 5 turns in the hour: the 3h window holds 2 (200 min is outside), 2 x 300 credits / 3h.
    expect(creditBurn(turns, NOW)).toMatchObject({ status: "burning", creditsPerHour: 200, windowMinutes: 180, turns: 2 })
  })

  it("states the model mix by tokens", () => {
    const turns = [
      ...Array.from({ length: 3 }, (_, i) => turn("gpt-6-sol", i + 1, { input: 620 })),
      ...Array.from({ length: 2 }, (_, i) => turn("gpt-6-luna", i + 5, { input: 570 })),
    ]
    const burn = creditBurn(turns, NOW)
    if (burn.status !== "burning") throw new Error(burn.status)
    expect(burn.mix.map(m => [m.model, Math.round(m.share * 100)])).toEqual([["gpt-6-sol", 62], ["gpt-6-luna", 38]])
  })

  it("gives no rate while a model without one is in the window, and reports it once per call", () => {
    const seen: string[] = []
    const turns = [turn("gpt-6-sol", 1, { output: 10 }), turn("gpt-9-mystery", 2, { output: 10 }), turn("gpt-9-mystery", 3, { output: 10 })]
    expect(creditBurn(turns, NOW, model => seen.push(model))).toEqual({ status: "unknown_rate", windowMinutes: 180, models: ["gpt-9-mystery"] })
    expect(seen).toEqual(["gpt-9-mystery"])
  })

  it("carries the promotion's caveat into the rate", () => {
    const turns = Array.from({ length: 5 }, (_, i) => turn("gpt-5.6-sol", i + 1, { output: 1000 }))
    const burn = creditBurn(turns, NOW)
    expect(burn.status === "burning" && burn.approximate[0]).toContain("promotional")
  })
})
