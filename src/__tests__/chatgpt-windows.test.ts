/**
 * Task 8 - turning ChatGPT's usage windows into a bench-until instant.
 *
 * The failure this guards against is not arithmetic, it is reading the
 * payload's SHAPE as its meaning. `rate_limit` carries a `primary_window` and
 * a `secondary_window`, and the obvious reading - primary is the five-hour
 * one, secondary is the weekly one - is wrong on four of the operator's six
 * live accounts. Captured 2026-09-05 against all six, twice independently:
 *
 *   pro                          primary 604800 (weekly)  secondary null
 *   self_serve_business_prolite  primary 604800 (weekly)  secondary null
 *   team                         primary 18000  (5h)      secondary 604800
 *   free                         primary 2592000 (30d)    secondary null
 *
 * So width comes from `limit_window_seconds` and never from which key the
 * window arrived under. Every test below therefore states the width
 * explicitly and several place the same window under both keys.
 *
 * `reset_at` is epoch SECONDS. That is not an assumption: the reference
 * implementation multiplies it by 1000 (`lib/codex-usage.ts:193-199`) and
 * falls back to `reset_after_seconds` only when it is absent. Reading it as
 * milliseconds would bench every account until 1970 - which is to say, not at
 * all.
 */
import { describe, expect, it } from "bun:test"
import { chatGptCooldownCapMs, chatGptCooldownUntil, chatGptRateLimitFromHeaders } from "../proxy/chatgpt/windows"

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0)

const FIVE_HOUR = 18_000
const WEEKLY = 604_800
const THIRTY_DAY = 2_592_000

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** A window as the provider sends it: width in seconds, reset as epoch SECONDS. */
function window(opts: {
  width?: number
  usedPercent: number
  resetAtMs?: number
  resetAfterSeconds?: number
}) {
  return {
    used_percent: opts.usedPercent,
    ...(opts.width === undefined ? {} : { limit_window_seconds: opts.width }),
    ...(opts.resetAtMs === undefined ? {} : { reset_at: Math.floor(opts.resetAtMs / 1000) }),
    ...(opts.resetAfterSeconds === undefined ? {} : { reset_after_seconds: opts.resetAfterSeconds }),
  }
}

describe("chatGptCooldownUntil - width comes from the payload, never from the key", () => {
  it("benches to a spent five-hour window", () => {
    const resetAt = NOW + 4 * HOUR_MS
    const until = chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 100, resetAtMs: resetAt }),
      secondary_window: null,
    }, NOW)

    expect(until).toBe(resetAt)
  })

  it("benches to a spent weekly window that arrived as the PRIMARY one (pro, prolite)", () => {
    const resetAt = NOW + 5 * DAY_MS
    const until = chatGptCooldownUntil({
      primary_window: window({ width: WEEKLY, usedPercent: 100, resetAtMs: resetAt }),
      secondary_window: null,
    }, NOW)

    // Read positionally this would be capped as if it were a five-hour window,
    // resuming a still-capped account four and a half days early.
    expect(until).toBe(resetAt)
  })

  it("benches to a spent weekly window that arrived as the SECONDARY one (team)", () => {
    const resetAt = NOW + 5 * DAY_MS
    const until = chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 12 }),
      secondary_window: window({ width: WEEKLY, usedPercent: 100, resetAtMs: resetAt }),
    }, NOW)

    expect(until).toBe(resetAt)
  })

  it("gives the same answer whichever key a window arrives under", () => {
    const resetAt = NOW + 5 * DAY_MS
    const spent = window({ width: WEEKLY, usedPercent: 100, resetAtMs: resetAt })

    const asPrimary = chatGptCooldownUntil({ primary_window: spent, secondary_window: null }, NOW)
    const asSecondary = chatGptCooldownUntil({ primary_window: null, secondary_window: spent }, NOW)

    expect(asPrimary).toBe(resetAt)
    expect(asSecondary).toBe(asPrimary)
  })

  it("keeps a 30-day free-tier window at 30 days rather than collapsing it to weekly", () => {
    const resetAt = NOW + 21 * DAY_MS
    const until = chatGptCooldownUntil({
      primary_window: window({ width: THIRTY_DAY, usedPercent: 100, resetAtMs: resetAt }),
      secondary_window: null,
    }, NOW)

    // A rule of "anything at or past six days is weekly" caps this at ~8 days
    // and re-probes a spent account for a fortnight.
    expect(until).toBe(resetAt)
    expect(until! - NOW).toBeGreaterThan(8 * DAY_MS)
  })

  it("prefers the longest spent window when both are spent", () => {
    const fiveHourReset = NOW + 2 * HOUR_MS
    const weeklyReset = NOW + 3 * DAY_MS

    const until = chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 100, resetAtMs: fiveHourReset }),
      secondary_window: window({ width: WEEKLY, usedPercent: 100, resetAtMs: weeklyReset }),
    }, NOW)

    // Resuming at the five-hour reset would walk straight back into the
    // weekly cap - the account is unusable until the LONGER window rolls over.
    expect(until).toBe(weeklyReset)
  })
})

