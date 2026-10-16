/**
 * Test for degraded health when auth status returns null.
 *
 * Separated from proxy-async-ops.test.ts because it needs to mock
 * ../proxy/models before server.ts imports it — preventing races
 * with parallel test files that share the module singleton.
 */

import { describe, it, expect, mock } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
// Static import of the real resolveSdkModelDefaults BEFORE mock.module(). This
// pulls the real impl (the static import is hoisted) so we can pass it through
// the mocked module unchanged. mock.module() in Bun is process-global; if we
// stubbed it as () => ({}) it would leak to proxy-env-stripping.test.ts running
// in parallel and break its model-pin assertions.
import { resolveSdkModelDefaults } from "../proxy/models"

mock.module("../proxy/models", () => ({
  getClaudeAuthStatusAsync: async () => null,
  resolveClaudeExecutableAsync: async () => "claude",
  resolveSdkModelDefaults,
  mapModelToClaudeModel: (model: string) => {
    if (model.toLowerCase().includes("opus")) return "opus"
    if (model.toLowerCase().includes("haiku")) return "haiku"
    return "sonnet"
  },
  getAuthCacheInfo: () => ({ lastCheckedAt: 0, lastSuccessAt: 0, isFailure: false }),
  hasExtendedContext: () => false,
  stripExtendedContext: (m: string) => m,
  isClosedControllerError: (e: unknown) => e instanceof Error && e.message.includes("controller is closed"),
  recordExtendedContextUnavailable: () => {},
  isExtendedContextKnownUnavailable: () => false,
  resetCachedClaudeAuthStatus: () => {},
  resetCachedClaudePath: () => {},
  expireAuthStatusCache: () => {},
  resetExtendedContextUnavailable: () => {},
}))

const { createProxyServer } = await import("../proxy/server")

describe("proxy health degraded", () => {
  it("returns degraded health when auth status is null", async () => {
    const originalClaudeProxyPassthrough = process.env.CLAUDE_PROXY_PASSTHROUGH
    const originalMeridianPassthrough = process.env.MERIDIAN_PASSTHROUGH
    process.env.CLAUDE_PROXY_PASSTHROUGH = "0"
    process.env.MERIDIAN_PASSTHROUGH = "0"

    try {
      const { app } = createProxyServer({ port: 0, host: "127.0.0.1" })
      const response = await app.fetch(new Request("http://localhost/health"))
      const body = await response.json() as Record<string, unknown>

      expect(response.status).toBe(200)
      expect(body.status).toBe("degraded")
      expect(body.error).toBe("Could not verify auth status")
      expect(body.mode).toBe("internal")
      expect(typeof body.version).toBe("string")
    } finally {
      if (originalClaudeProxyPassthrough === undefined) delete process.env.CLAUDE_PROXY_PASSTHROUGH
      else process.env.CLAUDE_PROXY_PASSTHROUGH = originalClaudeProxyPassthrough
      if (originalMeridianPassthrough === undefined) delete process.env.MERIDIAN_PASSTHROUGH
      else process.env.MERIDIAN_PASSTHROUGH = originalMeridianPassthrough
    }
  })
})

describe("proxy health on an instance serving ChatGPT", () => {
  const NOW = Date.now()
  const seat = (n: number, extra: Record<string, unknown> = {}) => ({
    accountId: `workspace-${n}`, accountUserId: `user-${n}__workspace-${n}`, email: `seat${n}@example.test`,
    refreshToken: `rt-${n}`, accessToken: `at-${n}`, expiresAt: NOW + 3_600_000, addedAt: 1, lastUsed: 1, ...extra,
  })
  const withPool = async (
    accounts: unknown[],
    run: (fetch: (path: string) => Promise<Response>) => Promise<void>,
    profiles?: Array<{ id: string; claudeConfigDir: string }>,
  ) => {
    const dir = mkdtempSync(join(tmpdir(), "health-chatgpt-"))
    const poolPath = join(dir, "oc-codex-multi-auth-accounts.json")
    writeFileSync(poolPath, JSON.stringify({ version: 3, accounts, activeIndex: 0 }))
    process.env.MERIDIAN_CHATGPT_CREDENTIALS = "follow-external"
    process.env.MERIDIAN_CODEX_POOL_PATH = poolPath
    try {
      const { app } = createProxyServer({ port: 0, host: "127.0.0.1", ...(profiles ? { profiles } : {}) })
      await run(async path => app.fetch(new Request(`http://localhost${path}`)))
    } finally {
      delete process.env.MERIDIAN_CHATGPT_CREDENTIALS
      delete process.env.MERIDIAN_CODEX_POOL_PATH
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it("is healthy when it serves ChatGPT alone and a seat can take a turn", async () => {
    await withPool([seat(0), seat(1)], async fetch => {
      const response = await fetch("/health")
      const body = await response.json() as Record<string, any>
      expect(response.status).toBe(200)
      expect(body.status).toBe("healthy")
      expect(body.error).toBeUndefined()
      expect(body.backends).toEqual({ chatgpt: { status: "healthy" } })
      expect(body.chatgpt).toMatchObject({ serving: true, accounts: 2, eligible: 2, ready: 2 })
      expect(typeof body.version).toBe("string")
      expect(body.mode).toBe("internal")
    })
  })

  it("is ready when it serves ChatGPT alone", async () => {
    await withPool([seat(0)], async fetch => {
      const response = await fetch("/readyz?verbose")
      expect(response.status).toBe(200)
      expect(await response.text()).not.toContain("claude-executable")
    })
  })

  it("is unhealthy, with a 503, when no seat can serve until somebody acts", async () => {
    await withPool([seat(0, { enabled: false }), seat(1, { enabled: false })], async fetch => {
      const response = await fetch("/health")
      const body = await response.json() as Record<string, any>
      expect(response.status).toBe(503)
      expect(body.status).toBe("unhealthy")
      expect(body.error).toContain("2 disabled")
    })
  })

  it("is degraded when every seat is cooling down", async () => {
    await withPool([seat(0, { coolingDownUntil: NOW + 600_000 })], async fetch => {
      const response = await fetch("/health")
      const body = await response.json() as Record<string, any>
      expect(response.status).toBe(200)
      expect(body.status).toBe("degraded")
      expect(body.error).toContain("1 cooling down")
    })
  })

  it("reports both backends when it serves Claude too, and names the one that is failing", async () => {
    const claudeDir = mkdtempSync(join(tmpdir(), "health-claude-"))
    try {
      await withPool([seat(0)], async fetch => {
        const response = await fetch("/health")
        const body = await response.json() as Record<string, any>
        expect(response.status).toBe(200)
        expect(body.status).toBe("degraded")
        expect(body.error).toBe("Claude: Could not verify auth status")
        expect(body.backends).toEqual({
          claude: { status: "degraded", error: "Could not verify auth status" },
          chatgpt: { status: "healthy" },
        })
      }, [{ id: "work", claudeConfigDir: claudeDir }])
    } finally {
      rmSync(claudeDir, { recursive: true, force: true })
    }
  })
})
