/**
 * Builds the generated OpenAI pricing table (openaiPricingData.ts) from public
 * price catalogs. PURE apart from the injected fetcher: the CLI in
 * scripts/update-openai-pricing.ts supplies real fetch and writes the file,
 * tests supply fixture responses.
 *
 * Sources, in order of authority:
 *   1. models.dev api.json (primary, MIT). `cost` is USD per 1M tokens.
 *   2. LiteLLM model_prices_and_context_window.json (cross-check, and the
 *      source for Codex-backend models models.dev does not list). Costs are
 *      USD per token and are normalized to per 1M here.
 *   3. OFFICIAL_OPENAI_PRICING (hand-maintained official rates), which both
 *      catalogs must agree with.
 *
 * Long-context tiers (see ContextTierPricing in pricing.ts) come from the
 * same source as the model's base rates: models.dev `cost.tiers` entries of
 * type "context", LiteLLM `*_above_<N>k_tokens` fields.
 *
 * The update refuses to produce a table, rather than silently shipping a
 * wrong one, when:
 *   - a model, or one of its context tiers, has no cached-input price
 *     (ChatGPT usage reports cached tokens, so pricing them at the uncached
 *     rate would overstate the value);
 *   - a model that is required, or that the committed table already prices,
 *     disappeared from every source;
 *   - a context tier the committed table or the official rates list is
 *     missing, which would under-price every long-context request;
 *   - two sources disagree beyond the tolerance.
 */

import type { ContextTierPricing, FlatModelPricing, ModelPricing } from "./pricing"
import type { OfficialOpenAiRates } from "./openaiOfficialPricing"

export const MODELS_DEV_URL = "https://models.dev/api.json"
export const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"

/** Relative difference two sources may show before the update fails. */
export const PRICE_TOLERANCE = 0.01

/**
 * Codex-backend (ChatGPT subscription) model ids that have a published API
 * list price. Each must be priced by at least one source or the update fails.
 * Backend ids without a complete public price (gpt-5.4-pro has no
 * cached-input rate) stay unpriced, which the dashboard surfaces as unpriced
 * requests instead of $0.
 */
export const REQUIRED_OPENAI_MODELS: readonly string[] = [
  "gpt-5-codex",
  "gpt-5.1",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2",
  "gpt-5.2-codex",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-nano",
  "gpt-5.5",
  "gpt-5.6-cyber",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "gpt-daybreak-blue-latest",
  "gpt-daybreak-red-latest",
]

/**
 * New models.dev entries join the table automatically when they look like a
 * GPT-5-or-later text model. Variants billed or served differently (pro,
 * chat-latest aliases, image/audio/realtime/search) are left out.
 */
const DISCOVERABLE_MODEL = /^gpt-([5-9]|\d{2,})(\.\d+)?(-[a-z0-9]+)*$/
const EXCLUDED_VARIANT = /-(pro|chat|latest|image|audio|realtime|search|transcribe|tts)(-|$)/

export type PricingSourceName = "models.dev" | "litellm"

export interface CatalogRateSet {
  input: number
  output: number
  cachedInput: number | null
  cacheWrite: number | null
}

export interface CatalogTier extends CatalogRateSet {
  aboveInputTokens: number
}

export interface CatalogRates extends CatalogRateSet {
  /** Context tiers, ascending by threshold. */
  tiers: CatalogTier[]
}

export interface OpenAiPricingBuild {
  table: Record<string, ModelPricing>
  sources: Record<string, PricingSourceName>
  errors: string[]
  notes: string[]
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function rate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

/** Strip float noise from unit conversion (1.75e-7 * 1e6 -> 0.175). */
function clean(value: number): number {
  return Number(value.toPrecision(12))
}

function byThreshold(a: CatalogTier, b: CatalogTier): number {
  return a.aboveInputTokens - b.aboveInputTokens
}

/**
 * models.dev context tiers. `context_over_200k` is a legacy mirror of the
 * first tier despite its name, so only `tiers` is read.
 */
function modelsDevTiers(cost: JsonObject): CatalogTier[] {
  if (!Array.isArray(cost.tiers)) return []
  const tiers: CatalogTier[] = []
  for (const entry of cost.tiers) {
    if (!isObject(entry) || !isObject(entry.tier)) continue
    const size = entry.tier.size
    const input = rate(entry.input)
    const output = rate(entry.output)
    if ((entry.tier.type ?? "context") !== "context") continue
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || input === null || output === null) continue
    tiers.push({
      aboveInputTokens: size,
      input,
      output,
      cachedInput: rate(entry.cache_read),
      cacheWrite: rate(entry.cache_write),
    })
  }
  return tiers.sort(byThreshold)
}