describe("chatGptCooldownUntil - only genuine exhaustion benches anything", () => {
  it("reports nothing for a healthy account carrying both windows", () => {
    expect(chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 41, resetAtMs: NOW + HOUR_MS }),
      secondary_window: window({ width: WEEKLY, usedPercent: 8, resetAtMs: NOW + 4 * DAY_MS }),
    }, NOW)).toBeNull()
  })

  it("treats 99 percent as not spent and 100 as spent", () => {
    const resetAt = NOW + HOUR_MS
    const at = (usedPercent: number) => chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent, resetAtMs: resetAt }),
    }, NOW)

    expect(at(99.9)).toBeNull()
    expect(at(100)).toBe(resetAt)
    expect(at(140)).toBe(resetAt)
  })

  it("does not invent a window from a top-level limit_reached", () => {
    // `limit_reached` says the account is capped but not by WHICH window, and
    // guessing means benching a five-hour problem for a week or the reverse.
    expect(chatGptCooldownUntil({
      allowed: false,
      limit_reached: true,
      primary_window: window({ width: FIVE_HOUR, usedPercent: 30, resetAtMs: NOW + HOUR_MS }),
      secondary_window: null,
    }, NOW)).toBeNull()
  })

  it("reports nothing when the payload is absent, empty or windowless", () => {
    expect(chatGptCooldownUntil(null, NOW)).toBeNull()
    expect(chatGptCooldownUntil(undefined, NOW)).toBeNull()
    expect(chatGptCooldownUntil({}, NOW)).toBeNull()
    expect(chatGptCooldownUntil({ primary_window: null, secondary_window: null }, NOW)).toBeNull()
  })

  it("reports nothing for a spent window that never says when it frees", () => {
    // Known spent, unknown reset. Returning `now` would resume immediately and
    // returning a guess would invent an observation; the caller's own
    // conservative default is the honest answer.
    expect(chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 100 }),
    }, NOW)).toBeNull()
  })
})

describe("chatGptCooldownUntil - reading the reset", () => {
  it("reads reset_at as epoch seconds", () => {
    const resetAt = NOW + 2 * HOUR_MS
    const until = chatGptCooldownUntil({
      primary_window: {
        used_percent: 100,
        limit_window_seconds: FIVE_HOUR,
        reset_at: Math.floor(resetAt / 1000),
      },
    }, NOW)

    expect(until).toBe(resetAt)
  })

  it("falls back to reset_after_seconds when reset_at is absent", () => {
    const until = chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 100, resetAfterSeconds: 1_800 }),
    }, NOW)

    expect(until).toBe(NOW + 1_800_000)
  })

  it("prefers reset_at over reset_after_seconds when both are present", () => {
    const resetAt = NOW + 2 * HOUR_MS
    const until = chatGptCooldownUntil({
      primary_window: window({
        width: FIVE_HOUR,
        usedPercent: 100,
        resetAtMs: resetAt,
        resetAfterSeconds: 60,
      }),
    }, NOW)

    expect(until).toBe(resetAt)
  })

  it("ignores a reset already in the past", () => {
    expect(chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 100, resetAtMs: NOW - HOUR_MS }),
    }, NOW)).toBeNull()
  })

  it("bounds an absurd reset by the window's OWN width", () => {
    const until = chatGptCooldownUntil({
      primary_window: window({ width: FIVE_HOUR, usedPercent: 100, resetAtMs: NOW + 400 * DAY_MS }),
    }, NOW)

    // One cap for every window would either flatten a 30-day reset or let a
    // five-hour one bench an account for a month.
    expect(until).toBe(NOW + chatGptCooldownCapMs(FIVE_HOUR))
    expect(until).toBe(NOW + 6 * HOUR_MS)
  })

  it("bounds each width differently, so a longer window keeps its longer cap", () => {
    expect(chatGptCooldownCapMs(FIVE_HOUR)).toBe(6 * HOUR_MS)
    expect(chatGptCooldownCapMs(WEEKLY)).toBeGreaterThan(7 * DAY_MS)
    expect(chatGptCooldownCapMs(THIRTY_DAY)).toBeGreaterThan(30 * DAY_MS)
    expect(chatGptCooldownCapMs(THIRTY_DAY)).toBeGreaterThan(chatGptCooldownCapMs(WEEKLY))
  })

  it("still bounds a spent window that reports no width at all", () => {
    const until = chatGptCooldownUntil({
      primary_window: { used_percent: 100, reset_at: Math.floor((NOW + 900 * DAY_MS) / 1000) },
    }, NOW)

    expect(until).not.toBeNull()
    expect(until! - NOW).toBeLessThanOrEqual(32 * DAY_MS)
    expect(until!).toBeGreaterThan(NOW)
  })
})

