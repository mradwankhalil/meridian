import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { computeCostEstimate, estimateRequestCostUsd, ratesForPrompt, resolveModelPricing, type ModelPricing } from "../telemetry/pricing"
import { OFFICIAL_OPENAI_PRICING } from "../telemetry/openaiOfficialPricing"
import { OPENAI_MODEL_PRICING } from "../telemetry/openaiPricingData"
import {
  LITELLM_URL,
  MODELS_DEV_URL,
  REQUIRED_OPENAI_MODELS,
  buildOpenAiPricing,
  parseLiteLlm,
  parseModelsDev,
  renderOpenAiPricingModule,
  updateOpenAiPricing,
  type CatalogRates,
  type CatalogTier,
} from "../telemetry/openaiPricingUpdate"
import type { RequestMetric } from "../telemetry/types"

function makeMetric(overrides: Partial<RequestMetric> = {}): RequestMetric {
  return {
    requestId: "req-gpt",
    timestamp: Date.now(),
    model: "gpt-6-sol",
    mode: "stream",
    isResume: false,
    isPassthrough: false,
    status: 200,
    queueWaitMs: 0,
    proxyOverheadMs: 0,
    ttfbMs: 0,
    upstreamDurationMs: 0,
    totalDurationMs: 0,
    contentBlocks: 1,
    textEvents: 1,
    error: null,
    ...overrides,
  }
}

function catalog(
  input: number,
  cachedInput: number | null,
  output: number,
  cacheWrite: number | null = null,
  tiers: CatalogTier[] = [],
): CatalogRates {
  return { input, cachedInput, output, cacheWrite, tiers }
}

function tier(aboveInputTokens: number, input: number, cachedInput: number | null, output: number, cacheWrite: number | null = null): CatalogTier {
  return { aboveInputTokens, input, cachedInput, output, cacheWrite }
}

describe("OpenAI pricing lookup", () => {
  it("prices every official model at its official rate", () => {
    for (const [id, official] of Object.entries(OFFICIAL_OPENAI_PRICING)) {
      expect(resolveModelPricing(id)).toMatchObject({
        inputPerMTok: official.input,
        cacheReadPerMTok: official.cachedInput,
        outputPerMTok: official.output,
      })
    }
  })

  it("prices every official long-context rate as a context tier", () => {
    for (const [id, official] of Object.entries(OFFICIAL_OPENAI_PRICING)) {
      if (!official.longContext) continue
      expect(resolveModelPricing(id)?.contextTiers).toEqual([expect.objectContaining({
        aboveInputTokens: official.longContext.aboveInputTokens,
        inputPerMTok: official.longContext.input,
        cacheReadPerMTok: official.longContext.cachedInput,
        outputPerMTok: official.longContext.output,
      })])
    }
  })

  it("prices every required Codex-backend model", () => {
    for (const id of REQUIRED_OPENAI_MODELS) expect(OPENAI_MODEL_PRICING[id]).toBeDefined()
  })

  it("prices effort-suffixed and dated selectors at the base model's rate", () => {
    const sol = resolveModelPricing("gpt-6-sol")
    expect(resolveModelPricing("gpt-6-sol-high")).toEqual(sol)
    expect(resolveModelPricing("GPT-6-Sol-XHigh")).toEqual(sol)
    expect(resolveModelPricing("gpt-5.5-2026-04-23")).toEqual(resolveModelPricing("gpt-5.5"))
    expect(resolveModelPricing("gpt-5.6-luna-max")).toEqual(resolveModelPricing("gpt-5.6-luna"))
  })

  it("prices gpt-6.1-sol, released 2026-09-29, at its models.dev and official short-context rate", () => {
    expect(resolveModelPricing("gpt-6.1-sol")).toEqual({
      inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 2.5,
      contextTiers: [{ aboveInputTokens: 272_000, inputPerMTok: 4, outputPerMTok: 15, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 }],
    })
    expect(resolveModelPricing("gpt-6.1-sol-high")).toEqual(resolveModelPricing("gpt-6.1-sol"))
    const metric = makeMetric({ model: "gpt-6.1-sol", inputTokens: 80_000, cacheReadInputTokens: 20_000, outputTokens: 50_000 })
    // 0.08 * $2 + 0.02 * $0.10 + 0.05 * $10
    expect(computeCostEstimate([metric]).totalUsd).toBeCloseTo(0.16 + 0.002 + 0.5, 6)
  })

  it("leaves unknown GPT models unpriced instead of guessing a family rate", () => {
    expect(resolveModelPricing("gpt-7-nova")).toBeNull()
    expect(resolveModelPricing("gpt-4o")).toBeNull()
    expect(resolveModelPricing("gpt-5.4-pro")).toBeNull()
  })

  it("applies an override on the base model to its suffixed selectors", () => {
    const custom: ModelPricing = { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1 }
    expect(resolveModelPricing("gpt-6-sol-high", { "gpt-6-sol": custom })).toBe(custom)
    expect(resolveModelPricing("gpt-7-nova-high", { "gpt-7-nova": custom })).toBe(custom)
  })
})

