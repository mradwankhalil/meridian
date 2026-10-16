/**
 * The Codex CLI version the model catalog is read for: the newest Codex
 * release, looked up where Codex itself is published.
 *
 * The backend answers `/codex/models` for the `client_version` it is given
 * and leaves out every model released for a newer Codex. Measured
 * 2026-09-29: `client_version=0.155.0` listed eight models, and 0.159.1 (the
 * release of that day) listed gpt-6.1-sol as well. A pinned version therefore
 * hides each new model until someone raises it. The backend does not refuse
 * a version newer than any release: 1.0.0 and 99.0.0 got the same catalog as
 * 0.159.1. A malformed one gets 400 "Invalid client_version format", and none
 * at all gets 400 as well. So the version asked for is the real latest
 * release, never a made-up high number that happens to work today.
 *
 * Sources, in order:
 *   1. the npm registry's `latest` dist-tag of `@openai/codex`, the package
 *      `npm i -g @openai/codex` installs. One small unauthenticated JSON read.
 *   2. the GitHub releases API for openai/codex (`rust-v<version>` tags),
 *      used only when npm fails. Unauthenticated, 60 reads an hour per IP.
 * Only a plain `major.minor.patch` is taken; alpha dist-tags and prereleases
 * are never asked for. A found version older than `pinned` is ignored, so the
 * lookup can raise the version but never lower it below a known-good one.
 *
 * Checked at most once a day. A failed check keeps the last version found
 * and tries again in an hour; until one has succeeded, `pinned` is used.
 * Neither read carries a credential.
 */

export const NPM_DIST_TAGS_URL = "https://registry.npmjs.org/-/package/@openai/codex/dist-tags"
export const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/openai/codex/releases/latest"

const CHECK_TTL_MS = 24 * 60 * 60_000
const FAILED_CHECK_RETRY_MS = 60 * 60_000
const TIMEOUT_MS = 10_000
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/

export type CodexVersionSource = "pinned" | "npm" | "github"

export interface CodexClientVersionView {
  version: string
  source: CodexVersionSource
  /** When a lookup last succeeded; null while the pinned version stands in. */
  checkedAt: number | null
}

export interface CodexClientVersion {
  current(): string
  view(): CodexClientVersionView
  /** Look the latest release up when due. Concurrent calls share one lookup; undefined when not due. */
  refresh(): Promise<void> | undefined
}

/** -1, 0 or 1 for two `major.minor.patch` strings. */
export function compareReleaseVersions(a: string, b: string): number {
  const left = a.split(".").map(Number)
  const right = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function release(value: unknown): string | null {
  return typeof value === "string" && RELEASE_VERSION.test(value) ? value : null
}

/** The `latest` dist-tag of an npm dist-tags body, when it is a plain release. */
export function parseNpmDistTags(body: unknown): string | null {
  return release(record(body)?.latest)
}

/** The version of a GitHub release body: `rust-v0.159.1` -> 0.159.1. Drafts and prereleases count as none. */
export function parseGitHubRelease(body: unknown): string | null {
  const raw = record(body)
  if (!raw || raw.draft === true || raw.prerelease === true) return null
  const tag = typeof raw.tag_name === "string" ? raw.tag_name.replace(/^rust-v/, "") : null
  return release(tag) ?? release(raw.name)
}

export interface CodexClientVersionOptions {
  /** The version used until a lookup succeeds, and the floor for any found. */
  pinned: string
  fetchImpl?: typeof fetch
  now?: () => number
  log?: (message: string) => void
}

export function createCodexClientVersion(options: CodexClientVersionOptions): CodexClientVersion {
  const { pinned } = options
  const doFetch = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const log = options.log ?? (() => {})
  let state: CodexClientVersionView = { version: pinned, source: "pinned", checkedAt: null }
  let lastAttempt: number | null = null
  let running: Promise<void> | undefined

  const read = async (url: string, parse: (body: unknown) => string | null, accept: string): Promise<string | null> => {
    try {
      const response = await doFetch(url, {
        headers: { accept, "user-agent": "meridian" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        log(`[PROXY] Codex version lookup: ${url} answered HTTP ${response.status}`)
        return null
      }
      return parse(await response.json())
    } catch (error) {
      log(`[PROXY] Codex version lookup: ${url} failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  const lookup = async (): Promise<{ version: string; source: CodexVersionSource } | null> => {
    const fromNpm = await read(NPM_DIST_TAGS_URL, parseNpmDistTags, "application/json")
    if (fromNpm) return { version: fromNpm, source: "npm" }
    const fromGitHub = await read(GITHUB_LATEST_RELEASE_URL, parseGitHubRelease, "application/vnd.github+json")
    if (fromGitHub) return { version: fromGitHub, source: "github" }
    return null
  }

  return {
    current: () => state.version,
    view: () => ({ ...state }),
    refresh() {
      if (running) return running
      const at = now()
      if (state.checkedAt !== null && at - state.checkedAt < CHECK_TTL_MS) return undefined
      if (lastAttempt !== null && at - lastAttempt < FAILED_CHECK_RETRY_MS) return undefined
      lastAttempt = at
      running = lookup()
        .then(found => {
          if (!found) {
            log(`[PROXY] Codex version lookup failed; catalog reads keep client_version=${state.version} (${state.source})`)
            return
          }
          const version = compareReleaseVersions(found.version, pinned) < 0 ? pinned : found.version
          if (version !== state.version) log(`[PROXY] Codex catalog client_version ${state.version} -> ${version} (latest release per ${found.source}: ${found.version})`)
          state = { version, source: version === found.version ? found.source : "pinned", checkedAt: at }
        })
        .finally(() => { running = undefined })
      return running
    },
  }
}

/** A version that is never looked up: what the catalog uses when given none. */
export function fixedCodexClientVersion(version: string): CodexClientVersion {
  const view: CodexClientVersionView = { version, source: "pinned", checkedAt: null }
  return { current: () => version, view: () => ({ ...view }), refresh: () => undefined }
}
