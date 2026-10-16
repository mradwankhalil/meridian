/**
 * Did this ChatGPT response fail, and is another account worth trying?
 *
 * Meridian answers the same question for Anthropic in `sniffAccountFailure`
 * (`server.ts`), which reads ONE complete frame and lets it decide, because an
 * Anthropic error stream leads with `event: error`. A Responses stream always
 * leads with `response.created`, so that rule reads the preamble of a doomed
 * stream and calls it healthy. This scans further.
 *
 * WHERE IT STOPS IS THE ENTIRE DESIGN. Scanning too little misses a failure
 * that was two frames away; scanning too far means retrying a turn whose
 * output the client already holds, which bills a second account for work that
 * was already delivered. So the scan runs while the stream is still saying
 * nothing - and stops the instant a frame carries anything a client could
 * render. A failure after that point belongs to the client.
 *
 * An unrecognized frame counts as output. That is the fail-safe direction:
 * treating an unknown event as more preamble would keep scanning past
 * something that might have been content.
 *
 * A failure record carries a classification and a status and nothing else.
 * The provider's own wording reaches the CLIENT through the passthrough,
 * where it is useful; it is kept out of the value Meridian logs and stores.
 */

export type ChatGptFailureKind =
  /** The credential was refused. Another account may work; this one needs a human. */
  | "requires_reauth"
  /** This account's quota window is spent. */
  | "rate_limited"
  /** The provider had a problem of its own. */
  | "transient"
  /** The stream announced its own failure before producing anything. */
  | "stream_failed"

export interface ChatGptFailure {
  readonly kind: ChatGptFailureKind
  readonly status: number
}

export interface SniffedChatGptResponse {
  readonly failure: ChatGptFailure | null
  /** Every byte the response would have delivered, consumed frames included. */
  readonly body: ReadableStream<Uint8Array>
}

type ByteChunk =
  | { done: false; value: Uint8Array }
  | { done: true; value?: undefined }

/**
 * Only the reader surface this module uses. Named structurally rather than as
 * `ReadableStreamDefaultReader<Uint8Array>` because bun augments that type
 * with `readMany`, which `Response.body.getReader()` does not return.
 */
interface ByteStreamReader {
  read(): Promise<ByteChunk>
  cancel(reason?: unknown): Promise<void>
}

/** Events emitted while a response exists but has produced nothing. */
const PREAMBLE_EVENTS: ReadonlySet<string> = new Set([
  "response.created",
  "response.queued",
  "response.in_progress",
])

const FAILURE_EVENTS: ReadonlySet<string> = new Set([
  "response.failed",
  "error",
])

/**
 * Bounds on the scan. A remote party decides how long its preamble runs, so
 * without these it also decides how much memory Meridian holds. Both are far
 * above any real preamble; tripping either resolves to "nothing conclusive
 * seen", which is the same answer as a stream that simply started producing.
 */
const MAX_SNIFF_BYTES = 64 * 1024
const MAX_SNIFF_FRAMES = 64

type FrameClass = "preamble" | "failure" | "output"

/** SSE comments and blank lines are protocol filler: no content, safe to scan past. */
function isFillerFrame(frame: string): boolean {
  return frame.split("\n").every(line => line.trim() === "" || line.startsWith(":"))
}

/**
 * The event a frame announces, from its `event:` line or, failing that, the
 * `type` inside its `data:` payload. Providers send one form or the other.
 */
function frameEventName(frame: string): string | undefined {
  let data: string | undefined
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) return line.slice(6).trim()
    if (line.startsWith("data:") && data === undefined) data = line.slice(5).trim()
  }
  if (!data) return undefined
  try {
    const parsed = JSON.parse(data) as { type?: unknown }
    return typeof parsed.type === "string" ? parsed.type : undefined
  } catch {
    return undefined
  }
}

const CLIENT_REQUEST_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_request_error",
  "invalid_prompt",
  "context_length_exceeded",
  "string_above_max_length",
  "content_filter",
])

function isClientRequestErrorFrame(frame: string): boolean {
  let data: string | undefined
  for (const line of frame.split("\n")) {
    if (line.startsWith("data:") && data === undefined) data = line.slice(5).trim()
  }
  if (!data) return false
  try {
    const parsed = JSON.parse(data) as {
      code?: unknown
      error?: { code?: unknown; type?: unknown }
      response?: { error?: { code?: unknown; type?: unknown } }
    }
    const err = parsed.response?.error ?? parsed.error
    const code = typeof err?.code === "string"
      ? err.code
      : typeof parsed.code === "string"
        ? parsed.code
        : typeof err?.type === "string"
          ? err.type
          : undefined
    return code !== undefined && CLIENT_REQUEST_ERROR_CODES.has(code)
  } catch {
    return false
  }
}

