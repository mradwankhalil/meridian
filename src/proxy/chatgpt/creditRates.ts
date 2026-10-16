/**
 * What a ChatGPT turn costs in Codex credits, and how fast this instance is
 * burning them.
 *
 * Source: OpenAI Help Center, "ChatGPT Rate Card (Business, Enterprise/Edu
 * credit-based pricing)", section "ChatGPT Work and Codex", Standard mode
 * https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing
 * read 2026-09-30. Plus and Pro credits use the same table: the personal-plan
 * credits article (https://help.openai.com/en/articles/12642688) points to it
 * for Codex rates and has no table of its own.
 *
 * What the page does not settle, and how it is handled:
 * - GPT-5.6 Sol's rate is promotional "at least through Nov 21, 2026", and no
 *   regular rate is published. After that date the model has no rate, so no
 *   estimate is shown. Daybreak Blue "uses the GPT-5.6 Sol rates" and follows.
 * - The promotion "applies to eligible usage paid for with purchased
 *   credits"; whether granted credits get it is not stated, so an estimate
 *   priced on it is marked approximate.
 * - Fast mode is billed at 2x and Ultrafast at 6x. A turn's telemetry does
 *   not say which mode served it, so Standard is assumed.
 * - The rates have no long-context tier, unlike the USD API prices.
 *
 * Most rows equal the USD API price divided by $0.04 per credit. That is used
 * as a cross-check (tests) and as the fallback for a model the card does not
 * list; never to override a listed row.
 */
import { OPENAI_MODEL_PRICING } from "../../telemetry/openaiPricingData"
import type { RequestMetric } from "../../telemetry/types"

/** Credits per 1M tokens. */
export interface CreditRate {
  input: number
  cachedInput: number
  output: number
}

export interface CreditRateRow extends CreditRate {
  /** The rate card's own name for the row. */
  name: string
  /** The Codex slug the row prices; null for a row this gateway never serves. */
  slug: string | null
  /** The slug is an inference, not something the backend's catalog listed. */
  slugInferred?: boolean
  /** Epoch ms after which this rate no longer applies. */
  validUntil?: number
  /** The rate once `validUntil` has passed; null = not published. */
  afterValidUntil?: CreditRate | null
  /** Why an estimate priced on this row is approximate. */
  approximate?: string
}

const SOL_PROMO_UNTIL = Date.parse("2026-11-22T00:00:00Z")
const SOL_PROMO_NOTE = "GPT-5.6 Sol promotional rate; the rate card applies it to purchased credits and does not say whether granted credits get it"

export const CODEX_CREDIT_RATE_CARD: readonly CreditRateRow[] = [
  { name: "GPT-6 Astra", slug: "gpt-6-astra", input: 250, cachedInput: 25, output: 1250 },
  { name: "GPT-6.1 Sol", slug: "gpt-6.1-sol", slugInferred: true, input: 50, cachedInput: 2.5, output: 250 },
  { name: "GPT-6 Sol", slug: "gpt-6-sol", input: 50, cachedInput: 5, output: 250 },
  { name: "GPT-6 Luna", slug: "gpt-6-luna", input: 2.5, cachedInput: 0.25, output: 12.5 },
  {
    name: "GPT-5.6 Sol", slug: "gpt-5.6-sol", input: 100, cachedInput: 10, output: 500,
    validUntil: SOL_PROMO_UNTIL, afterValidUntil: null, approximate: SOL_PROMO_NOTE,
  },
  { name: "GPT-5.6 Terra", slug: "gpt-5.6-terra", input: 50, cachedInput: 5, output: 300 },
  { name: "GPT-5.6 Luna", slug: "gpt-5.6-luna", input: 5, cachedInput: 0.5, output: 30 },
  { name: "GPT-Rosalind-Research", slug: "gpt-rosalind-research", slugInferred: true, input: 125, cachedInput: 12.5, output: 625 },
  { name: "GPT-5.5", slug: "gpt-5.5", input: 125, cachedInput: 12.5, output: 750 },
  {
    name: "Daybreak Blue (GPT-5.6 Sol)", slug: "gpt-daybreak-blue-latest", input: 100, cachedInput: 10, output: 500,
    validUntil: SOL_PROMO_UNTIL, afterValidUntil: null, approximate: SOL_PROMO_NOTE,
  },
  { name: "Daybreak Red", slug: "gpt-daybreak-red-latest", slugInferred: true, input: 312.5, cachedInput: 31.25, output: 1875 },
  { name: "GPT-5.3-Codex", slug: "gpt-5.3-codex", input: 43.75, cachedInput: 4.375, output: 350 },
  { name: "GPT-5.2", slug: "gpt-5.2", input: 43.75, cachedInput: 4.375, output: 350 },
  // Image generation is not a Responses turn on this gateway, so no slug.
  { name: "GPT-Image-2 (image)", slug: null, input: 200, cachedInput: 50, output: 750 },
  { name: "GPT-Image-2 (text)", slug: null, input: 125, cachedInput: 31.25, output: 250 },
  { name: "GPT-6 Astra Law", slug: "gpt-6-astra-law", slugInferred: true, input: 312.5, cachedInput: 31.25, output: 1562.5 },
]

