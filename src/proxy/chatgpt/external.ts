/**
 * follow-external: serve from the oc-codex-multi-auth store without owning it.
 *
 * The store belongs to the oc-codex-multi-auth opencode plugin, which
 * refreshes its tokens and writes rotated ones back. ChatGPT refresh tokens
 * are SINGLE-USE: any exchange Meridian made would invalidate the plugin's
 * copy and end that account until a human logs in again. So this module:
 *
 *   - imports `readFileSync` and `statSync` and no write primitive at all, so
 *     it cannot write the store, its `.lock`, `.transaction.lock` or
 *     `.refresh.lock` even by mistake (chatgpt-external.test.ts pins this);
 *   - never reads `refreshToken`, and never calls a token endpoint;
 *   - honours the owner's own state: `enabled: false`, `coolingDownUntil`,
 *     `quotaExhaustedUntil` and per-model `rateLimitResetTimes` all take a
 *     seat out of rotation exactly as they do for the plugin - except that a
 *     seat held back only by `quotaExhaustedUntil` is offered as a credits
 *     reserve (`reserveSeats`), served only once no seat has plan quota left;
 *   - re-reads the file whenever its mtime/size/inode change, so a token the
 *     owner rotated is picked up on the next request.
 *
 * An expired access token is reported, not repaired: the owner refreshes it
 * the next time opencode uses that account through `openai/`.
 */
import { readFileSync, statSync } from "node:fs"
import { codexPoolPath, type CodexPoolAccount, type CodexPoolResult } from "../codex/pool"
import type {
  ChatGptCredentialSource,
  ChatGptSeatView,
  SeatCredential,
  SeatUnavailableReason,
} from "./source"

/** A token this close to expiry is treated as expired: a turn can outlive it. */
const EXPIRY_SKEW_MS = 60_000
const SUPPORTED_VERSION = 3

interface ExternalAccount {
  accountUserId: string
  accountId: string | null
  email: string | null
  planType: string | null
  organizationId: string | null
  accessToken: string | null
  expiresAt: number | null
  enabled: boolean
  coolingDownUntil: number | null
  quotaExhaustedUntil: number | null
  rateLimitResetTimes: Record<string, number>
  /** Position in the store's own array, counting records this module skips, as `codex-list` does. */
  storeIndex: number
}

interface Snapshot {
  key: string
  accounts: ExternalAccount[]
  activeIndex: number
  activeIndexByFamily: Record<string, number>
  error: "not_configured" | "pool_unreadable" | "invalid_pool" | null
}

export interface ExternalSourceOptions {
  /** Defaults to `MERIDIAN_CODEX_POOL_PATH` or the plugin's global store. */
  path?: string
  now?: () => number
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}
const str = (v: unknown) => typeof v === "string" && v.length > 0 ? v : null
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null

function parseAccount(value: unknown, storeIndex: number): ExternalAccount | null {
  const raw = record(value)
  if (!raw) return null
  // The seat is the only safe key: one workspace `accountId` covers several
  // people in real pools, and serving by it hands one person's request to
  // another's credential. A record without a seat id cannot be served.
  const accountUserId = str(raw.accountUserId)
  if (!accountUserId) return null
  const limits: Record<string, number> = {}
  for (const [family, until] of Object.entries(record(raw.rateLimitResetTimes) ?? {})) {
    const at = num(until)
    if (at !== null) limits[family] = at
  }
  return {
    accountUserId,
    accountId: str(raw.accountId),
    email: str(raw.email),
    planType: str(raw.planType),
    organizationId: str(raw.organizationId),
    accessToken: str(raw.accessToken),
    expiresAt: num(raw.expiresAt),
    enabled: raw.enabled !== false,
    coolingDownUntil: num(raw.coolingDownUntil),
    quotaExhaustedUntil: num(raw.quotaExhaustedUntil),
    rateLimitResetTimes: limits,
    storeIndex,
  }
}

