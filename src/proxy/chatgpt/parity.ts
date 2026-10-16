/**
 * Meridian's per-request features on the ChatGPT path: Thinking Passthrough,
 * Max Budget (USD), Fallback Model, and Retry-After.
 *
 * Everything here sits AROUND the pass-through backend rather than inside it.
 * The outbound body is never edited here, with one operator-configured
 * exception: a Fallback Model retry resends the client's own body with
 * `model` replaced, and nothing else. (The other operator-configured edit,
 * Reasoning Summary, is a body adaptation in chatgpt/body.ts, so the retry
 * carries it too.) Every other feature acts on the response - and only when
 * the operator turned it on, so with the defaults the stream reaches the
 * client byte for byte.
 *
 * - Thinking Passthrough (default on). ChatGPT never exposes raw reasoning,
 *   only short reasoning SUMMARIES plus opaque encrypted content. Off drops the
 *   summary events and empties `summary` on reasoning items, but keeps each
 *   item and its `encrypted_content`: with store=false the client must replay
 *   them next turn, so deleting the item would break multi-turn reasoning.
 * - Max Budget. Checked where the information exists: an estimate of the
 *   input before anything is sent (refuse without contacting ChatGPT), a
 *   running estimate of visible output while streaming (stop the turn with a
 *   `response.failed` frame), and the provider's actual usage once the turn
 *   ends (flag it). Hidden reasoning tokens are only reported at the end, so
 *   the mid-stream check undercounts reasoning-heavy turns.
 * - Fallback Model. One retry on the configured ChatGPT model when the turn
 *   failed before the client received anything: a 5xx, every seat rate
 *   limited, or the model refused. A refused credential never falls back -
 *   another model does not fix a login.
 *
 * Turn state crosses the backend's hooks through a ledger keyed by the HTTP
 * context, so the backend module needs no knowledge of these features.
 */
import type { ChatGptTurnEvent, ChatGptTurnInfo } from "../backends/chatgpt"
import type { UpstreamBackend } from "../upstream/backend"
import { retryAfterSeconds } from "../retryAfter"
import { estimateRequestCostUsd, ratesForPrompt, type ModelPricing } from "../../telemetry/pricing"
import type { ChatGptFeatures } from "./features"
import { isModelRefusal } from "./stream"
import type { ChatGptUsage } from "./tap"

export const MAX_BUDGET_ERROR_CODE = "max_budget_exceeded"
export const FALLBACK_MODEL_HEADER = "x-meridian-fallback-model"

/** Rough bytes per token; the same rule of thumb the estimate on both ends uses. */
const BYTES_PER_TOKEN = 4
const MAX_TRACKED_TURNS = 10_000
const MAX_ERROR_BODY_BYTES = 64 * 1024

/**
 * ChatGPT usage in Meridian's telemetry shape: `inputTokens` is the UNCACHED
 * part and cache reads are separate, as for Claude. ChatGPT reports a total
 * with `cached_tokens` inside it, and `reasoning_tokens` inside
 * `output_tokens`, so neither is added a second time.
 */
export function chatGptTokenFields(usage: ChatGptUsage) {
  return {
    inputTokens: Math.max(0, usage.inputTokens - usage.cachedInputTokens),
    cacheReadInputTokens: usage.cachedInputTokens,
    cacheCreationInputTokens: 0,
    outputTokens: usage.outputTokens,
  }
}

export function chatGptCostUsd(usage: ChatGptUsage, pricing: ModelPricing): number {
  return estimateRequestCostUsd(chatGptTokenFields(usage), pricing)
}

// --- Turn ledger -----------------------------------------------------------

export interface ChatGptTurnNotes {
  /** The features as they were when the client request arrived. */
  readonly features: ChatGptFeatures
  /** The model the client asked for. */
  requestedModel?: string
  /** Estimated input cost of the turn being served, for the running budget. */
  inputEstimateUsd?: number
  /** Estimated prompt tokens of that turn; picks the long-context rate for its output. */
  inputEstimateTokens?: number
  refusedByBudget?: boolean
  /** Set when a Fallback Model retry served the turn instead of this model. */
  fallbackFrom?: string
  /** The model whose stream was stopped by Max Budget. */
  budgetExceededFor?: string
}