/** USD per credit implied by the rate card: most rows are the API price / this. */
export const USD_PER_CREDIT = 0.04

export type CreditRateLookup =
  | { ok: true; rate: CreditRate; source: "rate_card" | "usd_fallback"; approximate: string | null }
  | { ok: false; reason: "unknown_model" | "rate_expired" }

/** A dated snapshot suffix the backend may report on a served model, e.g. `-2026-09-01`. */
const SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/

export function codexCreditRate(model: string, at: number): CreditRateLookup {
  const slug = model.trim().toLowerCase()
  const candidates = SNAPSHOT_SUFFIX.test(slug) ? [slug, slug.replace(SNAPSHOT_SUFFIX, "")] : [slug]
  for (const candidate of candidates) {
    const row = CODEX_CREDIT_RATE_CARD.find(entry => entry.slug === candidate)
    if (row) {
      if (row.validUntil !== undefined && at >= row.validUntil) {
        return row.afterValidUntil
          ? { ok: true, rate: row.afterValidUntil, source: "rate_card", approximate: null }
          : { ok: false, reason: "rate_expired" }
      }
      return { ok: true, rate: { input: row.input, cachedInput: row.cachedInput, output: row.output }, source: "rate_card", approximate: row.approximate ?? null }
    }
  }
  for (const candidate of candidates) {
    const usd = OPENAI_MODEL_PRICING[candidate]
    if (usd) {
      return {
        ok: true,
        rate: { input: usd.inputPerMTok / USD_PER_CREDIT, cachedInput: usd.cacheReadPerMTok / USD_PER_CREDIT, output: usd.outputPerMTok / USD_PER_CREDIT },
        source: "usd_fallback",
        approximate: "not on the credits rate card; priced as its USD API rate / $0.04",
      }
    }
  }
  return { ok: false, reason: "unknown_model" }
}

/** Rows whose rate differs from the USD API price / $0.04, where that price is known. */
export function rateCardDisagreements(): Array<{ slug: string; card: CreditRate; usd: CreditRate }> {
  const out: Array<{ slug: string; card: CreditRate; usd: CreditRate }> = []
  for (const row of CODEX_CREDIT_RATE_CARD) {
    const usd = row.slug ? OPENAI_MODEL_PRICING[row.slug] : undefined
    if (!row.slug || !usd) continue
    const implied = { input: usd.inputPerMTok / USD_PER_CREDIT, cachedInput: usd.cacheReadPerMTok / USD_PER_CREDIT, output: usd.outputPerMTok / USD_PER_CREDIT }
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-9 * Math.max(1, a)
    if (!same(row.input, implied.input) || !same(row.cachedInput, implied.cachedInput) || !same(row.output, implied.output)) {
      out.push({ slug: row.slug, card: { input: row.input, cachedInput: row.cachedInput, output: row.output }, usd: implied })
    }
  }
  return out
}

/**
 * The credits one turn costs. `uncachedInput` excludes the cached tokens, as
 * Meridian's telemetry records them; reasoning is already inside `output`.
 */