describe("chatGptCooldownUntil - the four live plan shapes", () => {
  const shapes = [
    { plan: "pro", primary: WEEKLY, secondary: null },
    { plan: "self_serve_business_prolite", primary: WEEKLY, secondary: null },
    { plan: "team", primary: FIVE_HOUR, secondary: WEEKLY },
    { plan: "free", primary: THIRTY_DAY, secondary: null },
  ] as const

  for (const shape of shapes) {
    it(`benches ${shape.plan} to its own widest spent window`, () => {
      const widest = Math.max(shape.primary, shape.secondary ?? 0)
      const resetAt = NOW + Math.floor(widest * 1000 * 0.5)

      const until = chatGptCooldownUntil({
        primary_window: window({
          width: shape.primary,
          usedPercent: shape.primary === widest ? 100 : 100,
          resetAtMs: shape.primary === widest ? resetAt : NOW + HOUR_MS,
        }),
        secondary_window: shape.secondary === null
          ? null
          : window({ width: shape.secondary, usedPercent: 100, resetAtMs: resetAt }),
      }, NOW)

      expect(until).toBe(resetAt)
    })
  }
})

/**
 * The same state, arriving on the headers of an ordinary inference response.
 *
 * Captured live 2026-09-05 from a 200 on `/backend-api/codex/responses`. It
 * means a seat can be benched from the response it just SERVED, rather than
 * from the next request it fails - which is the difference between one wasted
 * turn per spent account and none.
 *
 * THE UNIT IS DIFFERENT HERE. `/wham/usage` states a window's width in
 * SECONDS (`limit_window_seconds`); these headers state it in MINUTES. Read
 * one as the other and a weekly window becomes a 168-second one, so the
 * account is un-benched almost immediately and re-probed with a real failing
 * request for the rest of the week.
 */
