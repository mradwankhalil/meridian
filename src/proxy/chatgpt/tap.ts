/**
 * Reading a ChatGPT Responses stream without changing it.
 *
 * `tapResponsesStream` forwards every byte unchanged and, on the side, notes
 * what telemetry needs: when the first output frame arrived, the final usage
 * from `response.completed`, and how many reasoning-summary events passed
 * through. ChatGPT exposes reasoning only as short summary text plus opaque
 * encrypted content; both reach the client untouched, which is the whole of
 * reasoning passthrough on this provider.
 *
 * `aggregateResponsesStream` serves a client that did not ask to stream: the
 * backend only streams, so the final `response` object is lifted out of the
 * terminal event and returned as the JSON body the client expected.
 */

export interface ChatGptUsage {
  /** Total input tokens, cached ones included. */
  inputTokens: number
  cachedInputTokens: number
  /** Output tokens; reasoning tokens are INSIDE this number. */
  outputTokens: number
  reasoningTokens: number
}

export interface TapSummary {
  /** Epoch ms of the first frame that carried output, or null. */
  firstOutputAt: number | null
  usage: ChatGptUsage | null
  /** The model the provider says answered. */
  model: string | null
  /** `completed`, `failed`, `incomplete`, or null if no terminal event arrived. */
  outcome: string | null
  reasoningSummaryEvents: number
  /** Why the stream ended early: client cancel or transport error. */
  interrupted: "cancelled" | "error" | null
}

const TERMINAL: Record<string, string> = {
  "response.completed": "completed",
  "response.failed": "failed",
  "response.incomplete": "incomplete",
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function usageFromResponse(response: unknown): ChatGptUsage | null {
  if (typeof response !== "object" || response === null) return null
  const usage = (response as Record<string, unknown>).usage
  if (typeof usage !== "object" || usage === null) return null
  const u = usage as Record<string, unknown>
  const inDetails = (u.input_tokens_details ?? {}) as Record<string, unknown>
  const outDetails = (u.output_tokens_details ?? {}) as Record<string, unknown>
  return {
    inputTokens: num(u.input_tokens),
    cachedInputTokens: num(inDetails.cached_tokens),
    outputTokens: num(u.output_tokens),
    reasoningTokens: num(outDetails.reasoning_tokens),
  }
}

function eventOf(frame: string): { type: string; data: Record<string, unknown> } | null {
  let dataText = ""
  let type: string | undefined
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim()
    else if (line.startsWith("data:")) dataText += line.slice(5).trim()
  }
  if (!dataText) return null
  try {
    const data = JSON.parse(dataText) as Record<string, unknown>
    const name = typeof data.type === "string" ? data.type : type
    return name ? { type: name, data } : null
  } catch {
    return null
  }
}

/** Incremental SSE frame splitter shared by the tap and the aggregator. */
function frameSplitter(onFrame: (frame: string) => void) {
  const decoder = new TextDecoder()
  let pending = ""
  return (chunk: Uint8Array | null) => {
    pending += chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode()
    pending = pending.replace(/\r\n/g, "\n")
    for (;;) {
      const end = pending.indexOf("\n\n")
      if (end === -1) break
      onFrame(pending.slice(0, end))
      pending = pending.slice(end + 2)
    }
    if (!chunk && pending.trim()) { onFrame(pending); pending = "" }
  }
}

export function tapResponsesStream(
  body: ReadableStream<Uint8Array>,
  onDone: (summary: TapSummary) => void,
  now: () => number = Date.now,
): ReadableStream<Uint8Array> {
  const summary: TapSummary = { firstOutputAt: null, usage: null, model: null, outcome: null, reasoningSummaryEvents: 0, interrupted: null }
  let done = false
  const finish = () => {
    if (done) return
    done = true
    onDone(summary)
  }
  const feed = frameSplitter(frame => {
    const event = eventOf(frame)
    if (!event) return
    if (event.type.startsWith("response.reasoning_summary")) summary.reasoningSummaryEvents++
    if (summary.firstOutputAt === null && (event.type.endsWith(".delta") || event.type === "response.output_item.added")) {
      summary.firstOutputAt = now()
    }
    const outcome = TERMINAL[event.type]
    if (outcome) {
      summary.outcome = outcome
      const response = event.data.response as Record<string, unknown> | undefined
      summary.usage = usageFromResponse(response)
      if (typeof response?.model === "string") summary.model = response.model
    }
  })
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>
      try {
        chunk = await reader.read()
      } catch (error) {
        summary.interrupted = "error"
        finish()
        controller.error(error)
        return
      }
      if (chunk.done) {
        feed(null)
        finish()
        controller.close()
        return
      }
      feed(chunk.value)
      controller.enqueue(chunk.value)
    },
    async cancel(reason) {
      summary.interrupted = "cancelled"
      finish()
      await reader.cancel(reason).catch(() => {})
    },
  })
}

/**
 * The terminal `response` object of a Responses stream, or null if the stream
 * ended without one.
 *
 * The Codex backend's `response.completed` carries `output: []` (measured
 * 2026-09-27); the items arrive only as `response.output_item.done` events.
 * An empty terminal `output` is therefore rebuilt from those, in output_index
 * order, so a non-streaming client receives the answer it asked for.
 */
export async function aggregateResponsesStream(body: ReadableStream<Uint8Array>): Promise<Record<string, unknown> | null> {
  const terminal: { response: Record<string, unknown> | null } = { response: null }
  const items: Array<{ index: number; item: unknown }> = []
  const feed = frameSplitter(frame => {
    const event = eventOf(frame)
    if (!event) return
    if (event.type === "response.output_item.done" && event.data.item !== undefined) {
      items.push({ index: typeof event.data.output_index === "number" ? event.data.output_index : items.length, item: event.data.item })
    } else if (TERMINAL[event.type] && typeof event.data.response === "object" && event.data.response !== null) {
      terminal.response = event.data.response as Record<string, unknown>
    }
  })
  const reader = body.getReader()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      feed(chunk.value)
    }
  } catch {
    return null
  }
  feed(null)
  const response = terminal.response
  if (response && (!Array.isArray(response.output) || response.output.length === 0) && items.length > 0) {
    return { ...response, output: items.sort((a, b) => a.index - b.index).map(entry => entry.item) }
  }
  return response
}
