/**
 * Which provider serves a model.
 *
 * Pure: no I/O, no config, no network. The answer is needed before profile
 * resolution, session lookup and transcript work, because all of those are
 * Claude-shaped and a ChatGPT request must not enter them.
 *
 * `CHATGPT_MODELS` is what the gateway offers until it has read the backend's
 * own model catalog (chatgpt/catalog.ts), which then decides what /v1/models,
 * /providers and the Fallback Model choices offer. It is the catalog's listed
 * set as read on 2026-09-29, every id probed and served on a Pro and a Team
 * seat; ids the backend refuses for ChatGPT accounts (gpt-5.4 and older, the
 * codex-named ones, gpt-5.6-cyber, gpt-daybreak-red) are not on it, since
 * offering a model no seat can serve is the defect this list once had.
 *
 * Routing is wider on purpose: every id that names an OPENAI model resolves
 * to "chatgpt", listed or not. An unlisted
 * one (opencode picks its small model, e.g. gpt-5.4-nano, from models.dev
 * rather than from this list) used to resolve to "claude", where the Claude
 * path mapped it onto its sonnet fallback - an OpenAI request answered by
 * Claude. On ChatGPT it is either served or refused by the backend in OpenAI's
 * own terms, and either is the truth; a Claude answer is never the truth.
 *
 * Everything else still resolves to "claude": an absent model, a Claude one,
 * and any id that does not name an OpenAI model. The dispatcher consults this
 * only when a ChatGPT backend is enabled, so an instance without one keeps
 * translating GPT names onto Claude as before.
 */
import type { ProviderId } from "./backend"

export const CHATGPT_MODELS: readonly string[] = [
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-daybreak-blue-latest",
  "gpt-5.5",
]

/**
 * OpenAI's model families: `gpt-*`, `chatgpt-*`, `codex` / `codex-*` and the
 * `o<n>` reasoning series (o1, o3-mini, o4-mini, ...). Anchored at both ends
 * of the family token so a Claude or third-party id that merely contains one
 * (`claude-gpt-bridge`, `opus-4`) does not match.
 */
const OPENAI_MODEL_ID = /^(?:gpt-|chatgpt-|codex(?:-|$)|o\d+(?:-|$))/

export function isOpenAiModelId(model: string): boolean {
  return OPENAI_MODEL_ID.test(model.trim().toLowerCase())
}

export function providerForModel(model: string | null | undefined): ProviderId {
  if (typeof model !== "string") return "claude"
  return isOpenAiModelId(model) ? "chatgpt" : "claude"
}
