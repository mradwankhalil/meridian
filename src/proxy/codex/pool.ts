/**
 * Read-only reader for the oc-codex-multi-auth account pool.
 *
 * The pool file belongs to the oc-codex-multi-auth OpenCode plugin. Meridian
 * reads it to show ChatGPT accounts on the dashboard and does nothing else with
 * it.
 *
 * THIS MODULE MUST NEVER WRITE THE POOL, AND NOTHING DOWNSTREAM MAY REFRESH A
 * TOKEN FROM IT. ChatGPT refresh tokens are single-use: exchanging one
 * invalidates the copy oc-codex holds and permanently breaks that account with
 * `refresh_token_reused`, requiring a manual re-login. Only `existsSync` and
 * `readFileSync` are imported here, so there is no write primitive in scope
 * even by accident. codex-no-write.test.ts pins this.
 *
 * Reading is safe to do concurrently with the plugin: it persists via a
 * temp-file write followed by a rename, so a reader observes either the
 * previous complete document or the new one, never a partial file.
 *
 * Path resolution is deliberately simpler than the plugin's. oc-codex can scope
 * a pool per project (its `perProjectAccounts` defaults to true) by walking up
 * from the process CWD. Meridian is a long-lived server shared by clients
 * working in many different projects, so it has no single project to scope to;
 * it reads the global pool. If the global pool is absent, the integration is
 * simply reported as not present.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { CodexPoolError } from "./types"

const POOL_FILE_NAME = "oc-codex-multi-auth-accounts.json"
const SUPPORTED_VERSION = 3

export interface CodexPoolAccount {
  /** NOT unique across accounts — always pair it with accountUserId. */
  accountId: string | null
  /** The unique identity key: one real pool shares an accountId across users. */
  accountUserId: string | null
  organizationId: string | null
  email: string | null
  /** Usually absent: oc-codex stopped generating labels to avoid leaking email. */
  accountLabel: string | null
  /** Frequently absent on older records — prefer the token's own plan claim. */
  planType: string | null
  /**
   * Held so usage can be fetched for this account. NEVER log it, print it,
   * include it in an HTTP response, or write it anywhere.
   */
  accessToken: string | null
  expiresAt: number | null
  enabled: boolean
}

export interface CodexPool {
  /** The file this pool was read from, for diagnostics. */
  path: string
  accounts: CodexPoolAccount[]
}

/**
 * Resolve the pool path.
 *
 * Resolved per call rather than frozen at import time so tests can redirect it,
 * mirroring how settings.ts handles MERIDIAN_CONFIG_DIR.
 */
export function codexPoolPath(): string {
  const override = process.env.MERIDIAN_CODEX_POOL_PATH
  return override ? override : join(homedir(), ".opencode", POOL_FILE_NAME)
}

export interface CodexPoolResult {
  pool: CodexPool | null
  error: CodexPoolError | null
}

/**
 * Read the pool, saying which way it failed. Never throws.
 *
 * The distinction is what lets the dashboard stay silent when oc-codex simply
 * is not installed while still reporting a pool that is present and broken.
 */
export function readCodexPool(): CodexPoolResult {
  const path = codexPoolPath()

  let raw: string
  try {
    if (!existsSync(path)) return { pool: null, error: "not_configured" }
    raw = readFileSync(path, "utf-8")
  } catch {
    return { pool: null, error: "pool_unreadable" }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { pool: null, error: "pool_unreadable" }
  }

  const root = asRecord(parsed)
  if (!root) return { pool: null, error: "invalid_pool" }
  if (root.version !== SUPPORTED_VERSION) return { pool: null, error: "invalid_pool" }
  if (!Array.isArray(root.accounts)) return { pool: null, error: "invalid_pool" }

  const accounts: CodexPoolAccount[] = []
  for (const entry of root.accounts) {
    const account = toAccount(entry)
    if (account) accounts.push(account)
  }
  return { pool: { path, accounts }, error: null }
}

/** Read the pool. Returns null when it is absent or unreadable — never throws. */
export function loadCodexPool(): CodexPool | null {
  return readCodexPool().pool
}

/**
 * Name an account the way oc-codex's own surfaces do.
 *
 * Labels are not invented: upstream deliberately stopped generating them
 * because they leaked the email into places that mask it.
 */
export function codexAccountIdentity(
  account: { email: string | null; accountId: string | null },
): string {
  const suffix = account.accountId
    ? `id:${account.accountId.length > 6 ? account.accountId.slice(-6) : account.accountId}`
    : null
  if (account.email && suffix) return `${account.email}, ${suffix}`
  if (account.email) return account.email
  if (suffix) return suffix
  return "unknown account"
}

function toAccount(value: unknown): CodexPoolAccount | null {
  const raw = asRecord(value)
  if (!raw) return null

  const accountId = stringOrNull(raw.accountId)
  const accountUserId = stringOrNull(raw.accountUserId)
  const email = stringOrNull(raw.email)
  // An entry with no identity at all cannot be shown or scoped to, so it is
  // dropped rather than rendered as a nameless card.
  if (!accountId && !accountUserId && !email) return null

  return {
    accountId,
    accountUserId,
    organizationId: stringOrNull(raw.organizationId),
    email,
    accountLabel: stringOrNull(raw.accountLabel),
    planType: stringOrNull(raw.planType),
    accessToken: stringOrNull(raw.accessToken),
    expiresAt: finiteNumberOrNull(raw.expiresAt),
    enabled: raw.enabled === false ? false : true,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
