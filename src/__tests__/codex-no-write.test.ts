/**
 * The safety invariant for the Codex integration.
 *
 * ChatGPT refresh tokens are SINGLE-USE. If Meridian ever exchanged one, it
 * would invalidate the copy oc-codex-multi-auth holds and permanently break
 * that account with `refresh_token_reused`, requiring the operator to log in
 * again by hand. The same applies to writing the pool file: it is another
 * process's state, and Meridian is only a reader of it.
 *
 * These are the tests that make that guarantee structural rather than a matter
 * of remembering. They scan the integration's own source, so a future change
 * that introduces a write primitive or a token-endpoint call fails here even if
 * nothing else notices.
 */
import { describe, test, expect } from "bun:test"
import { readFileSync, readdirSync, writeFileSync, statSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { loadCodexPool } from "../proxy/codex/pool"

const CODEX_DIR = join(import.meta.dir, "..", "proxy", "codex")

function codexSources(): Array<{ name: string; text: string }> {
  return readdirSync(CODEX_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({ name, text: readFileSync(join(CODEX_DIR, name), "utf-8") }))
}

/**
 * Strip block and line comments so prose about writing does not trip the scan.
 *
 * The `[^:]` guard matters: without it the line-comment rule eats the `//` in
 * `https://...` and everything after it, which would silently blind every URL
 * assertion below.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

describe("the Codex integration cannot write the pool", () => {
  test("scans a non-empty set of source files", () => {
    // Guards the scan itself: a rename that emptied this list would make every
    // assertion below vacuously pass.
    const names = codexSources().map((f) => f.name)
    expect(names.length).toBeGreaterThanOrEqual(6)
    expect(names).toContain("pool.ts")
    expect(names).toContain("usage.ts")
  })

  test("imports no filesystem write primitive", () => {
    const forbidden = [
      "writeFile", "appendFile", "createWriteStream", "copyFile",
      "rename", "unlink", "rmSync", "rm(", "truncate", "mkdtemp", "chmod",
    ]
    for (const { name, text } of codexSources()) {
      const source = withoutComments(text)
      for (const token of forbidden) {
        expect(`${name}:${source.includes(token)}`).toBe(`${name}:false`)
      }
    }
  })

  test("imports only read primitives from node:fs", () => {
    for (const { name, text } of codexSources()) {
      for (const match of withoutComments(text).matchAll(/import\s*\{([^}]*)\}\s*from\s*"node:fs"/g)) {
        const imported = (match[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
        for (const symbol of imported) {
          expect(`${name}:${symbol}`).toMatch(/:(existsSync|readFileSync|readdirSync|statSync)$/)
        }
      }
    }
  })

  test("leaves the pool file byte-identical after a read", () => {
    const dir = join(tmpdir(), `meridian-codex-nowrite-${process.pid}`)
    const file = join(dir, "oc-codex-multi-auth-accounts.json")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })

    const contents = JSON.stringify({
      version: 3,
      activeIndex: 0,
      accounts: [{
        accountId: "aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
        accountUserId: "user-ABC__aaaaaaaa-1111-4111-8111-aaaaaaa1b2c3",
        email: "someone@example.com",
        refreshToken: "synthetic-refresh-token",
        accessToken: "synthetic.access.token",
        addedAt: 1,
        lastUsed: 1,
      }],
    })
    writeFileSync(file, contents, { mode: 0o600 })

    const before = { hash: createHash("sha256").update(contents).digest("hex"), stat: statSync(file) }
    const saved = process.env.MERIDIAN_CODEX_POOL_PATH
    process.env.MERIDIAN_CODEX_POOL_PATH = file
    try {
      expect(loadCodexPool()?.accounts).toHaveLength(1)
      const after = readFileSync(file, "utf-8")
      expect(createHash("sha256").update(after).digest("hex")).toBe(before.hash)
      expect(statSync(file).mtimeMs).toBe(before.stat.mtimeMs)
      // The refresh token must not even be projected into Meridian's own model.
      expect(Object.keys(loadCodexPool()?.accounts[0] ?? {})).not.toContain("refreshToken")
    } finally {
      if (saved !== undefined) process.env.MERIDIAN_CODEX_POOL_PATH = saved
      else delete process.env.MERIDIAN_CODEX_POOL_PATH
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("the Codex integration cannot refresh a token", () => {
  test("never references a token endpoint", () => {
    for (const { name, text } of codexSources()) {
      const source = withoutComments(text)
      expect(`${name}:${source.includes("auth.openai.com")}`).toBe(`${name}:false`)
      expect(`${name}:${source.includes("oauth/token")}`).toBe(`${name}:false`)
      expect(`${name}:${source.includes("grant_type")}`).toBe(`${name}:false`)
      expect(`${name}:${source.includes("refresh_token")}`).toBe(`${name}:false`)
    }
  })

  test("issues no mutating HTTP method", () => {
    for (const { name, text } of codexSources()) {
      const source = withoutComments(text)
      for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(`${name}:${source.includes(`"${verb}"`)}`).toBe(`${name}:false`)
      }
    }
  })

  test("addresses only the fixed ChatGPT origin", () => {
    for (const { name, text } of codexSources()) {
      for (const match of withoutComments(text).matchAll(/https:\/\/[a-z0-9.-]+/gi)) {
        // The one non-request URL is the JWT claim namespace, which is an
        // identifier rather than an address.
        expect(`${name}:${match[0]}`).toMatch(/:(https:\/\/chatgpt\.com|https:\/\/api\.openai\.com)$/)
      }
    }
  })
})
