/**
 * `meridian profile ...` for ChatGPT seats, with the same verbs and the same
 * reach as for a Claude profile: they work whether or not Meridian is running.
 *
 * Names, order, the active seat and routing exclusions are settings, which a
 * running instance re-reads on every request, so `list`, `rename` and
 * `switch` read and write them directly. The seats themselves live in the
 * owned store, which only the holder of its writer lease may write: two
 * processes exchanging one single-use refresh token lose the account. So
 * `add`, `login` and `remove` take the lease themselves when it is free and
 * do the work in this process; when a running instance holds it, they ask
 * that instance through the routes its web UI uses.
 *
 * `add` and `login` are one operation, as they are for a Claude profile: a
 * name a seat already has is signed in again (and ChatGPT must hand back that
 * same account and workspace), a new name connects a new seat under it.
 *
 * No output and no log line carries a token, a code verifier or an
 * authorization code. The device user code is printed: it is what the person
 * types at auth.openai.com.
 */
import { spawn } from "node:child_process"
import { createInterface } from "node:readline/promises"
import { envBool } from "../../env"
import { getSetting, setSetting } from "../../settings"
import { renderLoginCallbackPage } from "../../telemetry/loginCallbackPage"
import { createExternalCredentialSource } from "./external"
import { WriterLeaseUnavailableError } from "./lease"
import { createChatGptLogin, type ChatGptExpectedSeat, type ChatGptLoginState } from "./login"
import { createOwnedCredentialSource } from "./owned"
import { chatGptStorePath } from "./paths"
import { chatGptNameProblem, chatGptOwner, type ChatGptProfile } from "./profiles"
import type { TokenExchangeFetch } from "./refresh"
import { applyChatGptRemoval, applyChatGptRename, storedChatGptSurface } from "./seatOps"
import type { ChatGptCredentialSource } from "./source"

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const GREY = "\x1b[90m"
const RESET = "\x1b[0m"

export interface SeatCliIo {
  fetch: (url: string, init?: RequestInit) => Promise<Response>
  log: (line: string) => void
  error: (line: string) => void
  sleep: (ms: number) => Promise<void>
  prompt: (question: string) => Promise<string>
  openUrl: (url: string) => void
}

const defaultIo: SeatCliIo = {
  fetch: (url, init) => fetch(url, init),
  log: line => console.log(line),
  error: line => console.error(line),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  prompt: async question => {
    const rl = createInterface({ input: process.stdin, output: process.stderr })
    try {
      return (await rl.question(`${question} `)).trim()
    } finally {
      rl.close()
    }
  },
  openUrl: url => {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open"
    try {
      spawn(command, [url], { detached: true, stdio: "ignore" }).on("error", () => {}).unref()
    } catch {
      // Printing the URL is the fallback; there is nothing else to do here.
    }
  },
}

export interface SeatCliContext {
  /** Claude profile ids and their former ids: a seat may not take one. */
  reserved: ReadonlySet<string>
  io?: SeatCliIo
  /** Tests: the token endpoint, for the sign-in and the owned source. */
  fetchImpl?: TokenExchangeFetch
  pollMs?: number
}

/** The seats this Meridian serves, as configured; null when ChatGPT is off. */
function chatGptSource(ctx: SeatCliContext): ChatGptCredentialSource | null {
  const mode = process.env.MERIDIAN_CHATGPT_CREDENTIALS?.trim()
  if (mode === "off") return null
  if (mode === "follow-external") return createExternalCredentialSource()
  return createOwnedCredentialSource({
    storePath: chatGptStorePath(),
    allowEmpty: true,
    ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
  }) ?? null
}

export function runningInstanceUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.MERIDIAN_PORT ?? env.CLAUDE_PROXY_PORT ?? "3456"
  const host = env.MERIDIAN_HOST ?? env.CLAUDE_PROXY_HOST ?? "127.0.0.1"
  return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`
}

async function call(io: SeatCliIo, path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> } | null> {
  const key = process.env.MERIDIAN_API_KEY
  try {
    const res = await io.fetch(`${runningInstanceUrl()}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...(key ? { "x-api-key": key } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return { status: res.status, data }
  } catch {
    return null
  }
}

/** The seat a name means - its id, a former id or its seat id - or undefined. */
export function findChatGptSeat(id: string, ctx: SeatCliContext): ChatGptProfile | undefined {
  const source = chatGptSource(ctx)
  return source ? storedChatGptSurface(source, ctx.reserved).resolve(id) : undefined
}

type ListEntry = ReturnType<ReturnType<typeof storedChatGptSurface>["listEntries"]>[number]

