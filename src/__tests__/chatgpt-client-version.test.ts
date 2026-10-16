/**
 * The Codex client version the ChatGPT model catalog is read for: the latest
 * release, from npm with GitHub as the fallback, never below the pinned one.
 */
import { describe, expect, it } from "bun:test"
import {
  GITHUB_LATEST_RELEASE_URL,
  NPM_DIST_TAGS_URL,
  compareReleaseVersions,
  createCodexClientVersion,
  parseGitHubRelease,
  parseNpmDistTags,
} from "../proxy/chatgpt/clientVersion"

const NOW = 1_800_000_000_000
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

type Responder = (url: string) => Response | Promise<Response>

function lookupFetch(respond: Responder) {
  const calls: Array<{ url: string; headers: Headers }> = []
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    calls.push({ url, headers: new Headers(init?.headers) })
    return Promise.resolve(respond(url))
  }) as typeof fetch
  return { fetchImpl, calls }
}

const NPM_TAGS = { latest: "0.159.1", alpha: "0.161.0-alpha.2", "linux-x64": "0.159.1-linux-x64" }
const GITHUB_RELEASE = { tag_name: "rust-v0.159.1", name: "0.159.1", draft: false, prerelease: false }

describe("parsers", () => {
  it("reads npm's latest dist-tag and ignores prerelease tags", () => {
    expect(parseNpmDistTags(NPM_TAGS)).toBe("0.159.1")
    expect(parseNpmDistTags({ latest: "0.161.0-alpha.2" })).toBeNull()
    for (const body of [null, "x", [], {}, { latest: 159 }]) expect(parseNpmDistTags(body)).toBeNull()
  })

  it("reads the version from a GitHub rust-v tag, and never from a draft or prerelease", () => {
    expect(parseGitHubRelease(GITHUB_RELEASE)).toBe("0.159.1")
    expect(parseGitHubRelease({ tag_name: "other", name: "0.158.0" })).toBe("0.158.0")
    expect(parseGitHubRelease({ ...GITHUB_RELEASE, prerelease: true })).toBeNull()
    expect(parseGitHubRelease({ ...GITHUB_RELEASE, draft: true })).toBeNull()
    expect(parseGitHubRelease({ message: "API rate limit exceeded" })).toBeNull()
  })

  it("compares release versions numerically", () => {
    expect(compareReleaseVersions("0.159.1", "0.155.0")).toBe(1)
    expect(compareReleaseVersions("0.99.0", "0.100.0")).toBe(-1)
    expect(compareReleaseVersions("1.0.0", "1.0.0")).toBe(0)
  })
})

describe("createCodexClientVersion", () => {
  it("uses the pinned version until a lookup has succeeded", () => {
    const version = createCodexClientVersion({ pinned: "0.155.0", fetchImpl: lookupFetch(() => json(NPM_TAGS)).fetchImpl, now: () => NOW })
    expect(version.current()).toBe("0.155.0")
    expect(version.view()).toEqual({ version: "0.155.0", source: "pinned", checkedAt: null })
  })

  it("takes npm's latest release, without sending any credential", async () => {
    const { fetchImpl, calls } = lookupFetch(() => json(NPM_TAGS))
    const logs: string[] = []
    const version = createCodexClientVersion({ pinned: "0.155.0", fetchImpl, now: () => NOW, log: m => logs.push(m) })
    await version.refresh()
    expect(calls.map(call => call.url)).toEqual([NPM_DIST_TAGS_URL])
    expect(calls[0]!.headers.get("authorization")).toBeNull()
    expect(version.view()).toEqual({ version: "0.159.1", source: "npm", checkedAt: NOW })
    expect(logs.some(m => m.includes("0.155.0 -> 0.159.1"))).toBe(true)
  })

  it("falls back to GitHub releases when npm fails", async () => {
    const { fetchImpl, calls } = lookupFetch(url => (url === NPM_DIST_TAGS_URL ? json({}, 503) : json(GITHUB_RELEASE)))
    const version = createCodexClientVersion({ pinned: "0.155.0", fetchImpl, now: () => NOW })
    await version.refresh()
    expect(calls.map(call => call.url)).toEqual([NPM_DIST_TAGS_URL, GITHUB_LATEST_RELEASE_URL])
    expect(version.view()).toMatchObject({ version: "0.159.1", source: "github" })
  })

  it("never goes below the pinned version", async () => {
    const version = createCodexClientVersion({ pinned: "0.155.0", fetchImpl: lookupFetch(() => json({ latest: "0.150.0" })).fetchImpl, now: () => NOW })
    await version.refresh()
    expect(version.view()).toEqual({ version: "0.155.0", source: "pinned", checkedAt: NOW })
  })

  it("keeps the last version through a failed lookup, retries hourly, and re-checks daily", async () => {
    let at = NOW
    let answer: Responder = () => json(NPM_TAGS)
    const { fetchImpl, calls } = lookupFetch(url => answer(url))
    const version = createCodexClientVersion({ pinned: "0.155.0", fetchImpl, now: () => at })
    await version.refresh()
    expect(version.current()).toBe("0.159.1")

    at = NOW + DAY - 1
    expect(version.refresh()).toBeUndefined()

    at = NOW + DAY
    answer = () => { throw new Error("offline") }
    await version.refresh()
    expect(calls).toHaveLength(3)
    expect(version.current()).toBe("0.159.1")

    at = NOW + DAY + HOUR - 1
    expect(version.refresh()).toBeUndefined()

    at = NOW + DAY + HOUR
    answer = () => json({ latest: "0.160.0" })
    await version.refresh()
    expect(version.view()).toEqual({ version: "0.160.0", source: "npm", checkedAt: NOW + DAY + HOUR })
  })

  it("falls back to the pinned version when every source fails from the start", async () => {
    const fetchImpl = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch
    const version = createCodexClientVersion({ pinned: "0.155.0", fetchImpl, now: () => NOW })
    await version.refresh()
    expect(version.view()).toEqual({ version: "0.155.0", source: "pinned", checkedAt: null })
  })

  it("shares one lookup between concurrent refreshes", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const { fetchImpl, calls } = lookupFetch(async () => { await gate; return json(NPM_TAGS) })
    const version = createCodexClientVersion({ pinned: "0.155.0", fetchImpl, now: () => NOW })
    const first = version.refresh()
    expect(version.refresh()).toBe(first!)
    release()
    await first
    expect(calls).toHaveLength(1)
  })
})
