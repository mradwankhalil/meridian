/**
 * Codex rate-limit window shaping.
 *
 * The window vocabulary deliberately mirrors `OAuthUsageWindow` in
 * `../oauthUsage`: `utilization` is a 0..1 consumed fraction and `resetsAt` is
 * epoch milliseconds, so the dashboard can render a Codex window with the same
 * helpers it already uses for a Claude one. `limitWindowSeconds` is the one
 * addition — the vendor declares the window's width, and everything here is
 * derived from it rather than from the field's position in the payload.
 *
 * That matters: `pro` and the business-premium seat report the weekly limit as
 * `primary_window` with `secondary_window` null, while `team` accounts still
 * use the older 5h-primary/weekly-secondary shape. Reading "primary" as "the
 * 5h window" is wrong on more accounts than it is right.
 *
 * This is a leaf module: pure functions, no I/O, types only.
 */

import type { CodexUsageWindow } from "./types"

const HOUR_SECONDS = 3600
const DAY_SECONDS = 86400

/**
 * Name a window from its declared width.
 *
 * Widths are labelled in their natural unit rather than bucketed into
 * "weekly"/"session". The free tier's window is 2592000s — thirty days — and
 * any rule that collapses every multi-day window onto a weekly label misstates
 * that allowance by more than fourfold.
 */
export function codexWindowLabel(limitWindowSeconds: number | null | undefined): string {
  if (typeof limitWindowSeconds !== "number") return "usage"
  if (!Number.isFinite(limitWindowSeconds) || limitWindowSeconds <= 0) return "usage"
  if (limitWindowSeconds >= DAY_SECONDS) return `${Math.round(limitWindowSeconds / DAY_SECONDS)}d`
  if (limitWindowSeconds >= HOUR_SECONDS) return `${Math.round(limitWindowSeconds / HOUR_SECONDS)}h`
  return `${Math.max(1, Math.round(limitWindowSeconds / 60))}m`
}

/**
 * Choose the window that represents the account's headline allowance.
 *
 * The widest window is the subscription allowance; narrower ones are burst
 * limits inside it. Ties keep the earlier entry, so a payload that declares no
 * widths at all still yields its first window rather than nothing.
 */
export function pickHeadlineWindow(windows: readonly CodexUsageWindow[]): CodexUsageWindow | null {
  let headline: CodexUsageWindow | null = null
  let widest = Number.NEGATIVE_INFINITY
  for (const window of windows) {
    const width = typeof window.limitWindowSeconds === "number" && Number.isFinite(window.limitWindowSeconds)
      ? window.limitWindowSeconds
      : -1
    if (headline === null || width > widest) {
      headline = window
      widest = width
    }
  }
  return headline
}