export function printChatGptSeats(seats: readonly ListEntry[], io: SeatCliIo = defaultIo): void {
  if (seats.length === 0) return
  io.log("ChatGPT seats:\n")
  for (const seat of seats) {
    const plan = seat.planName ? `${seat.planName}${seat.planTier === "free" ? ", free" : ""}` : ""
    const status = seat.loggedIn
      ? `${GREEN}✓ ${seat.email ?? seat.label}${plan ? ` (${plan})` : ""}${RESET}`
      : `${RED}✗ needs login (${seat.tokenState})${RESET}`
    io.log(`  ${seat.id.padEnd(20)} ${status}${seat.isActive ? " [active]" : ""}`)
    if (seat.aliases && seat.aliases.length > 0) io.log(`  ${"".padEnd(20)} ${GREY}also answers to: ${seat.aliases.join(", ")}${RESET}`)
    if (seat.freeSeatDeferred) {
      const first = seat.freeSeatDeferred.servedFirstBy
      io.log(`  ${"".padEnd(20)} ${GREY}free plan: ${first.join(", ")} serve${first.length === 1 ? "s" : ""} unpinned work first${RESET}`)
    }
  }
  io.log("")
}

export function listChatGptSeats(ctx: SeatCliContext): ListEntry[] {
  const source = chatGptSource(ctx)
  return source ? storedChatGptSurface(source, ctx.reserved).listEntries() : []
}

export function renameChatGptSeat(from: string, to: string, ctx: SeatCliContext): boolean {
  const io = ctx.io ?? defaultIo
  const source = chatGptSource(ctx)
  const plan = source ? storedChatGptSurface(source, ctx.reserved).planRename(from, to) : { ok: false as const, error: `Profile "${from}" not found.` }
  if (!plan.ok) {
    io.error(`${RED}✗ ${plan.error}${RESET}`)
    return false
  }
  applyChatGptRename(plan)
  io.log(`${GREEN}✓ ChatGPT seat "${plan.from}" renamed to "${plan.to}".${RESET}`)
  io.log(`  Requests naming ${plan.aliases.map(a => `"${a}"`).join(", ")} are served by "${plan.to}" until the name is taken again.`)
  return true
}

export function switchChatGptSeat(id: string, ctx: SeatCliContext): boolean {
  const io = ctx.io ?? defaultIo
  const source = chatGptSource(ctx)
  const activation = source ? storedChatGptSurface(source, ctx.reserved).activate(id) : { ok: false as const, error: `Unknown profile: ${id}` }
  if (!activation.ok) {
    io.error(`${RED}✗ ${activation.error}${RESET}`)
    return false
  }
  setSetting("chatGptActiveSeat", activation.profile.seat)
  io.log(`${GREEN}✓ Active ChatGPT seat: ${activation.profile.id}${RESET}`)
  if (activation.profile.planTier === "free") io.log("  It is on the free plan: paid seats with plan usage left still serve unpinned work first.")
  return true
}

/**
 * Run `work` holding the store's writer lease, or answer why not when another
 * process holds it, so the caller can ask the running instance instead.
 */
async function withLease<T>(source: ChatGptCredentialSource, work: () => Promise<T>): Promise<{ done: T } | { held: string }> {
  try {
    await source.acquire()
  } catch (error) {
    if (error instanceof WriterLeaseUnavailableError) return { held: error.message }
    throw error
  }
  try {
    return { done: await work() }
  } finally {
    source.release()
  }
}

// The holder may be a Meridian on another port, or one that just stopped: a
// dead holder's lock is taken over once it has gone a minute without a
// heartbeat, so the message says both.
function heldElsewhere(io: SeatCliIo, held: string): false {
  io.error(`${RED}✗ ${held}${RESET}`)
  io.error(`  No Meridian answers at ${runningInstanceUrl()}. Point MERIDIAN_PORT (and MERIDIAN_HOST) at the instance serving these seats;`)
  io.error("  if that process has just stopped, run this again in a minute, once its lock has gone stale.")
  return false
}