describe("OpenAI cost math", () => {
  it("values cached input and reasoning tokens exactly once", () => {
    // Raw Responses usage: input_tokens 100,000 of which cached_tokens
    // 20,000; output_tokens 50,000 of which reasoning_tokens 30,000.
    // Telemetry records the uncached remainder as inputTokens and keeps
    // reasoning inside outputTokens.
    const metric = makeMetric({ inputTokens: 80_000, cacheReadInputTokens: 20_000, outputTokens: 50_000 })
    const cost = estimateRequestCostUsd(metric, resolveModelPricing("gpt-6-sol")!)
    // 0.08 * $2 + 0.02 * $0.20 + 0.05 * $10
    expect(cost).toBeCloseTo(0.16 + 0.004 + 0.5, 10)
  })

  it("counts GPT requests in the cost estimate instead of as unpriced", () => {
    const estimate = computeCostEstimate([
      makeMetric({ model: "gpt-6-luna-high", inputTokens: 100_000, outputTokens: 100_000 }),
      makeMetric({ model: "gpt-7-nova", inputTokens: 100_000 }),
    ])
    expect(estimate.byModel["gpt-6-luna-high"]!.estimatedUsd).toBeCloseTo(0.06, 6)
    expect(estimate.byModel["gpt-7-nova"]!.estimatedUsd).toBeNull()
    expect(estimate.unpricedRequestCount).toBe(1)
  })
})

