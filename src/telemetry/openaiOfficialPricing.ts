/**
 * Official OpenAI list prices, maintained by hand (PURE, no I/O).
 *
 * This is the final guard for scripts/update-openai-pricing.ts: the generated
 * table comes from community catalogs (models.dev, LiteLLM), and the update
 * fails instead of opening a PR when either catalog disagrees with a rate
 * listed here. When OpenAI changes a list price, update this file by hand from
 * the official pages below; the next update run then accepts the new rate.
 *
 * Sources (snapshot 2026-09-27; gpt-6.1-sol and long-context rates added
 * 2026-09-29):
 *   - developers.openai.com/api/docs/pricing
 *   - help.openai.com/en/articles/20001106-codex-rate-card
 *
 * Rates are USD per million tokens: uncached input, cached input, output.
 * `longContext` is the pricing page's "Long context" column, which applies to
 * the whole request once its prompt is over 272K input tokens (see
 * ContextTierPricing in pricing.ts).
 */

export interface OfficialOpenAiRateSet {
  input: number
  cachedInput: number
  output: number
}

export interface OfficialOpenAiRates extends OfficialOpenAiRateSet {
  longContext?: OfficialOpenAiRateSet & { aboveInputTokens: number }
}

const LONG_CONTEXT_ABOVE = 272_000

export const OFFICIAL_OPENAI_PRICING: Record<string, OfficialOpenAiRates> = {
  "gpt-6.1-sol": { input: 2, cachedInput: 0.1, output: 10, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 4, cachedInput: 0.2, output: 15 } },
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 20, cachedInput: 2, output: 75 } },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 4, cachedInput: 0.4, output: 15 } },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 0.2, cachedInput: 0.02, output: 0.75 } },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 8, cachedInput: 0.8, output: 30 } },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 4, cachedInput: 0.4, output: 18 } },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 0.4, cachedInput: 0.04, output: 1.8 } },
  "gpt-5.5": { input: 5, cachedInput: 0.5, output: 30, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 10, cachedInput: 1, output: 45 } },
  "gpt-5.4": { input: 2.5, cachedInput: 0.25, output: 15, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 5, cachedInput: 0.5, output: 22.5 } },
  "gpt-5.4-mini": { input: 0.75, cachedInput: 0.075, output: 4.5 },
  "gpt-5.3-codex": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.2": { input: 1.75, cachedInput: 0.175, output: 14 },
  "gpt-5.6-cyber": { input: 12.5, cachedInput: 1.25, output: 75 },
  // Daybreak aliases point at gpt-5.6-sol (blue) and gpt-5.6-cyber (red) and
  // are repriced when OpenAI moves them to a newer model.
  "gpt-daybreak-blue-latest": { input: 4, cachedInput: 0.4, output: 20, longContext: { aboveInputTokens: LONG_CONTEXT_ABOVE, input: 8, cachedInput: 0.8, output: 30 } },
  "gpt-daybreak-red-latest": { input: 12.5, cachedInput: 1.25, output: 75 },
}