export async function removeChatGptSeat(id: string, ctx: SeatCliContext): Promise<boolean> {
  const io = ctx.io ?? defaultIo
  const source = chatGptSource(ctx)
  const surface = source ? storedChatGptSurface(source, ctx.reserved) : undefined
  const profile = surface?.resolve(id)
  if (!source || !surface || !profile) {
    io.error(`${RED}✗ Profile "${id}" not found.${RESET}`)
    return false
  }
  const refusal = surface.removalRefusal(profile)
  if (refusal) {
    io.error(`${RED}✗ ${refusal}${RESET}`)
    return false
  }
  if (envBool("CREDENTIALS_READONLY")) {
    io.error(`${RED}✗ MERIDIAN_CREDENTIALS_READONLY=1 — this instance may not modify credentials.${RESET}`)
    return false
  }
  const local = await withLease(source, async () => {
    const moves = surface.activeProfileId() === profile.id || getSetting("chatGptActiveSeat") === profile.seat
    const successor = surface.successorFor(profile.seat)
    source.removeAccount!(profile.seat)
    applyChatGptRemoval(profile, { moves, to: successor?.seat })
    return { moves, successor: successor?.id ?? null }
  })
  let outcome = "done" in local ? local.done : null
  if (!outcome) {
    const reply = await call(io, "/profiles/chatgpt/remove", { profile: profile.id })
    if (!reply) return heldElsewhere(io, "held" in local ? local.held : "")
    if (reply.status !== 200) {
      io.error(`${RED}✗ ${String(reply.data.error ?? `Remove failed (HTTP ${reply.status}).`)}${RESET}`)
      return false
    }
    outcome = { moves: reply.data.activeProfile !== undefined, successor: typeof reply.data.activeProfile === "string" ? reply.data.activeProfile : null }
  }
  io.log(`${GREEN}✓ ChatGPT seat "${profile.id}" removed; its stored credentials are deleted.${RESET}`)
  if (outcome.moves) io.log(outcome.successor ? `  Active ChatGPT seat is now "${outcome.successor}".` : "  No ChatGPT seat is left to be active.")
  return true
}

type SignInState = ChatGptLoginState | { status: "failed"; message: string }

async function waitForSignIn(read: () => Promise<SignInState | null>, io: SeatCliIo, pollMs: number): Promise<SignInState> {
  for (;;) {
    await io.sleep(pollMs)
    const state = await read()
    if (state && state.status !== "waiting" && state.status !== "exchanging") return state
  }
}

function describeSignIn(target: { existing: ChatGptProfile | undefined; name: string }): { request: { profile: string } | { name: string }; account: string } {
  return target.existing
    ? { request: { profile: target.existing.id }, account: `the ChatGPT account and workspace "${target.existing.id}" belongs to (${target.existing.label})` }
    : { request: { name: target.name }, account: `the ChatGPT account the new seat "${target.name}" should use` }
}

/**
 * `meridian profile add|login <name>` for a ChatGPT seat. `headless` gives a
 * device code to enter in any browser, on any machine; otherwise the browser
 * on this machine opens the Codex sign-in, which comes back to
 * 127.0.0.1:1455 by itself.
 */