/**
 * Carries one client request's notes from the parity layer through the
 * backend's `admit` and `onTurn` hooks. The backend hands `admit` the inbound
 * request's headers and a request id, and `onTurn` only the id, so the ledger
 * maps headers -> context at the rebuild and id -> context at admission.
 */
export class ChatGptTurnLedger<Ctx extends object> {
  private readonly contextByHeaders = new WeakMap<Headers, Ctx>()
  private readonly contextByRequest = new Map<string, Ctx>()
  private readonly notesByContext = new WeakMap<Ctx, ChatGptTurnNotes>()

  open(context: Ctx, features: ChatGptFeatures): ChatGptTurnNotes {
    let notes = this.notesByContext.get(context)
    if (!notes) {
      notes = { features }
      this.notesByContext.set(context, notes)
    }
    return notes
  }

  /** Called where the backend's inbound request is rebuilt. */
  bindInbound(request: Request, context: Ctx): void {
    this.contextByHeaders.set(request.headers, context)
  }

  admitted(turn: Pick<ChatGptTurnInfo, "requestId" | "headers">): ChatGptTurnNotes | undefined {
    const context = this.contextByHeaders.get(turn.headers)
    if (!context) return undefined
    this.contextByRequest.set(turn.requestId, context)
    // Bounded: a turn whose onTurn never arrives must not pin its context.
    if (this.contextByRequest.size > MAX_TRACKED_TURNS) {
      const oldest = this.contextByRequest.keys().next().value
      if (oldest !== undefined) this.contextByRequest.delete(oldest)
    }
    return this.notesByContext.get(context)
  }

  /** The notes for a finished turn; forgets the id. */
  settle(requestId: string): ChatGptTurnNotes | undefined {
    const context = this.contextByRequest.get(requestId)
    this.contextByRequest.delete(requestId)
    return context ? this.notesByContext.get(context) : undefined
  }
}

// --- Max Budget: admission -------------------------------------------------

