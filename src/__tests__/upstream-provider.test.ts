import { describe, expect, it } from "bun:test"
import { CHATGPT_MODELS, providerForModel } from "../proxy/upstream/provider"

describe("providerForModel", () => {
  it("routes every advertised ChatGPT model to chatgpt", () => {
    expect(CHATGPT_MODELS.filter(model => providerForModel(model) !== "chatgpt")).toEqual([])
  })

  it("routes OpenAI models it does not list to chatgpt too", () => {
    for (const model of ["gpt-5.4-nano", "gpt-7", "GPT-5.4-Nano ", "chatgpt-4o-latest", "codex-mini-latest", "o3", "o4-mini", "o1"]) {
      expect(providerForModel(model)).toBe("chatgpt")
    }
  })

  it("keeps everything that is not an OpenAI model on claude", () => {
    for (const model of [undefined, null, "", "claude-sonnet-4-5", "sonnet", "opus", "opus-4", "haiku", "claude-gpt-bridge", "gemini-3-pro", "omni", "codexa"]) {
      expect(providerForModel(model)).toBe("claude")
    }
  })
})