export function turnCredits(tokens: { uncachedInput: number; cachedInput: number; output: number }, rate: CreditRate): number {
  return (tokens.uncachedInput * rate.input + tokens.cachedInput * rate.cachedInput + tokens.output * rate.output) / 1_000_000
}

export const BURN_WINDOW_MS = 60 * 60_000
export const BURN_SPARSE_WINDOW_MS = 3 * 60 * 60_000
export const BURN_MIN_TURNS = 5

export type CreditBurn =
  | { status: "idle"; windowMinutes: number }
  | { status: "unknown_rate"; windowMinutes: number; models: string[] }
  | {
    status: "burning"
    creditsPerHour: number
    windowMinutes: number
    turns: number
    /** Share of the window's tokens per model, largest first. */
    mix: Array<{ model: string; share: number }>
    /** Why the rate is approximate; empty when every turn was priced from the card at a firm rate. */
    approximate: string[]
  }

/**
 * The pace credits would be spent at, from this instance's own ChatGPT turns.
 *
 * Every turn counts, whichever seat served it and whether it was paid by the
 * plan or by credits: the question is how long a balance would last if it had
 * to pay for the traffic this instance carries.
 *
 * The rate is credits in the window divided by the WHOLE window, not by the
 * time traffic was active, so a burst raises it gradually and a pause lowers
 * it gradually instead of the estimate jumping between turns. The window is
 * the last hour; when that hour holds fewer than MIN_TURNS turns, one large
 * turn would dominate it, so the last three hours are used instead. No turn at
 * all in the last hour is `idle`: nothing is burning now.
 */
export function creditBurn(
  metrics: readonly Pick<RequestMetric, "timestamp" | "model" | "inputTokens" | "cacheReadInputTokens" | "outputTokens">[],
  now: number,
  onUnknownModel: (model: string, reason: "unknown_model" | "rate_expired") => void = () => {},
): CreditBurn {
  const withTokens = metrics.filter(metric => (metric.inputTokens ?? 0) + (metric.cacheReadInputTokens ?? 0) + (metric.outputTokens ?? 0) > 0)
  const inWindow = (windowMs: number) => withTokens.filter(metric => metric.timestamp > now - windowMs && metric.timestamp <= now)
  const recent = inWindow(BURN_WINDOW_MS)
  if (recent.length === 0) return { status: "idle", windowMinutes: BURN_WINDOW_MS / 60_000 }
  const windowMs = recent.length < BURN_MIN_TURNS ? BURN_SPARSE_WINDOW_MS : BURN_WINDOW_MS
  const turns = windowMs === BURN_WINDOW_MS ? recent : inWindow(windowMs)

  let credits = 0
  let totalTokens = 0
  const tokensByModel = new Map<string, number>()
  const unknown = new Set<string>()
  const approximate = new Set<string>()
  for (const metric of turns) {
    const tokens = { uncachedInput: metric.inputTokens ?? 0, cachedInput: metric.cacheReadInputTokens ?? 0, output: metric.outputTokens ?? 0 }
    const count = tokens.uncachedInput + tokens.cachedInput + tokens.output
    tokensByModel.set(metric.model, (tokensByModel.get(metric.model) ?? 0) + count)
    totalTokens += count
    const rate = codexCreditRate(metric.model, metric.timestamp)
    if (!rate.ok) {
      if (!unknown.has(metric.model)) onUnknownModel(metric.model, rate.reason)
      unknown.add(metric.model)
      continue
    }
    if (rate.approximate) approximate.add(rate.approximate)
    credits += turnCredits(tokens, rate.rate)
  }
  const windowMinutes = windowMs / 60_000
  // A model without a rate leaves part of the traffic unpriced; any number
  // shown would be too low by an unknown amount.
  if (unknown.size > 0) return { status: "unknown_rate", windowMinutes, models: [...unknown].sort() }
  const mix = [...tokensByModel].map(([model, count]) => ({ model, share: totalTokens > 0 ? count / totalTokens : 0 }))
    .sort((a, b) => b.share - a.share)
  return { status: "burning", creditsPerHour: credits / (windowMs / 3_600_000), windowMinutes, turns: turns.length, mix, approximate: [...approximate] }
}