describe("long-context tier", () => {
  // gpt-6.1-sol: 2 / 0.10 / 10 per 1M up to 272K prompt tokens, 4 / 0.20 / 15 above.
  const sol = () => resolveModelPricing("gpt-6.1-sol")!
  const cost = (inputTokens: number, cacheReadInputTokens: number, outputTokens: number) =>
    computeCostEstimate([makeMetric({ model: "gpt-6.1-sol", inputTokens, cacheReadInputTokens, outputTokens })]).totalUsd

  it("bills a prompt below the threshold at the base rates", () => {
    expect(cost(200_000, 71_999, 10_000)).toBeCloseTo(0.2 * 2 + 0.071999 * 0.1 + 0.01 * 10, 6)
  })

  it("bills a prompt of exactly the threshold at the base rates", () => {
    expect(cost(200_000, 72_000, 10_000)).toBeCloseTo(0.2 * 2 + 0.072 * 0.1 + 0.01 * 10, 6)
  })

  it("bills every token of a prompt one over the threshold at the tier rates", () => {
    expect(cost(200_000, 72_001, 10_000)).toBeCloseTo(0.2 * 4 + 0.072001 * 0.2 + 0.01 * 15, 6)
  })

  it("counts cached and cache-write tokens toward the threshold, but not output", () => {
    const cachedHeavy = makeMetric({ inputTokens: 1_000, cacheReadInputTokens: 271_001, outputTokens: 0 })
    expect(estimateRequestCostUsd(cachedHeavy, sol())).toBeCloseTo((1_000 * 4 + 271_001 * 0.2) / 1e6, 10)
    const withWrites = makeMetric({ inputTokens: 1_000, cacheCreationInputTokens: 271_001, outputTokens: 0 })
    expect(estimateRequestCostUsd(withWrites, sol())).toBeCloseTo((1_000 * 4 + 271_001 * 5) / 1e6, 10)
    const outputHeavy = makeMetric({ inputTokens: 1_000, outputTokens: 500_000 })
    expect(estimateRequestCostUsd(outputHeavy, sol())).toBeCloseTo((1_000 * 2 + 500_000 * 10) / 1e6, 10)
  })

  it("picks the highest tier the prompt exceeds", () => {
    const pricing: ModelPricing = {
      inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1,
      contextTiers: [
        { aboveInputTokens: 500_000, inputPerMTok: 3, outputPerMTok: 3, cacheReadPerMTok: 3, cacheWritePerMTok: 3 },
        { aboveInputTokens: 100_000, inputPerMTok: 2, outputPerMTok: 2, cacheReadPerMTok: 2, cacheWritePerMTok: 2 },
      ],
    }
    expect(ratesForPrompt(pricing, 100_000).inputPerMTok).toBe(1)
    expect(ratesForPrompt(pricing, 100_001).inputPerMTok).toBe(2)
    expect(ratesForPrompt(pricing, 500_001).inputPerMTok).toBe(3)
  })

  it("applies the tier to effort-suffixed selectors, and a flat override replaces it", () => {
    const metric = makeMetric({ model: "gpt-6.1-sol-high", inputTokens: 300_000 })
    expect(computeCostEstimate([metric]).totalUsd).toBeCloseTo(0.3 * 4, 6)
    const flat: ModelPricing = { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 2.5 }
    expect(computeCostEstimate([metric], { "gpt-6.1-sol": flat }).totalUsd).toBeCloseTo(0.3 * 2, 6)
  })

  it("leaves a model without tiers at its flat rate at any size", () => {
    expect(resolveModelPricing("gpt-5.3-codex")?.contextTiers).toBeUndefined()
    const metric = makeMetric({ model: "gpt-5.3-codex", inputTokens: 390_000 })
    expect(computeCostEstimate([metric]).totalUsd).toBeCloseTo(0.39 * 1.75, 6)
  })
})

