/**
 * The migration's view of Meridian's owned ChatGPT store and of the running
 * Meridian that serves it.
 *
 * Writes go through the store's own `commitAccount`, under the same writer
 * lease the server takes in owned mode, so there is still exactly one way to
 * write a credential file. The lease is requested without waiting: a running
 * Meridian that already owns these accounts is news to report, not a queue.
 * Each seat is committed on its own; a run cut short leaves the seats it
 * reached fully written and the rest untouched, and re-running continues.
 *
 * Validation asks the running Meridian rather than the store, because the
 * point is that Meridian - not the file - can use each account.
 */

import { chatGptSeatLabel } from "../../backends/chatgptStatus"
import { getSetting, saveSettings } from "../../../settings"
import { loadProfilesFromDisk } from "../../profiles"
import { createChatGptCredentialStore, type ChatGptAccount } from "../credentials"
import { acquireWriterLease, WriterLeaseUnavailableError } from "../lease"
import { chatGptLockPath } from "../paths"
import type { ChatGptStoreAdapter, ImportAccount, SeatValidation } from "./migrate"
import type { MeridianHeldAccount } from "./strip"
import { isRecord } from "./sources"

/** Tried in order; the first the subscription serves is used. Never the default model. */
export const TEST_PROMPT_MODELS = ["gpt-6-luna", "gpt-5.4-mini", "gpt-5.1-codex-mini"] as const

const TEST_PROMPT = "Reply with the single word OK."

export class MeridianOwnsStoreError extends Error {
  constructor(lockPath: string) {
    super(
      `A running Meridian holds the ChatGPT writer lease (${lockPath}), so it already refreshes the accounts in this store. `
      + "Stop it before importing, then start it again.",
    )
    this.name = "MeridianOwnsStoreError"
  }
}

export interface OwnedStoreAdapterOptions {
  storePath: string
  /** Meridian's address, e.g. `http://127.0.0.1:3456`. */
  meridianUrl: string
  /** Sent as `x-api-key` when Meridian runs with MERIDIAN_API_KEY. */
  apiKey?: string
  testModels?: readonly string[]
  fetchImpl?: typeof fetch
  /** Where profile names live; Meridian's settings file when absent. */
  settings?: {
    names(): Readonly<Record<string, unknown>>
    reserved(): ReadonlySet<string>
    saveNames(names: ReadonlyMap<string, string>): void
  }
}

function asHeld(account: ChatGptAccount): MeridianHeldAccount {
  return {
    accountUserId: account.accountUserId,
    accountId: account.accountId,
    email: account.email,
    refreshToken: account.refreshToken,
    accessToken: account.accessToken,
    tokenRotatedAt: account.tokenRotatedAt,
    expiresAt: account.expiresAt,
    exchangeStartedAt: account.exchangeStartedAt,
  }
}

/** The ids a ChatGPT seat may not take, as the server computes them: `default` and every Claude profile id and alias. */
function claudeProfileIds(): Set<string> {
  return new Set(["default", ...loadProfilesFromDisk().flatMap(profile => [profile.id, ...(profile.aliases ?? [])])])
}

interface ProviderAccount {
  id: string
  error?: string
  windows: Array<{ type: string; utilization: number }>
}

function describeWindows(windows: ProviderAccount["windows"]): string {
  return windows.map(window => `${window.type} ${Math.round(window.utilization * 100)}% used`).join(", ")
}

function outputText(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.output)) return null
  for (const item of body.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (isRecord(part) && typeof part.text === "string") return part.text
    }
  }
  return null
}

