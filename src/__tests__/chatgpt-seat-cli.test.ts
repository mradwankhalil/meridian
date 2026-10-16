/**
 * `meridian profile ...` on ChatGPT seats (chatgpt/seatCli.ts), against a real
 * owned store and settings file in a temporary directory: every command works
 * with no Meridian running, and `add`/`login`/`remove` hand over to the
 * running instance only when it holds the store's writer lease.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { acquireWriterLease } from "../proxy/chatgpt/lease"
import { __setChatGptLoginListenOverride } from "../proxy/chatgpt/login"
import {
  findChatGptSeat,
  listChatGptSeats,
  printChatGptSeats,
  removeChatGptSeat,
  renameChatGptSeat,
  signInChatGptSeat,
  switchChatGptSeat,
  type SeatCliContext,
  type SeatCliIo,
} from "../proxy/chatgpt/seatCli"
import { getSetting, saveSettings } from "../settings"

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
const token = (seat: string, plan: string, email?: string) => `${part({ alg: "none" })}.${part({
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...(email ? { email } : {}),
  "https://api.openai.com/auth": { chatgpt_account_id: seat.split("__")[1], chatgpt_account_user_id: seat, chatgpt_plan_type: plan },
})}.sig`

const PAID = "user-p__ws-pppppp"
const FREE = "user-f__ws-ffffff"
const stored = (seat: string, plan: string, extra: Record<string, unknown> = {}) => ({
  accountUserId: seat, accountId: seat.split("__")[1], email: `${seat.slice(5, 6)}@x.test`,
  refreshToken: `rt-${seat}`, accessToken: token(seat, plan), expiresAt: Date.now() + 3_600_000,
  tokenRotatedAt: Date.now(), exchangeStartedAt: null, ...extra,
})

let dir: string
let storePath: string
const saved = { config: process.env.MERIDIAN_CONFIG_DIR, store: process.env.MERIDIAN_CHATGPT_STORE_PATH, mode: process.env.MERIDIAN_CHATGPT_CREDENTIALS, port: process.env.MERIDIAN_PORT }

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chatgpt-seat-cli-"))
  storePath = join(dir, "chatgpt-accounts.json")
  process.env.MERIDIAN_CONFIG_DIR = dir
  process.env.MERIDIAN_CHATGPT_STORE_PATH = storePath
  process.env.MERIDIAN_PORT = "1"
  delete process.env.MERIDIAN_CHATGPT_CREDENTIALS
  writeFileSync(storePath, JSON.stringify({ version: 1, accounts: [stored(PAID, "pro"), stored(FREE, "free")] }), { mode: 0o600 })
  __setChatGptLoginListenOverride(async () => null)
})
afterEach(() => {
  __setChatGptLoginListenOverride(null)
  for (const [key, value] of [["MERIDIAN_CONFIG_DIR", saved.config], ["MERIDIAN_CHATGPT_STORE_PATH", saved.store], ["MERIDIAN_CHATGPT_CREDENTIALS", saved.mode], ["MERIDIAN_PORT", saved.port]] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(dir, { recursive: true, force: true })
})

const accounts = () => (JSON.parse(readFileSync(storePath, "utf8")) as { accounts: Array<{ accountUserId: string; refreshToken: string; email: string | null }> }).accounts

function harness(options: { instance?: Record<string, Array<{ status: number; body: unknown }>>; paste?: (authorizeUrl: string) => string } = {}) {
  const calls: Array<{ path: string; body: unknown }> = []
  const out: string[] = []
  const err: string[] = []
  let opened = ""
  const io: SeatCliIo = {
    fetch: async (url, init) => {
      const path = new URL(url).pathname + new URL(url).search
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const key = Object.keys(options.instance ?? {}).find(prefix => path.startsWith(prefix))
      const queue = key ? options.instance![key]! : []
      const next = queue.length > 1 ? queue.shift()! : queue[0]
      if (!next) throw new Error("connection refused")
      return Response.json(next.body, { status: next.status })
    },
    log: line => out.push(line),
    error: line => err.push(line),
    sleep: () => new Promise(resolve => setTimeout(resolve, 5)),
    prompt: async () => options.paste?.(opened) ?? "",
    openUrl: url => { opened = url },
  }
  const ctx: SeatCliContext = { reserved: new Set(["default", "claude-work"]), io, pollMs: 5 }
  return { ctx, calls, out, err, opened: () => opened }
}

/** auth.openai.com as the sign-in sees it: a device code entered at once, and a token for `seat`. */
function authServer(seat: string, email: string) {
  return async (url: string): Promise<Response> => {
    if (url.endsWith("/deviceauth/usercode")) return Response.json({ device_auth_id: "dev", user_code: "ABCD-1234", interval: "1" })
    if (url.endsWith("/deviceauth/token")) return Response.json({ authorization_code: "auth", code_challenge: "c", code_verifier: "v" })
    if (url.endsWith("/oauth/token")) return Response.json({ access_token: token(seat, "plus", email), refresh_token: "rt-fresh", id_token: token(seat, "plus", email), expires_in: 3600 })
    return new Response("{}", { status: 500 })
  }
}

