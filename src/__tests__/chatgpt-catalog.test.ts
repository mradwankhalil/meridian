/**
 * The ChatGPT model catalog: what the gateway offers, read from the backend's
 * own `/codex/models` rather than a hand-kept list.
 */
import { describe, expect, it } from "bun:test"
import {
  CATALOG_CLIENT_VERSION,
  chatGptModelList,
  createChatGptModelCatalog,
  offeredModels,
  parseCodexModelCatalog,
  type CatalogModel,
} from "../proxy/chatgpt/catalog"
import { createCodexClientVersion } from "../proxy/chatgpt/clientVersion"
import type { ChatGptCredentialSource, ChatGptSeatView, SeatCredential } from "../proxy/chatgpt/source"
import { CHATGPT_MODELS } from "../proxy/upstream/provider"

const NOW = 1_800_000_000_000
const HOUR = 60 * 60_000
const DAY = 24 * HOUR

function seat(n: number, extra: Partial<ChatGptSeatView> = {}): ChatGptSeatView {
  return { id: `user-${n}__ws-${n}`, email: null, planType: "pro", eligible: true, expiresAt: NOW + HOUR, ...extra }
}

function fakeSource(seats: ChatGptSeatView[]) {
  const asked: string[] = []
  const source: ChatGptCredentialSource = {
    mode: "follow-external",
    seats: () => seats,
    candidateSeats: () => seats.map(s => s.id),
    async credentials(id): Promise<SeatCredential> {
      asked.push(id)
      return { ok: true, account: { accountUserId: id, accountId: id.split("__")[1]!, accessToken: `at-${id}` } }
    },
    isServing: () => true,
    usagePool: () => ({ pool: null, error: "not_configured" }),
    describeUnavailable: () => "",
    acquire: async () => {},
    release: () => {},
  }
  return { source, asked }
}

const CATALOG = {
  models: [
    { slug: "gpt-6-luna", visibility: "list", display_name: "GPT-6-Luna", context_window: 272000, available_in_plans: ["pro", "team"] },
    { slug: "gpt-daybreak-red-latest", visibility: "hide", display_name: "Daybreak Red", available_in_plans: ["pro"] },
    { slug: "gpt-team-only", visibility: "list", display_name: "Team Only", available_in_plans: ["team"] },
    { slug: "gpt-any-plan", visibility: "list" },
  ],
}

interface CatalogCall { url: URL; headers: Headers }