describe("chatGptRateLimitFromHeaders - the same windows, in the other unit", () => {
  /** The pro account's real headers, minus the opaque turn state. */
  const LIVE = {
    "x-codex-plan-type": "pro",
    "x-codex-active-limit": "premium",
    "x-codex-primary-used-percent": "41",
    "x-codex-primary-window-minutes": "10080",
    "x-codex-primary-reset-at": "1789235170",
    "x-codex-primary-reset-after-seconds": "571307",
    "x-codex-primary-over-secondary-limit-percent": "0",
    "x-codex-secondary-used-percent": "0",
    "x-codex-secondary-window-minutes": "0",
    // PRESENT AND EMPTY on a single-window plan, which is not the same as
    // absent and very much not the same as zero: `Number("")` is 0, which
    // reads as a reset in 1970, which reads as an account that is free now.
    "x-codex-secondary-reset-at": "",
    "x-codex-secondary-reset-after-seconds": "0",
    "x-codex-bengalfox-limit-name": "GPT-5.3-Codex-Spark",
    "x-codex-bengalfox-primary-used-percent": "5",
    "x-codex-bengalfox-primary-window-minutes": "300",
    "x-codex-bengalfox-primary-reset-at": "1788676607",
    "x-codex-credits-balance": "0",
  }

  it("reads the primary window, converting minutes to the seconds the rest of this module speaks", () => {
    const limits = chatGptRateLimitFromHeaders(new Headers(LIVE))

    expect(limits?.primary_window).toEqual({
      used_percent: 41,
      limit_window_seconds: WEEKLY,
      reset_at: 1_789_235_170,
    })
  })

  it("does not mistake a window's MINUTES for its seconds", () => {
    // 300 minutes is the five-hour window. Read as 300 seconds it would be
    // capped at an hour, so a spent 5h window would be re-probed 4 hours early.
    const limits = chatGptRateLimitFromHeaders(new Headers({
      "x-codex-primary-used-percent": "100",
      "x-codex-primary-window-minutes": "300",
      "x-codex-primary-reset-at": String(Math.floor((NOW + 4 * HOUR_MS) / 1000)),
    }))

    expect(limits?.primary_window?.limit_window_seconds).toBe(FIVE_HOUR)
    expect(chatGptCooldownUntil(limits, NOW)).toBe(NOW + 4 * HOUR_MS)
  })

  it("omits a window the plan does not have rather than inventing one at epoch 0", () => {
    const limits = chatGptRateLimitFromHeaders(new Headers(LIVE))

    // Zero width means DISABLED. Carrying it through as a window whose reset
    // is in the past would make every account look permanently available.
    expect(limits?.secondary_window ?? null).toBeNull()
    expect(chatGptCooldownUntil(limits, NOW)).toBeNull()
  })

  it("does not read an empty header as the number zero", () => {
    // `Number("")` is 0, and 0 is a perfectly plausible used-percent - so an
    // empty header recorded as `used_percent: 0` is a claim the provider never
    // made. It reported NOTHING about this window, which is not the same as
    // reporting that none of it is gone.
    const resetAt = Math.floor((NOW + DAY_MS) / 1000)
    const limits = chatGptRateLimitFromHeaders(new Headers({
      "x-codex-primary-used-percent": "",
      "x-codex-primary-window-minutes": "10080",
      "x-codex-primary-reset-at": String(resetAt),
    }))

    expect(limits?.primary_window).toEqual({ limit_window_seconds: WEEKLY, reset_at: resetAt })
    expect(chatGptCooldownUntil(limits, NOW)).toBeNull()
  })

  it("benches from a response that SUCCEEDED, once its primary window is spent", () => {
    const resetAt = NOW + 3 * DAY_MS
    const limits = chatGptRateLimitFromHeaders(new Headers({
      ...LIVE,
      "x-codex-primary-used-percent": "100",
      "x-codex-primary-reset-at": String(Math.floor(resetAt / 1000)),
    }))

    expect(chatGptCooldownUntil(limits, NOW)).toBe(resetAt)
  })

  it("ignores the bengalfox limit, which is a different allowance entirely", () => {
    // GPT-5.3-Codex-Spark has its own primary AND secondary windows. An
    // account spent there can still serve everything else, so benching the
    // SEAT for it would sideline a usable account.
    const limits = chatGptRateLimitFromHeaders(new Headers({
      ...LIVE,
      "x-codex-bengalfox-primary-used-percent": "100",
      "x-codex-bengalfox-primary-reset-at": String(Math.floor((NOW + DAY_MS) / 1000)),
      "x-codex-bengalfox-secondary-used-percent": "100",
      "x-codex-bengalfox-secondary-window-minutes": "10080",
      "x-codex-bengalfox-secondary-reset-at": String(Math.floor((NOW + 5 * DAY_MS) / 1000)),
    }))

    expect(limits?.primary_window?.used_percent).toBe(41)
    expect(chatGptCooldownUntil(limits, NOW)).toBeNull()
  })

  it("falls back to the relative reset when no absolute one is given", () => {
    const limits = chatGptRateLimitFromHeaders(new Headers({
      "x-codex-primary-used-percent": "100",
      "x-codex-primary-window-minutes": "10080",
      "x-codex-primary-reset-after-seconds": "3600",
    }))

    expect(chatGptCooldownUntil(limits, NOW)).toBe(NOW + HOUR_MS)
  })

  it("reports nothing at all for a response that carries no limit headers", () => {
    expect(chatGptRateLimitFromHeaders(new Headers())).toBeNull()
    expect(chatGptRateLimitFromHeaders(new Headers({ "content-type": "text/event-stream" }))).toBeNull()
  })

  it("ignores a malformed number rather than benching on it", () => {
    const limits = chatGptRateLimitFromHeaders(new Headers({
      "x-codex-primary-used-percent": "not-a-number",
      "x-codex-primary-window-minutes": "10080",
      "x-codex-primary-reset-at": String(Math.floor((NOW + DAY_MS) / 1000)),
    }))

    expect(chatGptCooldownUntil(limits, NOW)).toBeNull()
  })
})
