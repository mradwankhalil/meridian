/**
 * Unit tests for Codex rate-limit window labelling and headline selection.
 *
 * Two facts drive this module, both verified against six live accounts:
 *
 * 1. `limit_window_seconds` takes at least three values in the wild — 18000
 *    (5h), 604800 (weekly) and 2592000 (30-day, on the free tier). The
 *    reference implementation in ai-api-usage-tracker labels anything
 *    `>= 6 * 86400` as "Weekly", which silently mislabels the 30-day window.
 *    That bug is pinned against here.
 *
 * 2. The window layout varies per account. `pro` and the business-premium seat
 *    report the weekly limit as `primary_window` with `secondary_window` null,
 *    while both `team` accounts still use the older 5h-primary/weekly-secondary
 *    shape. So the headline allowance must be chosen by window WIDTH, never by
 *    position in the payload.
 */
import { describe, test, expect } from "bun:test"
import { codexWindowLabel, pickHeadlineWindow } from "../proxy/codex/windows"

describe("codexWindowLabel", () => {
  test("labels the three widths observed on real accounts", () => {
    expect(codexWindowLabel(18000)).toBe("5h")
    expect(codexWindowLabel(604800)).toBe("7d")
    // The free tier's window is 30 days. Labelling it "7d" would misstate the
    // allowance by more than 4x.
    expect(codexWindowLabel(2592000)).toBe("30d")
  })

  test("does not collapse every multi-day window onto a weekly label", () => {
    expect(codexWindowLabel(2592000)).not.toBe("7d")
    expect(codexWindowLabel(1209600)).toBe("14d")
  })

  test("falls back to generic units for unfamiliar widths", () => {
    expect(codexWindowLabel(3600)).toBe("1h")
    expect(codexWindowLabel(1800)).toBe("30m")
    expect(codexWindowLabel(60)).toBe("1m")
  })

  test("renders a neutral label when the width is missing or nonsensical", () => {
    expect(codexWindowLabel(null)).toBe("usage")
    expect(codexWindowLabel(undefined)).toBe("usage")
    expect(codexWindowLabel(0)).toBe("usage")
    expect(codexWindowLabel(-1)).toBe("usage")
    expect(codexWindowLabel(Number.NaN)).toBe("usage")
    expect(codexWindowLabel(Number.POSITIVE_INFINITY)).toBe("usage")
  })
})

describe("pickHeadlineWindow", () => {
  const fiveHour = { type: "5h", utilization: 0, resetsAt: 1, limitWindowSeconds: 18000 }
  const weekly = { type: "7d", utilization: 1, resetsAt: 2, limitWindowSeconds: 604800 }
  const monthly = { type: "30d", utilization: 1, resetsAt: 3, limitWindowSeconds: 2592000 }

  test("picks the widest window, not the first one", () => {
    // A `team` account reports 5h first and weekly second; the weekly limit is
    // the subscription allowance and must be what the card leads with.
    expect(pickHeadlineWindow([fiveHour, weekly])).toBe(weekly)
    expect(pickHeadlineWindow([weekly, fiveHour])).toBe(weekly)
  })

  test("prefers a 30-day window over a weekly one", () => {
    expect(pickHeadlineWindow([weekly, monthly])).toBe(monthly)
  })

  test("handles a single window and an empty list", () => {
    expect(pickHeadlineWindow([weekly])).toBe(weekly)
    expect(pickHeadlineWindow([])).toBeNull()
  })

  test("still returns something when no window declares a width", () => {
    const widthless = { type: "usage", utilization: 0.5, resetsAt: null, limitWindowSeconds: null }
    expect(pickHeadlineWindow([widthless])).toBe(widthless)
  })
})