describe("ChatGPT seats from the CLI, with no Meridian running", () => {
  it("lists seats from the store with their plan tier, and finds one by any of its names", () => {
    saveSettings({ chatGptProfileNames: { [PAID]: "of-n-p20-gpt" }, chatGptProfileAliases: { [PAID]: ["p-pppppp"] }, chatGptActiveSeat: FREE })
    const h = harness()
    const seats = listChatGptSeats(h.ctx)
    expect(seats.map(s => [s.id, s.planTier, s.isActive])).toEqual([["of-n-p20-gpt", "paid", false], ["f-ffffff", "free", true]])
    expect(findChatGptSeat("p-pppppp", h.ctx)?.id).toBe("of-n-p20-gpt")
    printChatGptSeats(seats, h.ctx.io)
    const text = h.out.join("\n")
    expect(text).toContain("of-n-p20-gpt")
    expect(text).toContain("(Free, free)")
    expect(text).toContain("of-n-p20-gpt serves unpinned work first")
  })

  it("renames a seat in settings, keeping the old name as an alias and its place in the order", () => {
    saveSettings({ profileOrder: ["claude-work", "p-pppppp"] })
    const h = harness()
    expect(renameChatGptSeat("p-pppppp", "of-n-p20-gpt", h.ctx)).toBe(true)
    expect(getSetting("chatGptProfileNames")).toEqual({ [PAID]: "of-n-p20-gpt" })
    expect(getSetting("chatGptProfileAliases")).toEqual({ [PAID]: ["p-pppppp"] })
    expect(getSetting("profileOrder")).toEqual(["claude-work", "of-n-p20-gpt"])
    expect(renameChatGptSeat("of-n-p20-gpt", "claude-work", h.ctx)).toBe(false)
    expect(h.err.join("\n")).toContain("already exists")
  })

  it("switches the active seat in settings, and says a free one still serves after the paid ones", () => {
    const h = harness()
    expect(switchChatGptSeat("f-ffffff", h.ctx)).toBe(true)
    expect(getSetting("chatGptActiveSeat")).toBe(FREE)
    expect(h.out.join("\n")).toContain("free plan")
  })

  it("removes a seat itself: credentials, settings and the active pointer, then lets the lease go", async () => {
    saveSettings({ chatGptActiveSeat: PAID, chatGptProfileNames: { [PAID]: "of-n-p20-gpt" }, profileOrder: ["of-n-p20-gpt", "f-ffffff"], chatgpt: { seatCreditsPolicy: { [PAID]: "reserve" } } })
    const h = harness()
    expect(await removeChatGptSeat("of-n-p20-gpt", h.ctx)).toBe(true)
    expect(accounts().map(a => a.accountUserId)).toEqual([FREE])
    expect(getSetting("chatGptProfileNames")).toEqual({})
    expect(getSetting("profileOrder")).toEqual(["f-ffffff"])
    expect(getSetting("chatGptActiveSeat")).toBe(FREE)
    expect(getSetting("chatgpt")?.seatCreditsPolicy).toEqual({})
    expect(h.out.join("\n")).toContain("Active ChatGPT seat is now \"f-ffffff\"")
    expect(h.calls).toEqual([])
    expect(existsSync(`${storePath}.lock`)).toBe(false)
  })

  it("adds a seat by device code under the name given, and `login` of that name signs it in again", async () => {
    const seat = "user-n__ws-nnnnnn"
    const h = harness()
    h.ctx.fetchImpl = authServer(seat, "new@x.test")
    expect(await signInChatGptSeat("n-vk-p1-gpt", { headless: true }, h.ctx)).toBe(true)
    expect(h.out.join("\n")).toContain("ABCD-1234")
    expect(h.out.join("\n")).toContain("ChatGPT seat \"n-vk-p1-gpt\" added as new@x.test")
    expect(accounts().map(a => a.accountUserId)).toEqual([PAID, FREE, seat])
    expect(findChatGptSeat("n-vk-p1-gpt", h.ctx)?.seat).toBe(seat)

    expect(await signInChatGptSeat("n-vk-p1-gpt", { headless: true }, h.ctx)).toBe(true)
    expect(h.out.at(-1)).toContain("\"n-vk-p1-gpt\" signed in again")
    expect(accounts()).toHaveLength(3)
    expect(h.calls).toEqual([])
  })

  it("refuses a sign-in that comes back as another account, and changes nothing", async () => {
    const h = harness()
    h.ctx.fetchImpl = authServer("user-z__ws-zzzzzz", "other@x.test")
    expect(await signInChatGptSeat("p-pppppp", { headless: true }, h.ctx)).toBe(false)
    expect(h.err.join("\n")).toContain("You signed in as other@x.test")
    expect(accounts().map(a => [a.accountUserId, a.refreshToken])).toEqual([[PAID, `rt-${PAID}`], [FREE, `rt-${FREE}`]])
  })

  it("signs in through the browser, finishing from the pasted callback address", async () => {
    const h = harness({ paste: url => `http://127.0.0.1:1455/auth/callback?code=c&state=${new URL(url).searchParams.get("state")}` })
    h.ctx.fetchImpl = authServer(PAID, "p@x.test")
    expect(await signInChatGptSeat("p-pppppp", {}, h.ctx)).toBe(true)
    expect(new URL(h.opened()).origin).toBe("https://auth.openai.com")
    expect(accounts().find(a => a.accountUserId === PAID)?.refreshToken).toBe("rt-fresh")
  })

  it("refuses a new name a Claude profile has", async () => {
    const h = harness()
    expect(await signInChatGptSeat("claude-work", { headless: true }, h.ctx)).toBe(false)
    expect(h.err.join("\n")).toContain("already exists")
  })
})