/** OpenAI models from a models.dev api.json payload, rates per 1M tokens. */
export function parseModelsDev(payload: unknown): Record<string, CatalogRates> {
  const result: Record<string, CatalogRates> = {}
  const models = isObject(payload) && isObject(payload.openai) ? payload.openai.models : undefined
  if (!isObject(models)) return result
  for (const [id, model] of Object.entries(models)) {
    if (!isObject(model) || !isObject(model.cost)) continue
    const input = rate(model.cost.input)
    const output = rate(model.cost.output)
    if (input === null || output === null) continue
    result[id.toLowerCase()] = {
      input,
      output,
      cachedInput: rate(model.cost.cache_read),
      cacheWrite: rate(model.cost.cache_write),
      tiers: modelsDevTiers(model.cost),
    }
  }
  return result
}

/**
 * LiteLLM long-context fields: `<rate>_above_<N>k_tokens`, N thousand being
 * the threshold. Service-tier variants (`..._tokens_flex`, `_priority`,
 * `_batches`) do not end in `_tokens` and are ignored.
 */
const LITELLM_TIER_FIELD =
  /^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)_above_(\d+)k_tokens$/

/** OpenAI models from a LiteLLM price map, converted to rates per 1M tokens. */
export function parseLiteLlm(payload: unknown): Record<string, CatalogRates> {
  const result: Record<string, CatalogRates> = {}
  if (!isObject(payload)) return result
  const perMTok = (value: unknown): number | null => {
    const perToken = rate(value)
    return perToken === null ? null : clean(perToken * 1e6)
  }
  for (const [rawId, model] of Object.entries(payload)) {
    if (!isObject(model) || model.litellm_provider !== "openai") continue
    const id = rawId.toLowerCase().replace(/^openai\//, "")
    const input = perMTok(model.input_cost_per_token)
    const output = perMTok(model.output_cost_per_token)
    if (input === null || output === null) continue
    const fieldsByThreshold = new Map<number, Record<string, number | null>>()
    for (const [key, value] of Object.entries(model)) {
      const match = LITELLM_TIER_FIELD.exec(key)
      if (!match) continue
      const threshold = Number(match[2]) * 1000
      const fields = fieldsByThreshold.get(threshold) ?? {}
      fields[match[1]!] = perMTok(value)
      fieldsByThreshold.set(threshold, fields)
    }
    const tiers: CatalogTier[] = []
    for (const [aboveInputTokens, fields] of fieldsByThreshold) {
      const tierInput = fields.input_cost_per_token ?? null
      const tierOutput = fields.output_cost_per_token ?? null
      if (tierInput === null || tierOutput === null) continue
      tiers.push({
        aboveInputTokens,
        input: tierInput,
        output: tierOutput,
        cachedInput: fields.cache_read_input_token_cost ?? null,
        cacheWrite: fields.cache_creation_input_token_cost ?? null,
      })
    }
    result[id] = {
      input,
      output,
      cachedInput: perMTok(model.cache_read_input_token_cost),
      cacheWrite: perMTok(model.cache_creation_input_token_cost),
      tiers: tiers.sort(byThreshold),
    }
  }
  return result
}

function differs(a: number, b: number, tolerance: number): boolean {
  if (a === b) return false
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) > tolerance
}

function compareRates(
  id: string,
  label: string,
  a: { input: number; cachedInput: number | null; output: number },
  b: { input: number; cachedInput: number | null; output: number },
  tolerance: number,
): string[] {
  const errors: string[] = []
  for (const field of ["input", "cachedInput", "output"] as const) {
    const left = a[field]
    const right = b[field]
    if (left === null || right === null) continue
    if (differs(left, right, tolerance)) {
      errors.push(`${id}: ${label} disagree on ${field} (${left} vs ${right})`)
    }
  }
  return errors
}

