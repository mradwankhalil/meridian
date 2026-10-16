import { describe, expect, it } from "bun:test"
import { chatGptVerdict, combineBackendVerdicts, type ChatGptSeatCounts } from "../proxy/chatgpt/health"

const POOL: ChatGptSeatCounts = { mode: "owned", serving: true, accounts: 3, eligible: 3, ready: 3, unavailable: {} }

describe("chatGptVerdict", () => {
  it("is healthy while any seat can take a turn", () => {
    expect(chatGptVerdict({ ...POOL, eligible: 1, ready: 1, unavailable: { requires_reauth: 2 } })).toEqual({ status: "healthy" })
  })

  it("is unhealthy when the instance cannot serve from its store", () => {
    expect(chatGptVerdict({ ...POOL, serving: false })).toMatchObject({ status: "unhealthy", error: expect.stringContaining("refresh authority") })
    expect(chatGptVerdict({ ...POOL, mode: "follow-external", serving: false })).toMatchObject({ status: "unhealthy", error: expect.stringContaining("could not be read") })
  })

  it("is unhealthy with no account connected", () => {
    expect(chatGptVerdict({ ...POOL, accounts: 0, eligible: 0, ready: 0 })).toMatchObject({ status: "unhealthy", error: expect.stringContaining("/profiles") })
  })

  it("is unhealthy when every seat needs a person to sign in", () => {
    const verdict = chatGptVerdict({ ...POOL, eligible: 0, ready: 0, unavailable: { requires_reauth: 3 } })
    expect(verdict.status).toBe("unhealthy")
    expect(verdict.error).toContain("3 needing sign-in")
  })

  it("is degraded when every seat is waiting out a limit it recovers from", () => {
    const benched = chatGptVerdict({ ...POOL, ready: 0, nextSeatFreeAt: "2026-10-03T10:00:00.000Z" })
    expect(benched.status).toBe("degraded")
    expect(benched.error).toContain("3 rate-limited")
    expect(benched.error).toContain("2026-10-03T10:00:00.000Z")
    const cooling = chatGptVerdict({ ...POOL, eligible: 0, ready: 0, unavailable: { cooling_down: 1, requires_reauth: 2 } })
    expect(cooling.status).toBe("degraded")
    expect(cooling.error).toContain("1 cooling down, 2 needing sign-in")
  })
})

describe("combineBackendVerdicts", () => {
  it("reports a single backend exactly as it is", () => {
    expect(combineBackendVerdicts({ chatgpt: { status: "healthy" } })).toEqual({ status: "healthy" })
    expect(combineBackendVerdicts({ claude: { status: "degraded", error: "x" } })).toEqual({ status: "degraded", error: "x" })
  })

  it("is degraded when one of two backends cannot serve, naming which", () => {
    expect(combineBackendVerdicts({
      claude: { status: "unhealthy", error: "Not logged in." },
      chatgpt: { status: "healthy" },
    })).toEqual({ status: "degraded", error: "Claude: Not logged in." })
  })

  it("is healthy only when both are, and down only when neither can serve", () => {
    expect(combineBackendVerdicts({ claude: { status: "healthy" }, chatgpt: { status: "healthy" } }).status).toBe("healthy")
    expect(combineBackendVerdicts({
      claude: { status: "unhealthy", error: "a" },
      chatgpt: { status: "unhealthy", error: "b" },
    })).toEqual({ status: "unhealthy", error: "Claude: a ChatGPT: b" })
  })
})