describe("ChatGPT seats from the CLI, while a running Meridian holds the store", () => {
  it("asks that instance to remove the seat, and writes nothing itself", async () => {
    const lease = await acquireWriterLease({ lockPath: `${storePath}.lock`, waitMs: 0 })
    try {
      const h = harness({ instance: { "/profiles/chatgpt/remove": [{ status: 200, body: { success: true, profile: "p-pppppp", provider: "chatgpt", activeProfile: "f-ffffff" } }] } })
      expect(await removeChatGptSeat("p-pppppp", h.ctx)).toBe(true)
      expect(h.calls).toEqual([{ path: "/profiles/chatgpt/remove", body: { profile: "p-pppppp" } }])
      expect(accounts()).toHaveLength(2)
    } finally {
      lease.release()
    }
  })

  it("asks that instance to run the sign-in, by device code, for a new name", async () => {
    const lease = await acquireWriterLease({ lockPath: `${storePath}.lock`, waitMs: 0 })
    try {
      const h = harness({ instance: {
        "/profiles/chatgpt/connect/device": [{ status: 200, body: { connectId: "c1", userCode: "WXYZ-0001", verificationUrl: "https://auth.openai.com/codex/device" } }],
        "/profiles/chatgpt/connect/status": [{ status: 200, body: { status: "waiting" } }, { status: 200, body: { status: "completed", accountUserId: "user-q__ws-qqqqqq", email: "q@x.test" } }],
      } })
      expect(await signInChatGptSeat("q-new", { headless: true }, h.ctx)).toBe(true)
      expect(h.calls[0]).toEqual({ path: "/profiles/chatgpt/connect/device", body: { name: "q-new" } })
      expect(h.out.join("\n")).toContain("WXYZ-0001")
    } finally {
      lease.release()
    }
  })

  it("says which instance to point at when the holder does not answer", async () => {
    const lease = await acquireWriterLease({ lockPath: `${storePath}.lock`, waitMs: 0 })
    try {
      const h = harness()
      expect(await removeChatGptSeat("p-pppppp", h.ctx)).toBe(false)
      expect(h.err.join("\n")).toContain("MERIDIAN_PORT")
    } finally {
      lease.release()
    }
  })
})