export function createExternalCredentialSource(options: ExternalSourceOptions = {}): ChatGptCredentialSource {
  const path = options.path ?? codexPoolPath()
  const now = options.now ?? Date.now
  let cached: Snapshot | undefined

  const read = (force: boolean): Snapshot => {
    let key: string
    try {
      const stat = statSync(path)
      key = `${stat.ino}:${stat.size}:${stat.mtimeMs}`
    } catch {
      cached = { key: "absent", accounts: [], activeIndex: 0, activeIndexByFamily: {}, error: "not_configured" }
      return cached
    }
    if (!force && cached?.key === key) return cached
    try {
      // The plugin publishes by rename, so this observes one complete document.
      const root = record(JSON.parse(readFileSync(path, "utf8")))
      if (!root || root.version !== SUPPORTED_VERSION || !Array.isArray(root.accounts)) {
        cached = { key, accounts: [], activeIndex: 0, activeIndexByFamily: {}, error: "invalid_pool" }
        return cached
      }
      const byFamily: Record<string, number> = {}
      for (const [family, index] of Object.entries(record(root.activeIndexByFamily) ?? {})) {
        const at = num(index)
        if (at !== null) byFamily[family] = at
      }
      cached = {
        key,
        accounts: root.accounts.map((value, index) => parseAccount(value, index)).filter((a): a is ExternalAccount => a !== null),
        activeIndex: num(root.activeIndex) ?? 0,
        activeIndexByFamily: byFamily,
        error: null,
      }
    } catch {
      // Keep serving the last good read through a transient parse failure;
      // with none, report the store unreadable.
      if (cached && cached.error === null) return cached
      cached = { key, accounts: [], activeIndex: 0, activeIndexByFamily: {}, error: "pool_unreadable" }
    }
    return cached
  }

  /**
   * `spendCredits` waives only the owner's account-wide `quotaExhaustedUntil`
   * stamp: that records a spent PLAN window, which credits pay past. A
   * per-model `rateLimitResetTimes` block records a refusal and still holds.
   */
  const unavailable = (account: ExternalAccount, model: string | undefined, at: number, spendCredits = false): SeatUnavailableReason | null => {
    if (!account.enabled) return "disabled"
    if (account.coolingDownUntil !== null && account.coolingDownUntil > at) return "cooling_down"
    if (!spendCredits && account.quotaExhaustedUntil !== null && account.quotaExhaustedUntil > at) return "quota_exhausted"
    if (model && (account.rateLimitResetTimes[model] ?? 0) > at) return "quota_exhausted"
    if (!account.accessToken || !account.accountId) return "no_token"
    if (account.expiresAt !== null && account.expiresAt - EXPIRY_SKEW_MS <= at) return "expired"
    return null
  }

  /** The owner's own pick for this model first, then the rest in store order. */
  const ordered = (snapshot: Snapshot, model: string | undefined): ExternalAccount[] => {
    const { accounts } = snapshot
    if (accounts.length === 0) return []
    const start = (model !== undefined ? snapshot.activeIndexByFamily[model] : undefined) ?? snapshot.activeIndex
    const offset = start >= 0 && start < accounts.length ? start : 0
    return [...accounts.slice(offset), ...accounts.slice(0, offset)]
  }

  return {
    mode: "follow-external",

    seats(model) {
      const snapshot = read(false)
      const at = now()
      const active = ordered(snapshot, model)[0]?.accountUserId
      return snapshot.accounts.map((account): ChatGptSeatView => {
        const reason = unavailable(account, model, at)
        return {
          id: account.accountUserId,
          email: account.email,
          planType: account.planType,
          eligible: reason === null,
          ...(reason ? { reason } : {}),
          expiresAt: account.expiresAt,
          active: account.accountUserId === active,
          storeIndex: account.storeIndex,
        }
      })
    },

    candidateSeats(model) {
      const snapshot = read(false)
      const at = now()
      // Expired seats stay candidates: the backend re-reads them once in case
      // the owner rotated the token since the last read.
      return ordered(snapshot, model)
        .filter(account => {
          const reason = unavailable(account, model, at)
          return reason === null || reason === "expired"
        })
        .map(account => account.accountUserId)
    },

    reserveSeats(model) {
      const snapshot = read(false)
      const at = now()
      return ordered(snapshot, model)
        .filter(account => {
          if (unavailable(account, model, at) !== "quota_exhausted") return false
          const waived = unavailable(account, model, at, true)
          return waived === null || waived === "expired"
        })
        .map(account => account.accountUserId)
    },

    async credentials(seat, opts) {
      const account = read(opts?.reread === true).accounts.find(a => a.accountUserId === seat)
      if (!account) return { ok: false, reason: "unknown" }
      const reason = unavailable(account, opts?.model, now(), opts?.spendCredits === true)
      if (reason) return { ok: false, reason }
      return { ok: true, account: { accountUserId: seat, accountId: account.accountId!, accessToken: account.accessToken! } } satisfies SeatCredential
    },

    isServing() {
      return read(false).error === null
    },

    usagePool(): CodexPoolResult {
      const snapshot = read(false)
      if (snapshot.error) return { pool: null, error: snapshot.error }
      return {
        error: null,
        pool: {
          path,
          accounts: snapshot.accounts.map((account): CodexPoolAccount => ({
            accountId: account.accountId,
            accountUserId: account.accountUserId,
            organizationId: account.organizationId,
            email: account.email,
            accountLabel: null,
            planType: account.planType,
            accessToken: account.accessToken,
            expiresAt: account.expiresAt,
            enabled: account.enabled,
          })),
        },
      }
    },

    describeUnavailable(reasons) {
      if (reasons.has("expired") || reasons.has("requires_reauth")) {
        return "Every eligible ChatGPT account's access token held by oc-codex-multi-auth is expired or was refused. "
          + "Meridian follows that store read-only and never refreshes its tokens; the owner must refresh them "
          + "(use any openai/ model in opencode once), then retry."
      }
      if (reasons.size === 0) return "oc-codex-multi-auth has no ChatGPT account that can serve this model."
      return `No oc-codex-multi-auth ChatGPT account can serve this model right now (${[...reasons].sort().join(", ")}).`
    },

    async acquire() {},
    release() {},
  }
}
