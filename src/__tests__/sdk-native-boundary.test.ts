import { describe, expect, it } from "bun:test"
import { join } from "node:path"

const control = process.env.SDK_BOUNDARY_CONTROL
if (control === "1" || control === "cleanup") {
  // Fresh worker only. The opt-out and post-file teardown must both reach the
  // real resolver, whose exec is intercepted before any child can be created.
  const { installSdkMock, MOCK_CLAUDE_EXECUTABLE, sdkMockQuery } = await import("./sdkMock")
  if (control === "1") installSdkMock(() => ({ query: () => { throw new Error("Control must not query") } }),
    "sdk-native-boundary real resolver control", { nativeClaude: true })
  const models = await import("../proxy/models")
  it("keeps the real resolver behind the dedicated native opt-out or file teardown", async () => {
    if (control === "cleanup") {
      const sdk = await import("@anthropic-ai/claude-agent-sdk")
      expect(sdk.query === sdkMockQuery).toBe(true)
      expect(() => sdk.query({ prompt: "must not execute" })).toThrow("before any test file installed")
    }
    const path = await models.resolveClaudeExecutableAsync().catch(() => null)
    expect(path).not.toBe(MOCK_CLAUDE_EXECUTABLE)
    // The worker preload additionally requires exactly one trapped exec.
  })
} else if (control === "stores") {
  const { installSdkMock } = await import("./sdkMock")
  installSdkMock(() => ({ query: () => { throw new Error("Store control must not query") } }), "default store control")
  const tokens = await import("../proxy/tokenRefresh")
  it("injects the empty store into real token helpers with lexical defaults", async () => {
    expect(await tokens.ensureFreshToken()).toBe(false)
    expect(await tokens.refreshOAuthToken()).toBe(false)
    expect(await tokens.getStoredPlanFields()).toEqual({})
    expect(await tokens.getAuthRenewalStatus()).toEqual({ renewalRequiredSoon: false })
    try {
      tokens.startBackgroundRefresh()
      await new Promise(resolve => setTimeout(resolve, 0))
    } finally { tokens.stopBackgroundRefresh() }
    const store = tokens.createPlatformCredentialStore()
    expect(await store.read()).toBeNull()
    await expect(store.write({ claudeAiOauth: { accessToken: "fixture", refreshToken: "fixture", expiresAt: 0 } })).rejects.toThrow("must not write credentials")
  })
} else {
  const root = join(import.meta.dir, "../..")
  const trap = join(import.meta.dir, "fixtures/sdk-native-trap.ts")
  const firstProxy = join(import.meta.dir, "proxy-system-reminder-preservation.test.ts")
  const modelSelection = join(import.meta.dir, "proxy-subagent-model-selection.test.ts")
  function worker(files: string[], mode = "0", pattern?: string) {
    const result = Bun.spawnSync({ cmd: [process.execPath, "test", "--preload", trap,
      ...(pattern ? ["--test-name-pattern", pattern] : []), ...files], cwd: root,
      env: { ...process.env, SDK_BOUNDARY_CONTROL: mode }, stdout: "pipe", stderr: "pipe" })
    const output = Buffer.from(result.stdout).toString() + Buffer.from(result.stderr).toString()
    expect(result.exitCode, output).toBe(0)
    expect(output).toContain('"actualNativeChildren":0,"actualNetworkCalls":0')
    return output
  }
  describe("SDK-mocked HTTP native boundary", () => {
    it("runs the first proxy regression without native lookup, auth, credentials or network", () => {
      expect(worker([firstProxy])).toContain('"attempts":[]')
    })
    for (const [label, files] of [
      ["SDK first", [firstProxy, modelSelection]],
      ["custom models first", [modelSelection, firstProxy]],
    ] as const) {
      it(`keeps per-file model and auth behavior when loading ${label}`, () => {
        const output = worker([...files])
        expect(output).toContain('"attempts":[]')
        // Check the runner actually honored the requested order.
        expect(output.indexOf(files[0]!.split("/").at(-1)!)).toBeLessThan(output.indexOf(files[1]!.split("/").at(-1)!))
      }, 30_000)
    }
    it("proves the native trap and real resolver opt-out are live", () => {
      expect(worker([import.meta.path], "1")).toContain('"attempts":["exec"]')
    })
    it("keeps default token-store helpers offline", () => {
      expect(worker([import.meta.path], "stores")).toContain('"attempts":[]')
    })
    it("clears an SDK replaced during a test and a file that previously only used setSdkMock", () => {
      const output = worker([join(import.meta.dir, "proxy-polytoken.test.ts"),
        join(import.meta.dir, "pluginless-opencode-warning.test.ts"), import.meta.path], "cleanup",
        "preserves signed thinking|records a diagnostic|keeps the real resolver")
      expect(output).toContain('"attempts":["exec"]')
    }, 30_000)
  })
}