function catalogFetch(respond: () => Response | Promise<Response>) {
  const calls: CatalogCall[] = []
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(input instanceof Request ? input.url : input.toString()), headers: new Headers(init?.headers) })
    return Promise.resolve(respond())
  }) as typeof fetch
  return { fetchImpl, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("parseCodexModelCatalog", () => {
  it("keeps listed entries in order with their metadata, and drops hidden ones", () => {
    expect(parseCodexModelCatalog(CATALOG)).toEqual([
      { slug: "gpt-6-luna", displayName: "GPT-6-Luna", contextWindow: 272000, plans: ["pro", "team"] },
      { slug: "gpt-team-only", displayName: "Team Only", contextWindow: null, plans: ["team"] },
      { slug: "gpt-any-plan", displayName: "gpt-any-plan", contextWindow: null, plans: null },
    ])
  })

  it("answers null for a body that is not a catalog, rather than an empty one", () => {
    for (const body of [null, "x", {}, { models: "x" }, []]) expect(parseCodexModelCatalog(body)).toBeNull()
  })

  it("skips malformed entries and duplicates", () => {
    expect(parseCodexModelCatalog({ models: [null, 1, { visibility: "list" }, { slug: "", visibility: "list" }, { slug: "a", visibility: "list" }, { slug: "a", visibility: "list" }] })!
      .map(model => model.slug)).toEqual(["a"])
  })
})

describe("offeredModels", () => {
  const catalog = parseCodexModelCatalog(CATALOG)!
  it("offers what at least one held plan may use", () => {
    expect(offeredModels(catalog, new Set(["pro"])).map(m => m.slug)).toEqual(["gpt-6-luna", "gpt-any-plan"])
    expect(offeredModels(catalog, new Set(["pro", "team"])).map(m => m.slug)).toEqual(["gpt-6-luna", "gpt-team-only", "gpt-any-plan"])
    expect(offeredModels(catalog, new Set(["free"])).map(m => m.slug)).toEqual(["gpt-any-plan"])
  })

  it("filters nothing when no seat names a plan", () => {
    expect(offeredModels(catalog, new Set()).map(m => m.slug)).toEqual(["gpt-6-luna", "gpt-team-only", "gpt-any-plan"])
  })
})

describe("chatGptModelList", () => {
  it("builds OpenAI model entries, with the catalog's context window where it has one", () => {
    const models: CatalogModel[] = [
      { slug: "gpt-6-luna", displayName: "GPT-6-Luna", contextWindow: 400000, plans: null },
      { slug: "gpt-5.5", displayName: "gpt-5.5", contextWindow: null, plans: null },
    ]
    expect(chatGptModelList(models, 7)).toEqual([
      { id: "gpt-6-luna", object: "model", created: 7, owned_by: "openai", display_name: "GPT-6-Luna", context_window: 400000 },
      { id: "gpt-5.5", object: "model", created: 7, owned_by: "openai", display_name: "gpt-5.5", context_window: 272000 },
    ])
  })
})

describe("createChatGptModelCatalog", () => {
  it("offers the static list until the catalog has been read", () => {
    const { source } = fakeSource([seat(0)])
    const catalog = createChatGptModelCatalog({ source, fetchImpl: catalogFetch(() => json(CATALOG)).fetchImpl, now: () => NOW })
    expect(catalog.models()).toEqual([...CHATGPT_MODELS])
    expect(catalog.view()).toMatchObject({ source: "static", fetchedAt: null, plans: {} })
  })

  it("reads the catalog once with one seat's token, from the fixed host, and offers per the seats' plans", async () => {
    const { source, asked } = fakeSource([seat(0), seat(1, { planType: "team" })])
    const { fetchImpl, calls } = catalogFetch(() => json(CATALOG))
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => NOW })
    await catalog.refresh()
    expect(calls).toHaveLength(1)
    expect(asked).toEqual(["user-0__ws-0"])
    expect(`${calls[0]!.url.origin}${calls[0]!.url.pathname}`).toBe("https://chatgpt.com/backend-api/codex/models")
    expect(calls[0]!.url.searchParams.get("client_version")).toBe(CATALOG_CLIENT_VERSION)
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer at-user-0__ws-0")
    expect(calls[0]!.headers.get("chatgpt-account-id")).toBe("ws-0")
    expect(calls[0]!.headers.get("originator")).toBe("codex_cli_rs")
    expect(catalog.models()).toEqual(["gpt-6-luna", "gpt-team-only", "gpt-any-plan"])
    expect(catalog.view()).toEqual({
      source: "catalog",
      fetchedAt: NOW,
      clientVersion: CATALOG_CLIENT_VERSION,
      models: ["gpt-6-luna", "gpt-team-only", "gpt-any-plan"],
      plans: { pro: ["gpt-6-luna", "gpt-any-plan"], team: ["gpt-6-luna", "gpt-team-only", "gpt-any-plan"] },
    })
  })

  it("prefers the usage service's plan over the store's", async () => {
    const { source } = fakeSource([seat(0)])
    const catalog = createChatGptModelCatalog({
      source,
      fetchImpl: catalogFetch(() => json(CATALOG)).fetchImpl,
      now: () => NOW,
      planTypes: () => new Map([["user-0__ws-0", "team"]]),
    })
    await catalog.refresh()
    expect(catalog.models()).toEqual(["gpt-6-luna", "gpt-team-only", "gpt-any-plan"])
  })

  it("never asks for the credentials of a seat that is ineligible or near expiry", async () => {
    const { source, asked } = fakeSource([
      seat(0, { eligible: false, reason: "quota_exhausted" }),
      seat(1, { expiresAt: NOW + 5 * 60_000 }),
      seat(2, { expiresAt: null }),
      seat(3),
    ])
    const { fetchImpl } = catalogFetch(() => json(CATALOG))
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => NOW })
    await catalog.refresh()
    expect(asked).toEqual(["user-3__ws-3"])
    expect(catalog.view().source).toBe("catalog")
  })

  it("does not back off when no seat could be asked, so a seat that becomes readable is used at once", async () => {
    const seats = [seat(0, { eligible: false, reason: "expired" })]
    const { source } = fakeSource(seats)
    const { fetchImpl, calls } = catalogFetch(() => json(CATALOG))
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => NOW })
    await catalog.refresh()
    expect(calls).toHaveLength(0)
    seats[0] = seat(0)
    await catalog.refresh()
    expect(calls).toHaveLength(1)
    expect(catalog.view().source).toBe("catalog")
  })

  it("tries the next seat when one is refused", async () => {
    const { source } = fakeSource([seat(0), seat(1)])
    let n = 0
    const { fetchImpl, calls } = catalogFetch(() => (n++ === 0 ? json({ detail: "Unauthorized" }, 401) : json(CATALOG)))
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => NOW })
    await catalog.refresh()
    expect(calls.map(call => call.headers.get("chatgpt-account-id"))).toEqual(["ws-0", "ws-1"])
    expect(catalog.view().source).toBe("catalog")
  })

  it("counts a catalog with nothing listed as a failed read", async () => {
    const { source } = fakeSource([seat(0)])
    const catalog = createChatGptModelCatalog({ source, fetchImpl: catalogFetch(() => json({ models: [] })).fetchImpl, now: () => NOW })
    await catalog.refresh()
    expect(catalog.models()).toEqual([...CHATGPT_MODELS])
  })

  it("re-reads hourly, keeps the last catalog through a failed read, and waits before retrying", async () => {
    const { source } = fakeSource([seat(0, { expiresAt: NOW + 10 * HOUR })])
    let at = NOW
    let answer: () => Response = () => json(CATALOG)
    const { fetchImpl, calls } = catalogFetch(() => answer())
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => at })
    await catalog.refresh()
    expect(calls).toHaveLength(1)

    at = NOW + HOUR - 1
    expect(catalog.refresh()).toBeUndefined()

    at = NOW + HOUR
    answer = () => json({}, 503)
    await catalog.refresh()
    expect(calls).toHaveLength(2)
    expect(catalog.models()).toEqual(["gpt-6-luna", "gpt-any-plan"])

    at = NOW + HOUR + 60_000
    expect(catalog.refresh()).toBeUndefined()

    at = NOW + HOUR + 5 * 60_000
    answer = () => json({ models: [{ slug: "gpt-7", visibility: "list" }] })
    await catalog.refresh()
    expect(calls).toHaveLength(3)
    expect(catalog.models()).toEqual(["gpt-7"])
  })

  it("shares one read between concurrent refreshes", async () => {
    const { source } = fakeSource([seat(0)])
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const { fetchImpl, calls } = catalogFetch(async () => { await gate; return json(CATALOG) })
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => NOW })
    const first = catalog.refresh()
    const second = catalog.refresh()
    expect(second).toBe(first!)
    release()
    await first
    expect(calls).toHaveLength(1)
  })

  it("reads for the looked-up client version, after the lookup, and re-reads for a newer one once found", async () => {
    const { source } = fakeSource([seat(0, { expiresAt: NOW + 10 * DAY })])
    let at = NOW
    let latest = "0.159.1"
    const lookups: string[] = []
    const clientVersion = createCodexClientVersion({
      pinned: CATALOG_CLIENT_VERSION,
      now: () => at,
      fetchImpl: ((input: string | URL | Request) => {
        lookups.push(input.toString())
        return Promise.resolve(json({ latest }))
      }) as typeof fetch,
    })
    const { fetchImpl, calls } = catalogFetch(() => json(CATALOG))
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => at, clientVersion })
    await catalog.refresh()
    expect(lookups).toHaveLength(1)
    expect(calls.map(call => call.url.searchParams.get("client_version"))).toEqual(["0.159.1"])
    expect(catalog.view().clientVersion).toBe("0.159.1")

    at = NOW + 30 * 60_000
    expect(catalog.refresh()).toBeUndefined()

    at = NOW + DAY
    latest = "0.160.0"
    await catalog.refresh()
    expect(calls.map(call => call.url.searchParams.get("client_version"))).toEqual(["0.159.1", "0.160.0"])

    at = NOW + DAY + 30 * 60_000
    expect(catalog.refresh()).toBeUndefined()
  })

  it("survives a network error", async () => {
    const { source } = fakeSource([seat(0)])
    const fetchImpl = (() => Promise.reject(new Error("offline"))) as unknown as typeof fetch
    const catalog = createChatGptModelCatalog({ source, fetchImpl, now: () => NOW })
    await catalog.refresh()
    expect(catalog.models()).toEqual([...CHATGPT_MODELS])
  })
})