export async function signInChatGptSeat(name: string, options: { headless?: boolean }, ctx: SeatCliContext): Promise<boolean> {
  const io = ctx.io ?? defaultIo
  const pollMs = ctx.pollMs ?? 2_000
  const source = chatGptSource(ctx)
  if (!source) {
    io.error(`${RED}✗ ChatGPT is off on this Meridian (MERIDIAN_CHATGPT_CREDENTIALS=off).${RESET}`)
    return false
  }
  if (source.mode !== "owned") {
    const owner = chatGptOwner(source.mode, null)
    io.error(`${RED}✗ ${owner.name} owns this Meridian's ChatGPT logins, so Meridian cannot sign a seat in.${RESET}`)
    io.error(`  Run \`${owner.login}\` and choose ${owner.loginMethod}; Meridian picks the seat up by itself.`)
    return false
  }
  if (envBool("CREDENTIALS_READONLY")) {
    io.error(`${RED}✗ MERIDIAN_CREDENTIALS_READONLY=1 — this instance may not modify credentials.${RESET}`)
    return false
  }
  const surface = storedChatGptSurface(source, ctx.reserved)
  const existing = surface.resolve(name)
  if (!existing) {
    const problem = chatGptNameProblem(name, ctx.reserved)
    if (problem) {
      io.error(`${RED}✗ ${problem}${RESET}`)
      return false
    }
  }
  const expect: ChatGptExpectedSeat | null = existing ? { seat: existing.seat, label: `${existing.id} (${existing.label})` } : null
  const { request, account } = describeSignIn({ existing, name })

  const finished = (state: SignInState, seat: string | null): boolean => {
    if (state.status !== "completed") {
      io.error(`${RED}✗ ${state.status === "failed" ? state.message : "The sign-in failed."}${RESET}`)
      return false
    }
    const id = storedChatGptSurface(source, ctx.reserved).profileIdFor(state.accountUserId) ?? seat ?? name
    io.log(`${GREEN}✓ ChatGPT seat "${id}" ${existing ? "signed in again" : "added"}${state.email ? ` as ${state.email}` : ""}.${RESET}`)
    return true
  }

  const showDevice = (verificationUrl: string, userCode: string) => {
    io.log(`Sign in with ${account}:`)
    io.log(`  1. Open ${verificationUrl} in any browser, on any machine.`)
    io.log(`  2. Enter this code there: ${userCode}  (it expires in 15 minutes)`)
    io.log(`${GREY}Waiting for the code to be entered... (Ctrl-C cancels)${RESET}`)
  }
  const showBrowser = (authorizeUrl: string, loopback: boolean) => {
    io.log(`Sign in with ${account}. Opening the ChatGPT sign-in in your browser; if it does not open, use:`)
    io.log(`  ${authorizeUrl}`)
    io.openUrl(authorizeUrl)
    if (loopback) io.log(`${GREY}Waiting for the browser to come back to 127.0.0.1:1455... On another machine? Ctrl-C and run again with --headless.${RESET}`)
  }
  const pasteLoop = async (complete: (pasted: string) => Promise<{ ok: boolean; message?: string; retryable?: boolean; state?: SignInState }>): Promise<SignInState> => {
    io.log("The sign-in tab ends on an address starting with http://127.0.0.1:1455 that does not load; that is expected.")
    for (;;) {
      const pasted = await io.prompt("Paste that whole address:")
      const result = await complete(pasted)
      if (result.state) return result.state
      if (!result.retryable) return { status: "failed", message: result.message ?? "The sign-in failed." }
      io.error(`${RED}✗ ${result.message}${RESET}`)
    }
  }

  const local = await withLease(source, async () => {
    const login = createChatGptLogin({
      connect: (connected, context) => {
        source.connectAccount!(connected)
        if (!context.name) return
        const named = storedChatGptSurface(source, ctx.reserved)
        const current = named.resolve(connected.accountUserId)
        if (!current || current.id === context.name) return
        const plan = named.planRename(current.id, context.name)
        if (plan.ok) applyChatGptRename(plan)
        else io.error(`  The seat keeps the name "${current.id}": ${plan.error}`)
      },
      renderPage: result => renderLoginCallbackPage(result.ok
        ? { ok: true, okMessage: `ChatGPT seat${result.email ? ` ${result.email}` : ""} is connected to Meridian. You can close this tab.` }
        : { ok: false, message: result.message }),
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
      log: () => {},
    })
    try {
      const startName = existing ? null : name
      if (options.headless) {
        const started = await login.startDevice({ name: startName, expect })
        if (!started.ok) return { status: "failed", message: started.message } satisfies SignInState
        showDevice(started.verificationUrl, started.userCode)
        return await waitForSignIn(async () => login.status(started.connectId) ?? null, io, pollMs)
      }
      const started = await login.start({ name: startName, expect })
      showBrowser(started.authorizeUrl, started.loopback)
      if (started.loopback) return await waitForSignIn(async () => login.status(started.connectId) ?? null, io, pollMs)
      return await pasteLoop(async pasted => {
        const result = await login.complete(started.connectId, pasted)
        if (result.ok) return { ok: true, state: login.status(started.connectId) }
        return { ok: false, message: result.message, retryable: result.retryable }
      })
    } finally {
      login.close()
    }
  })
  if ("done" in local) return finished(local.done, null)

  // A running instance holds the store: it runs the sign-in and files the seat.
  const route = options.headless ? "/profiles/chatgpt/connect/device" : "/profiles/chatgpt/connect/start"
  const started = await call(io, route, request)
  if (!started) return heldElsewhere(io, local.held)
  if (started.status !== 200) {
    io.error(`${RED}✗ ${String(started.data.error ?? `Could not start the sign-in (HTTP ${started.status}).`)}${RESET}`)
    return false
  }
  const connectId = String(started.data.connectId)
  const readStatus = async (): Promise<SignInState | null> => {
    const reply = await call(io, `/profiles/chatgpt/connect/status?connectId=${encodeURIComponent(connectId)}`)
    if (!reply) return null
    if (reply.status !== 200) return { status: "failed", message: String(reply.data.error ?? `HTTP ${reply.status}`) }
    return reply.data as unknown as SignInState
  }
  if (options.headless) {
    showDevice(String(started.data.verificationUrl), String(started.data.userCode))
    return finished(await waitForSignIn(readStatus, io, pollMs), null)
  }
  const loopback = started.data.loopback === true
  showBrowser(String(started.data.authorizeUrl), loopback)
  if (loopback) return finished(await waitForSignIn(readStatus, io, pollMs), null)
  return finished(await pasteLoop(async pasted => {
    const reply = await call(io, "/profiles/chatgpt/connect/complete", { connectId, url: pasted })
    if (!reply) return { ok: false, message: "Could not reach Meridian.", retryable: true }
    if (reply.status === 200) return { ok: true, state: { status: "completed", accountUserId: String(reply.data.seat), email: (reply.data.email as string | null) ?? null } }
    return { ok: false, message: String(reply.data.error ?? `HTTP ${reply.status}`), retryable: reply.data.retryable === true }
  }), null)
}