function classifyFrame(frame: string): FrameClass {
  if (isFillerFrame(frame)) return "preamble"
  const name = frameEventName(frame)
  if (name === undefined) return "output"
  if (FAILURE_EVENTS.has(name)) return isClientRequestErrorFrame(frame) ? "output" : "failure"
  return PREAMBLE_EVENTS.has(name) ? "preamble" : "output"
}

function failureForStatus(status: number): ChatGptFailure | null {
  if (status === 401 || status === 403) return { kind: "requires_reauth", status }
  if (status === 429) return { kind: "rate_limited", status }
  if (status >= 500) return { kind: "transient", status }
  return null
}

const MODEL_REFUSAL = /(not supported|unsupported|not available|unavailable|does not exist|not found|unknown|not allowed|no access)/i
const PARAMETER_REFUSAL = /\b(parameter|argument|temperature|top_p|max_output_tokens|reasoning_effort|truncation|tool_choice|parallel_tool_calls|response_format)\b/i

/**
 * Whether a 400/404 refuses the requested MODEL, rather than another part of
 * the request: "The 'gpt-6.1-sol' model is not supported when using Codex
 * with a ChatGPT account." Which models a seat may use follows its plan
 * (measured 2026-10-02: a free seat refuses gpt-6.1-sol, a Business seat
 * serves it), so another seat - or another model - may still serve the turn.
 */
export function isModelRefusal(status: number, text: string): boolean {
  return (status === 400 || status === 404)
    && /\bmodel\b/i.test(text)
    && MODEL_REFUSAL.test(text)
    && !PARAMETER_REFUSAL.test(text)
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
}

function replay(consumed: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of consumed) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function replayThenContinue(
  consumed: readonly Uint8Array[],
  reader: ByteStreamReader,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of consumed) controller.enqueue(chunk)
    },
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {})
    },
  })
}

export async function sniffChatGptFailure(res: Response): Promise<SniffedChatGptResponse> {
  // Status first, and without touching the body. A refused credential or a
  // spent window says so in the status line, and reading the body to confirm
  // would only risk consuming what the client still needs.
  const statusFailure = failureForStatus(res.status)
  if (statusFailure) return { failure: statusFailure, body: res.body ?? emptyStream() }

  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return { failure: null, body: res.body ?? emptyStream() }
  }

  const reader = res.body?.getReader()
  if (!reader) return { failure: null, body: emptyStream() }

  const decoder = new TextDecoder()
  const consumed: Uint8Array[] = []
  let pending = ""
  let bytes = 0
  let frames = 0
  let failure: ChatGptFailure | null = null
  let exhausted = false

  scan: for (;;) {
    let chunk: ByteChunk
    try {
      chunk = await reader.read()
    } catch {
      // The stream broke while we were still deciding. That is not an account
      // failure, and re-raising it here would strip the bytes already read;
      // the passthrough below replays them and lets the error land where the
      // client can see it.
      break
    }
    if (chunk.done) { exhausted = true; break }

    consumed.push(chunk.value)
    bytes += chunk.value.byteLength
    pending += decoder.decode(chunk.value, { stream: true })

    // A socket splits where it likes: one read may carry several frames or
    // half of one, so every complete frame in the buffer is examined before
    // the next read rather than only the first.
    for (;;) {
      const end = pending.indexOf("\n\n")
      if (end === -1) break
      const frame = pending.slice(0, end)
      pending = pending.slice(end + 2)
      frames++
      const kind = classifyFrame(frame)
      if (kind === "failure") {
        failure = { kind: "stream_failed", status: res.status }
        break scan
      }
      if (kind === "output") break scan
    }

    if (bytes >= MAX_SNIFF_BYTES || frames >= MAX_SNIFF_FRAMES) break
  }

  if (failure) {
    await reader.cancel().catch(() => {})
    return { failure, body: replay(consumed) }
  }
  return {
    failure: null,
    body: exhausted ? replay(consumed) : replayThenContinue(consumed, reader),
  }
}