export function createOwnedStoreAdapter(options: OwnedStoreAdapterOptions): ChatGptStoreAdapter {
  const { storePath } = options
  const fetchImpl = options.fetchImpl ?? fetch
  const base = options.meridianUrl.replace(/\/+$/, "")
  const headers = (): Record<string, string> => ({
    "content-type": "application/json",
    ...(options.apiKey ? { "x-api-key": options.apiKey } : {}),
  })
  const reader = createChatGptCredentialStore({ path: storePath })
  const takeLease = async () => {
    try {
      return await acquireWriterLease({ lockPath: chatGptLockPath(storePath), waitMs: 0 })
    } catch (error) {
      if (error instanceof WriterLeaseUnavailableError) throw new MeridianOwnsStoreError(error.lockPath)
      throw error
    }
  }

  let serving: Promise<{ accounts: ProviderAccount[] } | { error: string }> | undefined
  const readServing = () => {
    serving ??= (async () => {
      try {
        const health = await fetchImpl(`${base}/health`, { headers: headers() })
        const healthBody: unknown = await health.json()
        const chatgpt = isRecord(healthBody) ? healthBody.chatgpt : undefined
        if (!isRecord(chatgpt)) return { error: `Meridian at ${base} does not serve ChatGPT (no chatgpt section in /health)` }
        if (chatgpt.mode !== "owned") {
          return { error: `Meridian at ${base} runs ChatGPT in "${String(chatgpt.mode)}" mode; restart it with MERIDIAN_CHATGPT_CREDENTIALS=owned (or unset) so it uses this store` }
        }
        const status = await fetchImpl(`${base}/providers/status`, { headers: headers() })
        if (!status.ok) return { error: `GET /providers/status answered ${status.status}` }
        const body: unknown = await status.json()
        const providers = isRecord(body) && Array.isArray(body.providers) ? body.providers : []
        const provider = providers.find(entry => isRecord(entry) && entry.id === "chatgpt")
        if (!isRecord(provider) || !Array.isArray(provider.accounts)) return { error: "/providers/status has no ChatGPT provider" }
        return { accounts: provider.accounts as ProviderAccount[] }
      } catch (error) {
        return { error: `Meridian at ${base} could not be reached (${(error as Error).message})` }
      }
    })()
    return serving
  }

  return {
    storePath,

    readHeld(): MeridianHeldAccount[] {
      return reader.readAccounts().map(asHeld)
    },

    profileNames: () => options.settings?.names() ?? getSetting("chatGptProfileNames") ?? {},

    reservedProfileIds: () => options.settings?.reserved() ?? claudeProfileIds(),

    saveProfileNames(names) {
      if (options.settings) return options.settings.saveNames(names)
      saveSettings({ chatGptProfileNames: { ...(getSetting("chatGptProfileNames") ?? {}), ...Object.fromEntries(names) } })
    },

    async handBack(accountUserIds, write) {
      const lease = await takeLease()
      try {
        const writer = createChatGptCredentialStore({ path: storePath, lease })
        const wanted = new Set(accountUserIds)
        const accounts = writer.readAccounts().filter(account => wanted.has(account.accountUserId)).map(asHeld)
        if (accounts.length === 0) return []
        write(accounts)
        return writer.removeAccounts(accounts.map(account => account.accountUserId)).map(asHeld)
      } finally {
        lease.release()
      }
    },

    async importAccounts(accounts: readonly ImportAccount[]): Promise<void> {
      const lease = await takeLease()
      try {
        const writer = createChatGptCredentialStore({ path: storePath, lease })
        for (const account of accounts) {
          writer.commitAccount(account.accountUserId, () => ({
            accountUserId: account.accountUserId,
            accountId: account.accountId,
            email: account.email,
            refreshToken: account.refreshToken,
            accessToken: account.accessToken,
            expiresAt: account.expiresAt,
            tokenRotatedAt: account.tokenRotatedAt,
            // An import is not an interrupted exchange; a stamp here would mark the seat REQUIRES-REAUTH.
            exchangeStartedAt: null,
          }))
        }
      } finally {
        lease.release()
      }
    },

    async validateSeat(accountUserId: string): Promise<SeatValidation> {
      const state = await readServing()
      if ("error" in state) return { ok: false, detail: state.error }
      const label = chatGptSeatLabel(accountUserId, reader.readAccount(accountUserId)?.email ?? null)
      const account = state.accounts.find(entry => entry.id === accountUserId)
      if (!account) return { ok: false, detail: `Meridian does not list ${label}; restart it so it reads ${storePath}` }
      if (account.error) return { ok: false, detail: account.error }
      if (account.windows.length === 0) return { ok: false, detail: `${label}: no quota windows reported yet` }
      return { ok: true, detail: `${label}: ${describeWindows(account.windows)}` }
    },

    async testPrompt(): Promise<SeatValidation> {
      const refusals: string[] = []
      for (const model of options.testModels ?? TEST_PROMPT_MODELS) {
        let response: Response
        try {
          response = await fetchImpl(`${base}/v1/responses`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ model, input: [{ role: "user", content: TEST_PROMPT }], stream: false }),
          })
        } catch (error) {
          return { ok: false, detail: `Meridian at ${base} could not be reached (${(error as Error).message})` }
        }
        const body: unknown = await response.json().catch(() => null)
        if (response.ok) {
          const text = outputText(body)?.trim().slice(0, 40) ?? "(no text)"
          return { ok: true, detail: `${model} answered "${text}"` }
        }
        refusals.push(`${model} ${response.status}`)
      }
      return { ok: false, detail: `no test model was served (${refusals.join(", ")})` }
    },
  }
}
