/**
 * Unit tests for the ChatGPT plan-tier mapping.
 *
 * The slugs pinned here are the ones the vendor actually returns, verified
 * against six live accounts: `pro`, `team`, `self_serve_business_prolite` and
 * `free` all appear in a single real pool. The mapping is a port of
 * ai-api-usage-tracker's `describeChatGPTPlanType`, which is the richest of the
 * three implementations in play and the one this repo mirrors.
 *
 * The subtle case is `self_serve_business_prolite`: it is the vendor's name for
 * the 5x BUSINESS seat, not the personal Pro Lite tier that matches on the same
 * `prolite` token. Getting these two confused misprices the seat by 5x, so both
 * are pinned separately.
 */
import { describe, test, expect } from "bun:test"
import { normalizeCodexPlanSlug, describeCodexPlan } from "../proxy/codex/plan"

describe("normalizeCodexPlanSlug", () => {
  test("returns null for non-strings and blanks", () => {
    expect(normalizeCodexPlanSlug(null)).toBeNull()
    expect(normalizeCodexPlanSlug(undefined)).toBeNull()
    expect(normalizeCodexPlanSlug(42)).toBeNull()
    expect(normalizeCodexPlanSlug("")).toBeNull()
    expect(normalizeCodexPlanSlug("   ")).toBeNull()
  })

  test("strips the vendor prefix, collapses separators and lowercases", () => {
    expect(normalizeCodexPlanSlug("self_serve_business_prolite")).toBe("self serve business prolite")
    expect(normalizeCodexPlanSlug("ChatGPT_Pro")).toBe("pro")
    expect(normalizeCodexPlanSlug("  PLUS  ")).toBe("plus")
  })

  test("collapses the roster spelling onto the self-reported one", () => {
    // The admin roster spells a tier as one token while the token claim uses
    // the bare word; both must land on the same normalized form.
    expect(normalizeCodexPlanSlug("chatgptteamplan")).toBe("team")
  })
})

describe("describeCodexPlan", () => {
  test("maps every slug observed on the real accounts", () => {
    expect(describeCodexPlan("pro")).toEqual({
      slug: "pro",
      label: "ChatGPT Pro",
      multiplier: "20x",
      price: "$200/mo",
    })
    expect(describeCodexPlan("team")).toEqual({
      slug: "team",
      label: "ChatGPT Team",
      multiplier: "1x",
      price: "$25/mo",
    })
    expect(describeCodexPlan("self_serve_business_prolite")).toEqual({
      slug: "self_serve_business_prolite",
      label: "ChatGPT Business Premium",
      multiplier: "5x",
      price: "$125/mo",
    })
    expect(describeCodexPlan("free")).toEqual({
      slug: "free",
      label: "ChatGPT Free",
      multiplier: "~0x",
      price: null,
    })
  })

  test("distinguishes the business seats from each other", () => {
    expect(describeCodexPlan("business_standard").label).toBe("ChatGPT Business Standard")
    expect(describeCodexPlan("business_standard").multiplier).toBe("1x")
    // A bare "business" names the workspace, not the seat, and the seats are 5x
    // apart — so it stays unpriced rather than guessing.
    expect(describeCodexPlan("business")).toEqual({
      slug: "business",
      label: "ChatGPT Business",
      multiplier: null,
      price: null,
    })
  })

  test("separates legacy Pro from current Pro", () => {
    expect(describeCodexPlan("pro_5x").label).toBe("ChatGPT Pro (legacy)")
    expect(describeCodexPlan("pro_5x").multiplier).toBe("5x")
    expect(describeCodexPlan("pro_200").label).toBe("ChatGPT Pro")
    expect(describeCodexPlan("pro_200").multiplier).toBe("20x")
  })

  test("maps the remaining personal tiers", () => {
    expect(describeCodexPlan("plus").label).toBe("ChatGPT Plus")
    expect(describeCodexPlan("prolite").label).toBe("ChatGPT Pro Lite")
    expect(describeCodexPlan("prolite").multiplier).toBe("5x")
    expect(describeCodexPlan("go").label).toBe("ChatGPT Go")
    expect(describeCodexPlan("go").multiplier).toBeNull()
  })

  test("title-cases an unrecognised slug rather than inventing an allowance", () => {
    const described = describeCodexPlan("some_future_tier")
    expect(described.label).toBe("Some Future Tier")
    expect(described.multiplier).toBeNull()
    expect(described.price).toBeNull()
    expect(described.slug).toBe("some_future_tier")
  })

  test("renders an em dash when the plan is unknown", () => {
    expect(describeCodexPlan(null)).toEqual({
      slug: null,
      label: "\u2014",
      multiplier: null,
      price: null,
    })
    expect(describeCodexPlan(undefined).label).toBe("\u2014")
    expect(describeCodexPlan("").label).toBe("\u2014")
  })
})