describe("served-model pricing guard", () => {
  it("leaves a GPT id answered by Claude unpriced", () => {
    // /v1/responses maps an unknown id like gpt-5.5 to the sonnet tier.
    const estimate = computeCostEstimate([
      makeMetric({ model: "sonnet", requestModel: "gpt-5.5", inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ])
    expect(estimate.byModel["gpt-5.5"]!.estimatedUsd).toBeNull()
    expect(estimate.unpricedRequestCount).toBe(1)
    expect(estimate.totalUsd).toBe(0)
  })

  it("prices a Claude-answered GPT id only through a user override", () => {
    const custom: ModelPricing = { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 }
    const metric = makeMetric({ model: "sonnet", requestModel: "gpt-5.5-high", inputTokens: 1_000_000 })
    expect(computeCostEstimate([metric], { "gpt-5.5-high": custom }).totalUsd).toBeCloseTo(3, 6)
    expect(computeCostEstimate([metric], { "gpt-5.5": custom }).totalUsd).toBeCloseTo(3, 6)
  })

  it("prices an OpenAI fallback at the model that served it", () => {
    const estimate = computeCostEstimate([
      makeMetric({ model: "gpt-6-sol", requestModel: "gpt-6-astra", inputTokens: 100_000 }),
    ])
    expect(estimate.byModel["gpt-6-astra"]!.estimatedUsd).toBeCloseTo(0.2, 6)
  })

  it("keeps pricing Claude requests by the client's exact id", () => {
    const estimate = computeCostEstimate([
      makeMetric({ model: "opus", requestModel: "claude-opus-5", inputTokens: 1_000_000 }),
    ])
    expect(estimate.byModel["claude-opus-5"]!.estimatedUsd).toBeCloseTo(5, 6)
  })
})

describe("catalog parsing", () => {
  it("reads OpenAI models from models.dev", () => {
    const parsed = parseModelsDev({
      openai: {
        models: {
          "gpt-6-sol": {
            cost: {
              input: 2, output: 10, cache_read: 0.2, cache_write: 2.5,
              tiers: [
                { input: 4, output: 15, cache_read: 0.4, cache_write: 5, tier: { type: "context", size: 272000 } },
                { input: 9, output: 9, tier: { type: "batch", size: 1 } },
              ],
              context_over_200k: { input: 99, output: 99, cache_read: 99 },
            },
          },
          "gpt-5.4-pro": { cost: { input: 30, output: 180 } },
          "text-embedding-3-small": { cost: { input: 0.02 } },
          broken: { cost: "free" },
        },
      },
      anthropic: { models: { "claude-opus-5": { cost: { input: 5, output: 25 } } } },
    })
    expect(parsed).toEqual({
      "gpt-6-sol": catalog(2, 0.2, 10, 2.5, [tier(272_000, 4, 0.4, 15, 5)]),
      "gpt-5.4-pro": catalog(30, null, 180),
    })
  })

  it("converts LiteLLM per-token OpenAI rates to per-1M without float noise", () => {
    const parsed = parseLiteLlm({
      "gpt-5.3-codex": {
        litellm_provider: "openai",
        input_cost_per_token: 1.75e-6,
        cache_read_input_token_cost: 1.75e-7,
        output_cost_per_token: 1.4e-5,
      },
      "openai/gpt-6-luna": {
        litellm_provider: "openai",
        input_cost_per_token: 1e-7,
        cache_read_input_token_cost: 1e-8,
        output_cost_per_token: 5e-7,
        input_cost_per_token_above_272k_tokens: 2e-7,
        cache_read_input_token_cost_above_272k_tokens: 2e-8,
        output_cost_per_token_above_272k_tokens: 7.5e-7,
        input_cost_per_token_above_272k_tokens_priority: 1,
      },
      "azure/gpt-6-sol": { litellm_provider: "azure", input_cost_per_token: 1, output_cost_per_token: 1 },
      sample_spec: { note: "not a model" },
    })
    expect(parsed).toEqual({
      "gpt-5.3-codex": catalog(1.75, 0.175, 14),
      "gpt-6-luna": catalog(0.1, 0.01, 0.5, null, [tier(272_000, 0.2, 0.02, 0.75)]),
    })
  })
})

describe("buildOpenAiPricing", () => {
  const official = { "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 } }
  const base = {
    modelsDev: { "gpt-6-sol": catalog(2, 0.2, 10, 2.5) },
    litellm: { "gpt-6-sol": catalog(2, 0.2, 10), "gpt-5-codex": catalog(1.25, 0.125, 10) },
    official,
    previous: {},
    required: ["gpt-6-sol", "gpt-5-codex"],
  }

  it("prefers models.dev and falls back to LiteLLM for models it lacks", () => {
    const build = buildOpenAiPricing(base)
    expect(build.errors).toEqual([])
    expect(build.table["gpt-6-sol"]).toEqual({ inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 })
    expect(build.table["gpt-5-codex"]).toEqual({ inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: 1.25 })
    expect(build.sources).toEqual({ "gpt-6-sol": "models.dev", "gpt-5-codex": "litellm" })
  })

  it("fails when a required model has no cached-input price", () => {
    const build = buildOpenAiPricing({ ...base, litellm: { ...base.litellm, "gpt-5-codex": catalog(1.25, null, 10) } })
    expect(build.errors).toEqual(["gpt-5-codex: no cached-input price"])
  })

  it("fails when a previously priced model disappears from every source", () => {
    const previous = { "gpt-5.2": { inputPerMTok: 1.75, outputPerMTok: 14, cacheReadPerMTok: 0.175, cacheWritePerMTok: 1.75 } }
    const build = buildOpenAiPricing({ ...base, previous })
    expect(build.errors).toEqual(["gpt-5.2: missing from models.dev and LiteLLM"])
  })

  it("fails when the catalogs disagree beyond the tolerance", () => {
    const build = buildOpenAiPricing({ ...base, litellm: { ...base.litellm, "gpt-6-sol": catalog(2, 0.2, 12) } })
    expect(build.errors).toEqual(["gpt-6-sol: models.dev and LiteLLM disagree on output (10 vs 12)"])
    expect(build.table["gpt-6-sol"]).toBeUndefined()
  })

  it("accepts a difference within the tolerance", () => {
    const build = buildOpenAiPricing({ ...base, litellm: { ...base.litellm, "gpt-6-sol": catalog(2.01, 0.2, 10) } })
    expect(build.errors).toEqual([])
  })

  it("fails when both catalogs disagree with the official rates", () => {
    const build = buildOpenAiPricing({
      ...base,
      modelsDev: { "gpt-6-sol": catalog(3, 0.3, 10) },
      litellm: { ...base.litellm, "gpt-6-sol": catalog(3, 0.3, 10) },
    })
    expect(build.errors).toEqual([
      "gpt-6-sol: catalog and official rates disagree on input (3 vs 2)",
      "gpt-6-sol: catalog and official rates disagree on cachedInput (0.3 vs 0.2)",
    ])
  })

  it("fails when an official model is produced by no source", () => {
    const build = buildOpenAiPricing({
      ...base,
      official: { ...official, "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 } },
    })
    expect(build.errors).toEqual(["gpt-6-astra: listed in official rates but not produced by any source"])
  })

  it("adds new GPT text models from models.dev and skips other variants", () => {
    const build = buildOpenAiPricing({
      ...base,
      modelsDev: {
        ...base.modelsDev,
        "gpt-7": catalog(3, 0.3, 15),
        "gpt-7-pro": catalog(30, 3, 180),
        "gpt-7-chat-latest": catalog(3, 0.3, 15),
        "gpt-image-2": catalog(5, 0.5, 40),
        "gpt-4.1": catalog(2, 0.5, 8),
        "gpt-7-mini": catalog(0.5, null, 2),
      },
    })
    expect(build.errors).toEqual([])
    expect(Object.keys(build.table).sort()).toEqual(["gpt-5-codex", "gpt-6-sol", "gpt-7"])
    expect(build.notes).toContain("gpt-7: added from models.dev")
    expect(build.notes).toContain("gpt-7-mini: skipped new model without a cached-input price")
  })

  describe("context tiers", () => {
    const officialTier = {
      "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10, longContext: { aboveInputTokens: 272_000, input: 4, cachedInput: 0.4, output: 15 } },
    }
    const tiered = {
      ...base,
      modelsDev: { "gpt-6-sol": catalog(2, 0.2, 10, 2.5, [tier(272_000, 4, 0.4, 15, 5)]) },
      litellm: { ...base.litellm, "gpt-6-sol": catalog(2, 0.2, 10, null, [tier(272_000, 4, 0.4, 15)]) },
      official: officialTier,
    }

    it("carries the chosen source's tier into the table", () => {
      const build = buildOpenAiPricing(tiered)
      expect(build.errors).toEqual([])
      expect(build.table["gpt-6-sol"]!.contextTiers).toEqual([
        { aboveInputTokens: 272_000, inputPerMTok: 4, outputPerMTok: 15, cacheReadPerMTok: 0.4, cacheWritePerMTok: 5 },
      ])
      expect(build.table["gpt-5-codex"]!.contextTiers).toBeUndefined()
    })

    it("defaults a tier's cache-write rate to its input rate", () => {
      const build = buildOpenAiPricing({ ...tiered, modelsDev: { "gpt-6-sol": catalog(2, 0.2, 10, 2.5, [tier(272_000, 4, 0.4, 15)]) } })
      expect(build.table["gpt-6-sol"]!.contextTiers![0]!.cacheWritePerMTok).toBe(4)
    })

    it("fails when the catalogs disagree on a tier", () => {
      const build = buildOpenAiPricing({
        ...tiered,
        litellm: { ...base.litellm, "gpt-6-sol": catalog(2, 0.2, 10, null, [tier(272_000, 4, 0.4, 20)]) },
      })
      expect(build.errors).toEqual(["gpt-6-sol: models.dev and LiteLLM context tier above 272000 disagree on output (15 vs 20)"])
    })

    it("fails when the chosen tier disagrees with the official long-context rate", () => {
      const build = buildOpenAiPricing({
        ...tiered,
        modelsDev: { "gpt-6-sol": catalog(2, 0.2, 10, 2.5, [tier(272_000, 4, 0.2, 15, 5)]) },
        litellm: base.litellm,
      })
      expect(build.errors).toEqual(["gpt-6-sol: catalog and official context tier above 272000 disagree on cachedInput (0.2 vs 0.4)"])
    })

    it("fails when a tier the official rates or the committed table list disappears", () => {
      const noTier = { ...tiered, modelsDev: base.modelsDev, litellm: base.litellm }
      expect(buildOpenAiPricing(noTier).errors).toEqual(["gpt-6-sol: context tier above 272000 missing from the catalog"])
      const previous = { "gpt-6-sol": buildOpenAiPricing(tiered).table["gpt-6-sol"]! }
      expect(buildOpenAiPricing({ ...noTier, official, previous }).errors)
        .toEqual(["gpt-6-sol: context tier above 272000 missing from the catalog"])
    })

    it("fails when a known model's tier has no cached-input price", () => {
      const build = buildOpenAiPricing({ ...tiered, modelsDev: { "gpt-6-sol": catalog(2, 0.2, 10, 2.5, [tier(272_000, 4, null, 15)]) } })
      expect(build.errors).toEqual(["gpt-6-sol: no cached-input price for its context tier above 272000"])
    })

    it("notes, but does not apply, a tier only the other catalog lists", () => {
      const build = buildOpenAiPricing({ ...tiered, modelsDev: base.modelsDev, official })
      expect(build.errors).toEqual([])
      expect(build.table["gpt-6-sol"]!.contextTiers).toBeUndefined()
      expect(build.notes).toContain("gpt-6-sol: LiteLLM lists a context tier above 272000 the chosen source lacks; not applied")
    })

    it("renders tiers into the module", () => {
      const build = buildOpenAiPricing(tiered)
      expect(renderOpenAiPricingModule(build.table, build.sources)).toContain(
        '"gpt-6-sol": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5, contextTiers: [{ aboveInputTokens: 272000, inputPerMTok: 4, outputPerMTok: 15, cacheReadPerMTok: 0.4, cacheWritePerMTok: 5 }] }, // models.dev',
      )
    })
  })
})

describe("updateOpenAiPricing", () => {
  const modelsDevPayload = {
    openai: { models: { "gpt-6-sol": { cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 } } } },
  }
  const litellmPayload = {
    "gpt-6-sol": { litellm_provider: "openai", input_cost_per_token: 2e-6, cache_read_input_token_cost: 2e-7, output_cost_per_token: 1e-5 },
  }
  const fixtures: Record<string, unknown> = { [MODELS_DEV_URL]: modelsDevPayload, [LITELLM_URL]: litellmPayload }
  const fetchFixture = async (url: string) => fixtures[url]
  const options = {
    official: { "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 } },
    previous: {},
    required: ["gpt-6-sol"],
  }

  it("renders a deterministic module from fixture responses", async () => {
    const result = await updateOpenAiPricing(fetchFixture, options)
    expect(result.errors).toEqual([])
    expect(result.moduleText).toBe(renderOpenAiPricingModule(result.table, result.sources))
    expect(result.moduleText).toContain(
      '"gpt-6-sol": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 }, // models.dev',
    )
  })

  it("produces no module when a check fails", async () => {
    const result = await updateOpenAiPricing(fetchFixture, { ...options, required: ["gpt-6-sol", "gpt-5-codex"] })
    expect(result.moduleText).toBeNull()
    expect(result.errors).toEqual(["gpt-5-codex: missing from models.dev and LiteLLM"])
  })

  it("refuses an empty catalog response", async () => {
    await expect(updateOpenAiPricing(async url => (url === MODELS_DEV_URL ? {} : litellmPayload), options))
      .rejects.toThrow("models.dev returned no OpenAI models")
  })

  it("renders the committed table byte-for-byte", () => {
    const committed = readFileSync(join(import.meta.dir, "..", "telemetry", "openaiPricingData.ts"), "utf-8")
    const sources = Object.fromEntries(
      [...committed.matchAll(/^  "([^"]+)": .* \/\/ (models\.dev|litellm)$/gm)].map(m => [m[1]!, m[2] as "models.dev" | "litellm"]),
    )
    expect(renderOpenAiPricingModule(OPENAI_MODEL_PRICING, sources)).toBe(committed)
  })
})