function tierLabel(aboveInputTokens: number): string {
  return `context tier above ${aboveInputTokens}`
}

/**
 * Compare the context tiers two catalogs list at the same threshold. A tier
 * only the other catalog lists is noted, not applied: the chosen source owns
 * the model's rates.
 */
function compareTiers(id: string, chosen: CatalogRates, other: CatalogRates, otherName: string, tolerance: number) {
  const errors: string[] = []
  const notes: string[] = []
  for (const tier of other.tiers) {
    const match = chosen.tiers.find(t => t.aboveInputTokens === tier.aboveInputTokens)
    if (match) errors.push(...compareRates(id, `models.dev and LiteLLM ${tierLabel(tier.aboveInputTokens)}`, match, tier, tolerance))
    else notes.push(`${id}: ${otherName} lists a ${tierLabel(tier.aboveInputTokens)} the chosen source lacks; not applied`)
  }
  return { errors, notes }
}

function toTierPricing(tier: CatalogTier, cachedInput: number): ContextTierPricing {
  return {
    aboveInputTokens: tier.aboveInputTokens,
    inputPerMTok: tier.input,
    outputPerMTok: tier.output,
    cacheReadPerMTok: cachedInput,
    cacheWritePerMTok: tier.cacheWrite ?? tier.input,
  }
}

export interface BuildOptions {
  modelsDev: Record<string, CatalogRates>
  litellm: Record<string, CatalogRates>
  official: Record<string, OfficialOpenAiRates>
  /** The committed table; a model it prices may not silently disappear. */
  previous: Record<string, ModelPricing>
  required?: readonly string[]
  tolerance?: number
}

export function buildOpenAiPricing(options: BuildOptions): OpenAiPricingBuild {
  const { modelsDev, litellm, official, previous } = options
  const required = new Set(options.required ?? REQUIRED_OPENAI_MODELS)
  const tolerance = options.tolerance ?? PRICE_TOLERANCE
  const known = new Set([...required, ...Object.keys(previous)])
  const discovered = Object.keys(modelsDev).filter(
    id => !known.has(id) && DISCOVERABLE_MODEL.test(id) && !EXCLUDED_VARIANT.test(id),
  )

  const build: OpenAiPricingBuild = { table: {}, sources: {}, errors: [], notes: [] }

  for (const id of [...known, ...discovered].sort()) {
    const fromModelsDev = modelsDev[id]
    const fromLiteLlm = litellm[id]
    const chosen = fromModelsDev ?? fromLiteLlm
    if (!chosen) {
      build.errors.push(`${id}: missing from models.dev and LiteLLM`)
      continue
    }
    if (chosen.cachedInput === null) {
      if (known.has(id)) build.errors.push(`${id}: no cached-input price`)
      else build.notes.push(`${id}: skipped new model without a cached-input price`)
      continue
    }
    const contextTiers: ContextTierPricing[] = []
    const uncachedTiers: string[] = []
    for (const tier of chosen.tiers) {
      if (tier.cachedInput === null) uncachedTiers.push(`${id}: no cached-input price for its ${tierLabel(tier.aboveInputTokens)}`)
      else contextTiers.push(toTierPricing(tier, tier.cachedInput))
    }
    if (uncachedTiers.length > 0) {
      if (known.has(id)) build.errors.push(...uncachedTiers)
      else build.notes.push(`${id}: skipped new model with a context tier lacking a cached-input price`)
      continue
    }

    const other = chosen === fromModelsDev ? fromLiteLlm : undefined
    const tierCheck = other
      ? compareTiers(id, chosen, other, "LiteLLM", tolerance)
      : { errors: [], notes: [] }
    build.notes.push(...tierCheck.notes)

    const officialTier = official[id]?.longContext
    const chosenOfficialTier = officialTier && chosen.tiers.find(t => t.aboveInputTokens === officialTier.aboveInputTokens)
    const missingTiers = new Set([
      ...(officialTier && !chosenOfficialTier ? [officialTier.aboveInputTokens] : []),
      ...(previous[id]?.contextTiers ?? [])
        .map(tier => tier.aboveInputTokens)
        .filter(above => !chosen.tiers.some(t => t.aboveInputTokens === above)),
    ])

    const errors = [
      ...(other ? compareRates(id, "models.dev and LiteLLM", chosen, other, tolerance) : []),
      ...tierCheck.errors,
      ...(official[id] ? compareRates(id, "catalog and official rates", chosen, official[id], tolerance) : []),
      ...(officialTier && chosenOfficialTier
        ? compareRates(id, `catalog and official ${tierLabel(officialTier.aboveInputTokens)}`, chosenOfficialTier, officialTier, tolerance)
        : []),
      ...[...missingTiers].sort((a, b) => a - b).map(above => `${id}: ${tierLabel(above)} missing from the catalog`),
    ]
    if (errors.length > 0) {
      build.errors.push(...errors)
      continue
    }

    build.table[id] = {
      inputPerMTok: chosen.input,
      outputPerMTok: chosen.output,
      cacheReadPerMTok: chosen.cachedInput,
      // OpenAI usage reports no cache-creation tokens; the write rate only
      // matters for a client that sends them, so default to the input rate.
      cacheWritePerMTok: chosen.cacheWrite ?? chosen.input,
      ...(contextTiers.length > 0 ? { contextTiers } : {}),
    }
    build.sources[id] = fromModelsDev ? "models.dev" : "litellm"
    if (!previous[id]) build.notes.push(`${id}: added from ${build.sources[id]}`)
  }

  for (const id of Object.keys(official)) {
    if (!build.table[id] && !build.errors.some(error => error.startsWith(`${id}:`))) {
      build.errors.push(`${id}: listed in official rates but not produced by any source`)
    }
  }

  return build
}