function errorResponse(status: number, type: string, message: string, code: string | null = null): Response {
  return new Response(JSON.stringify({ error: { type, message, code } }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function estimatePromptTokens(body: Readonly<Record<string, unknown>>): number {
  return Math.ceil(JSON.stringify(body).length / BYTES_PER_TOKEN)
}

export function estimateInputUsd(promptTokens: number, pricing: ModelPricing): number {
  return (promptTokens / 1e6) * ratesForPrompt(pricing, promptTokens).inputPerMTok
}

/**
 * The backend's `admit` hook. Records which model the client asked for and,
 * with a budget set, refuses a turn whose input alone is estimated over it -
 * before any seat is contacted, so nothing is billed.
 */
export function createChatGptAdmission<Ctx extends object>(options: {
  ledger: ChatGptTurnLedger<Ctx>
  features: () => ChatGptFeatures
  pricing: (model: string) => ModelPricing | null
}) {
  return (turn: ChatGptTurnInfo): Response | undefined => {
    const notes = options.ledger.admitted(turn)
    const features = notes?.features ?? options.features()
    if (notes && notes.requestedModel === undefined) notes.requestedModel = turn.model
    if (features.maxBudgetUsd <= 0 || !turn.model) return undefined
    const pricing = options.pricing(turn.model)
    if (!pricing) return undefined
    const promptTokens = estimatePromptTokens(turn.body)
    const inputUsd = estimateInputUsd(promptTokens, pricing)
    if (notes) {
      notes.inputEstimateUsd = inputUsd
      notes.inputEstimateTokens = promptTokens
    }
    if (inputUsd <= features.maxBudgetUsd) return undefined
    if (notes) notes.refusedByBudget = true
    return errorResponse(
      400,
      "invalid_request_error",
      `This request's input alone is estimated at $${inputUsd.toFixed(4)}, over Meridian's Max Budget of `
        + `$${features.maxBudgetUsd} per request. It was not sent to ChatGPT.`,
      MAX_BUDGET_ERROR_CODE,
    )
  }
}

// --- Telemetry decoration --------------------------------------------------

export interface ChatGptTurnDecoration {
  error: string | null
  fallbackFromModel?: string
}

/**
 * What the parity features add to a turn's telemetry: which model a fallback
 * replaced, and whether the turn broke the budget - stopped mid-stream, or
 * found over it once the provider reported actual usage.
 */
export function decorateChatGptTurn(
  event: ChatGptTurnEvent,
  notes: ChatGptTurnNotes | undefined,
  pricing: (model: string) => ModelPricing | null,
): ChatGptTurnDecoration {
  let error = event.error
  if (!notes) return { error }
  // The model id this turn was sent with, and the one the provider says
  // answered; the latter is what telemetry prices, so the budget does too.
  const servedModel = event.requestModel ?? undefined
  const pricedModel = event.model ?? servedModel
  if (notes.budgetExceededFor !== undefined && notes.budgetExceededFor === servedModel) error = MAX_BUDGET_ERROR_CODE
  else if (!error && event.usage && pricedModel && notes.features.maxBudgetUsd > 0) {
    const rates = pricing(pricedModel)
    if (rates && chatGptCostUsd(event.usage, rates) > notes.features.maxBudgetUsd) error = MAX_BUDGET_ERROR_CODE
  }
  const fallbackFromModel = notes.fallbackFrom !== undefined && servedModel !== notes.fallbackFrom
    ? notes.fallbackFrom
    : undefined
  return { error, ...(fallbackFromModel ? { fallbackFromModel } : {}) }
}

/**
 * Logs once per model id when a served turn has no price, so a model OpenAI
 * released since the last pricing update shows up in the journal instead of
 * only as an unpriced row. A later override or table update is picked up by
 * the next turn, since the price is looked up each time.
 */
export function createUnpricedModelWarning(
  pricing: (model: string) => ModelPricing | null,
  log: (message: string) => void,
): (model: string) => void {
  const warned = new Set<string>()
  return (model) => {
    if (warned.has(model) || pricing(model)) return
    warned.add(model)
    log(`[PROXY] chatgpt model=${model} has no price; its turns are left out of the cost estimate. Run scripts/update-openai-pricing.ts or set a pricing override.`)
  }
}

// --- Response stream transform ---------------------------------------------

interface SseEvent {
  type: string
  data: Record<string, unknown>
}

function parseFrame(frame: string): SseEvent | null {
  let type: string | undefined
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice(6).trim()
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart())
  }
  if (data.length === 0) return null
  try {
    const parsed = JSON.parse(data.join("\n")) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const name = typeof record.type === "string" ? record.type : type
    return name ? { type: name, data: record } : null
  } catch {
    return null
  }
}

/** Re-emit a frame with new data, keeping its other lines (event, id, comments) in place. */
function serializeFrame(frame: string, data: Record<string, unknown>): string {
  const out: string[] = []
  let wrote = false
  for (const line of frame.split(/\r?\n/)) {
    if (!line.startsWith("data:")) out.push(line)
    else if (!wrote) {
      out.push(`data: ${JSON.stringify(data)}`)
      wrote = true
    }
  }
  return out.join("\n")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function emptySummary(item: unknown): boolean {
  if (!isRecord(item) || item.type !== "reasoning" || !Array.isArray(item.summary) || item.summary.length === 0) return false
  item.summary = []
  return true
}

/**
 * Empty the reasoning summaries in a Responses object or event, in place.
 * Returns whether anything changed. The reasoning item, its id and its
 * `encrypted_content` stay.
 */
export function stripReasoningSummaries(value: Record<string, unknown>): boolean {
  let changed = emptySummary(value.item)
  const output = isRecord(value.response) ? value.response.output : value.output
  if (Array.isArray(output)) for (const item of output) changed = emptySummary(item) || changed
  return changed
}

const TERMINAL_EVENTS: ReadonlySet<string> = new Set(["response.completed", "response.failed", "response.incomplete"])

export interface StreamBudget {
  limitUsd: number
  /** Estimated input cost, already committed when the stream starts. */
  inputUsd: number
  outputPerMTok: number
  model: string
  onExceeded(): void
}

export interface ResponsesStreamTransform {
  stripSummaries: boolean
  budget?: StreamBudget
}

function budgetFailedFrame(responseId: string | null, budget: StreamBudget): string {
  const data = {
    type: "response.failed",
    response: {
      id: responseId ?? "resp_meridian_max_budget",
      object: "response",
      status: "failed",
      model: budget.model,
      output: [],
      error: {
        code: MAX_BUDGET_ERROR_CODE,
        message: `Meridian stopped this response: its estimated cost passed the Max Budget of $${budget.limitUsd} per request.`,
      },
    },
  }
  return `event: response.failed\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * Apply Thinking Passthrough (off) and the running Max Budget to a Responses
 * SSE stream. Frames that neither feature touches are emitted as their
 * original text. On a budget breach the upstream is cancelled - which stops
 * generation and billing - and the client gets a terminal `response.failed`.
 */
export function transformResponsesStream(
  body: ReadableStream<Uint8Array>,
  options: ResponsesStreamTransform,
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const { budget } = options
  let pending = ""
  let outputChars = 0
  let responseId: string | null = null
  let finished = false
  let exceeded = false

  const overBudget = () => {
    if (!budget || finished) return false
    const outputUsd = (Math.ceil(outputChars / BYTES_PER_TOKEN) / 1e6) * budget.outputPerMTok
    return budget.inputUsd + outputUsd > budget.limitUsd
  }

  const processFrame = (frame: string, delimiter: string): string => {
    const event = parseFrame(frame)
    if (!event) return frame + delimiter
    const response = event.data.response
    if (responseId === null && isRecord(response) && typeof response.id === "string") responseId = response.id
    if (TERMINAL_EVENTS.has(event.type)) finished = true
    if (typeof event.data.delta === "string") outputChars += event.data.delta.length
    if (!options.stripSummaries) return frame + delimiter
    if (event.type.startsWith("response.reasoning_summary")) return ""
    return stripReasoningSummaries(event.data) ? serializeFrame(frame, event.data) + delimiter : frame + delimiter
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (exceeded) { controller.close(); return }
        let chunk: Awaited<ReturnType<typeof reader.read>>
        try {
          chunk = await reader.read()
        } catch (error) {
          controller.error(error)
          return
        }
        if (chunk.done) {
          pending += decoder.decode()
          if (pending) controller.enqueue(encoder.encode(pending.trim() ? processFrame(pending, "") : pending))
          controller.close()
          return
        }
        pending += decoder.decode(chunk.value, { stream: true })
        let out = ""
        const delimiter = /\r?\n\r?\n/g
        let consumed = 0
        let match: RegExpExecArray | null
        while ((match = delimiter.exec(pending)) !== null) {
          out += processFrame(pending.slice(consumed, match.index), match[0])
          consumed = match.index + match[0].length
          if (overBudget()) {
            exceeded = true
            break
          }
        }
        pending = pending.slice(consumed)
        if (exceeded && budget) {
          controller.enqueue(encoder.encode(out + budgetFailedFrame(responseId, budget)))
          budget.onExceeded()
          await reader.cancel(new Error(MAX_BUDGET_ERROR_CODE)).catch(() => {})
          controller.close()
          return
        }
        if (out) {
          controller.enqueue(encoder.encode(out))
          return
        }
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => {})
    },
  })
}

// --- Fallback Model ------------------------------------------------------

/**
 * Why this unanswered response should be retried on the fallback model, or
 * null. Reads the body only for a 400/404, which is a short JSON error; the
 * response handed back carries the same bytes either way.
 */
export async function fallbackTrigger(response: Response): Promise<{ trigger: string | null; response: Response }> {
  if (response.status === 429) return { trigger: "rate_limited", response }
  if (response.status >= 500) return { trigger: "upstream_error", response }
  if (response.status !== 400 && response.status !== 404) return { trigger: null, response }
  const text = (await response.text()).slice(0, MAX_ERROR_BODY_BYTES)
  const rebuilt = new Response(text, { status: response.status, headers: response.headers })
  return { trigger: isModelRefusal(response.status, text) ? "model_refused" : null, response: rebuilt }
}

// --- The wrapping backend --------------------------------------------------

export interface ChatGptParityOptions<Ctx extends object> {
  inner: UpstreamBackend<Ctx>
  ledger: ChatGptTurnLedger<Ctx>
  features: () => ChatGptFeatures
  /** The client's own body, as received. */
  readBody: (context: Ctx) => Promise<string>
  /** Make the inner backend's next rebuild of this request carry `body` instead. */
  overrideBody: (context: Ctx, body: string) => void
  pricing: (model: string) => ModelPricing | null
  /** Epoch ms at which the first benched ChatGPT seat frees up, or null. */
  earliestSeatReset: () => number | null
  log?: (line: string) => void
}

function withHeaders(response: Response, set: Record<string, string>, body: ReadableStream<Uint8Array> | string | null = response.body): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(set)) headers.set(name, value)
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

export function createChatGptParityBackend<Ctx extends object>(options: ChatGptParityOptions<Ctx>): UpstreamBackend<Ctx> {
  const { inner, ledger } = options
  const unpricedLogged = new Set<string>()

  const tryFallback = async (
    request: Parameters<UpstreamBackend<Ctx>["handle"]>[0],
    notes: ChatGptTurnNotes,
    response: Response,
  ): Promise<{ response: Response; served: string | undefined }> => {
    const fallback = notes.features.fallbackModel
    const requested = notes.requestedModel
    if (!fallback || !requested || fallback === requested || notes.refusedByBudget || response.ok || response.status === 401) {
      return { response, served: requested }
    }
    const check = await fallbackTrigger(response)
    if (!check.trigger) return { response: check.response, served: requested }
    let original: Record<string, unknown>
    try {
      original = JSON.parse(await options.readBody(request.context)) as Record<string, unknown>
    } catch {
      return { response: check.response, served: requested }
    }
    await check.response.body?.cancel().catch(() => {})
    notes.fallbackFrom = requested
    options.log?.(`[PROXY] chatgpt fallback ${requested} -> ${fallback} (${check.trigger})`)
    options.overrideBody(request.context, JSON.stringify({ ...original, model: fallback }))
    return { response: await inner.handle(request), served: fallback }
  }

  const withRetryAfter = (response: Response): Response => {
    if (response.headers.has("retry-after")) return response
    const seconds = retryAfterSeconds({
      status: response.status,
      resetAtMs: response.status === 429 ? options.earliestSeatReset() : null,
    })
    return seconds === null ? response : withHeaders(response, { "retry-after": String(seconds) })
  }

  const budgetFor = (notes: ChatGptTurnNotes, served: string | undefined): StreamBudget | undefined => {
    const limitUsd = notes.features.maxBudgetUsd
    if (limitUsd <= 0 || !served) return undefined
    const pricing = options.pricing(served)
    if (!pricing) {
      // Unpriced is not free: serve, but say once that the budget cannot apply.
      if (!unpricedLogged.has(served)) {
        unpricedLogged.add(served)
        options.log?.(`[PROXY] chatgpt Max Budget not enforced for ${served}: no pricing for this model`)
      }
      return undefined
    }
    return {
      limitUsd,
      inputUsd: notes.inputEstimateUsd ?? 0,
      outputPerMTok: ratesForPrompt(pricing, notes.inputEstimateTokens ?? 0).outputPerMTok,
      model: served,
      onExceeded: () => { notes.budgetExceededFor = served },
    }
  }

  const transformBody = async (response: Response, notes: ChatGptTurnNotes, served: string | undefined): Promise<Response> => {
    if (!response.ok || !response.body) return response
    const stripSummaries = !notes.features.thinkingPassthrough
    const contentType = response.headers.get("content-type") ?? ""
    if (contentType.includes("text/event-stream")) {
      const budget = budgetFor(notes, served)
      if (!stripSummaries && !budget) return response
      return withHeaders(response, {}, transformResponsesStream(response.body, { stripSummaries, budget }))
    }
    if (!stripSummaries || !contentType.includes("application/json")) return response
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as unknown
      if (isRecord(parsed) && stripReasoningSummaries(parsed)) return withHeaders(response, {}, JSON.stringify(parsed))
    } catch {
      // Not JSON after all: hand the bytes back as they were.
    }
    return withHeaders(response, {}, text)
  }

  return {
    provider: inner.provider,
    async handle(request) {
      if (request.endpoint !== "responses") return inner.handle(request)
      const notes = ledger.open(request.context, options.features())
      const first = await inner.handle(request)
      const { response: answered, served } = await tryFallback(request, notes, first)
      let response = withRetryAfter(answered)
      response = await transformBody(response, notes, served)
      if (notes.fallbackFrom !== undefined && served) response = withHeaders(response, { [FALLBACK_MODEL_HEADER]: served })
      return response
    },
  }
}
