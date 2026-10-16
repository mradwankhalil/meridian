/**
 * ChatGPT plan-tier labelling.
 *
 * The plan slug arrives in the access token's own claims, so naming a tier
 * costs no network call. This is a port of ai-api-usage-tracker's
 * `describeChatGPTPlanType` — the richest of the mappings in play, and the one
 * that already distinguishes the business seats from the personal tiers that
 * collide with them on the same token.
 *
 * Allowance multipliers are only reported where the slug actually implies one.
 * The token carries no multiplier field, so a tier whose allowance is not
 * derivable from its name is left null rather than guessed.
 *
 * This is a leaf module: pure functions, no I/O, no imports.
 */

export interface CodexPlanDescription {
  /** The vendor slug verbatim, or null when absent. */
  slug: string | null
  /** Human-facing label, e.g. "ChatGPT Pro". Em dash when unknown. */
  label: string
  /** Allowance multiplier where the slug implies one, e.g. "20x". */
  multiplier: string | null
  /** Monthly list price where known, e.g. "$200/mo". */
  price: string | null
}

/**
 * Collapse a vendor plan slug to a comparable form.
 *
 * The admin roster spells a tier as one token ("chatgptteamplan") while the
 * token claim uses the bare word ("team"). Both must normalise to the same
 * form, so the prefix is stripped with or without a separator.
 */
export function normalizeCodexPlanSlug(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const normalized = value
    .trim()
    .replace(/^chatgpt[\s_-]*/i, "")
    .replace(/[\s_-]+/g, " ")
    .replace(/plan$/, "")
    .trim()
    .toLowerCase()
  return normalized || null
}

export function describeCodexPlan(value: string | null | undefined): CodexPlanDescription {
  const slug = typeof value === "string" && value.trim() ? value : null
  const plan = normalizeCodexPlanSlug(value)
  if (plan == null) return { slug: null, label: "—", multiplier: null, price: null }

  const described = describeNormalized(plan)
  if (described) return { slug, ...described }

  return { slug, label: titleCasePlan(value), multiplier: null, price: null }
}

type PlanFacts = Omit<CodexPlanDescription, "slug">

function describeNormalized(plan: string): PlanFacts | null {
  if (plan === "plus") return { label: "ChatGPT Plus", multiplier: "1x", price: "$20/mo" }
  if (plan === "team" || plan.startsWith("team ")) {
    return { label: "ChatGPT Team", multiplier: "1x", price: "$25/mo" }
  }

  const business = describeBusinessSeat(plan)
  if (business) return business

  if (isLegacyProPlan(plan)) return { label: "ChatGPT Pro (legacy)", multiplier: "5x", price: "$100/mo" }
  if (isCurrentProPlan(plan)) return { label: "ChatGPT Pro", multiplier: "20x", price: "$200/mo" }
  if (plan === "prolite" || plan === "pro lite") {
    return { label: "ChatGPT Pro Lite", multiplier: "5x", price: "$100/mo" }
  }
  if (plan === "go") return { label: "ChatGPT Go", multiplier: null, price: null }
  // Not a guess like an unknown tier's null: a free seat's Codex allowance is
  // a sliver next to Plus, and every model but the smallest refuses it.
  if (plan === "free") return { label: "ChatGPT Free", multiplier: "~0x", price: null }
  return null
}

/**
 * "self_serve_business_prolite" is the vendor's name for the 5x BUSINESS seat,
 * not the personal Pro Lite tier matched on the same token further down. $125
 * is the monthly price ($100 annual); every tier here is priced monthly.
 */
function describeBusinessSeat(plan: string): PlanFacts | null {
  if (!/(^| )business( |$)/.test(plan)) return null
  if (plan.includes("prolite") || plan.includes("pro lite") || plan.includes("premium")) {
    return { label: "ChatGPT Business Premium", multiplier: "5x", price: "$125/mo" }
  }
  if (plan.includes("standard")) {
    return { label: "ChatGPT Business Standard", multiplier: "1x", price: "$25/mo" }
  }
  // A bare "business" names the workspace, not the seat, and the seats are 5x
  // apart — so it stays unpriced rather than guessing which one this is.
  return { label: "ChatGPT Business", multiplier: null, price: null }
}

function isLegacyProPlan(plan: string): boolean {
  return plan === "pro 5x"
    || plan === "pro 100"
    || plan === "pro legacy"
    || plan === "legacy pro"
    || plan === "legacy pro 5x"
    || plan === "pro legacy 5x"
}

function isCurrentProPlan(plan: string): boolean {
  return plan === "pro" || plan === "pro 20x" || plan === "pro 200"
}

function titleCasePlan(value: string | null | undefined): string {
  const normalized = value?.trim().replace(/[\s_-]+/g, " ") ?? ""
  if (!normalized) return "—"
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}