function renderRates(r: FlatModelPricing): string {
  return `inputPerMTok: ${r.inputPerMTok}, outputPerMTok: ${r.outputPerMTok}, cacheReadPerMTok: ${r.cacheReadPerMTok}, cacheWritePerMTok: ${r.cacheWritePerMTok}`
}

/** Render the generated module. Deterministic, so an unchanged table is an unchanged file. */
export function renderOpenAiPricingModule(
  table: Record<string, ModelPricing>,
  sources: Record<string, PricingSourceName>,
): string {
  const lines = Object.keys(table)
    .sort()
    .map(id => {
      const p = table[id]!
      const tiers = p.contextTiers?.length
        ? `, contextTiers: [${p.contextTiers.map(t => `{ aboveInputTokens: ${t.aboveInputTokens}, ${renderRates(t)} }`).join(", ")}]`
        : ""
      return `  ${JSON.stringify(id)}: { ${renderRates(p)}${tiers} }, // ${sources[id] ?? "unknown"}`
    })
  return [
    "// GENERATED by scripts/update-openai-pricing.ts - do not edit by hand.",
    "// Source per model is noted inline; see openaiPricingUpdate.ts for the",
    "// sources, validation rules and the official-rate guard.",
    "",
    'import type { ModelPricing } from "./pricing"',
    "",
    "/** OpenAI list prices, USD per 1M tokens. */",
    "export const OPENAI_MODEL_PRICING: Record<string, ModelPricing> = {",
    ...lines,
    "}",
    "",
  ].join("\n")
}

export type FetchJson = (url: string) => Promise<unknown>

export interface UpdateResult extends OpenAiPricingBuild {
  moduleText: string | null
}

/** Fetch both catalogs and build the table. moduleText is null when any check failed. */
export async function updateOpenAiPricing(
  fetchJson: FetchJson,
  options: Omit<BuildOptions, "modelsDev" | "litellm">,
): Promise<UpdateResult> {
  const [modelsDevPayload, litellmPayload] = await Promise.all([
    fetchJson(MODELS_DEV_URL),
    fetchJson(LITELLM_URL),
  ])
  const modelsDev = parseModelsDev(modelsDevPayload)
  const litellm = parseLiteLlm(litellmPayload)
  if (Object.keys(modelsDev).length === 0) throw new Error("models.dev returned no OpenAI models")
  if (Object.keys(litellm).length === 0) throw new Error("LiteLLM returned no OpenAI models")

  const build = buildOpenAiPricing({ ...options, modelsDev, litellm })
  return {
    ...build,
    moduleText: build.errors.length === 0 ? renderOpenAiPricingModule(build.table, build.sources) : null,
  }
}
