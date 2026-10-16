/**
 * Task 7 - deciding whether a ChatGPT response failed, and whether anyone
 * else should be asked instead.
 *
 * The question looks like the one Meridian already answers for Anthropic and
 * is not. `sniffAccountFailure` reads ONE complete frame and lets it decide
 * (`server.ts:1050`, `break // first complete frame decides`), because an
 * Anthropic error stream leads with `event: error`. Every Responses stream
 * leads with `response.created`, so that rule reads the preamble of a doomed
 * stream and reports success.
 *
 * Scanning further introduces the opposite hazard, which is the one that
 * costs real money: once the client has seen output, retrying on another
 * account re-does work it already has. So the scan stops at the FIRST frame
 * that carries anything the client would see, and a failure after that point
 * is the client's to receive rather than ours to paper over.
 *
 * No test here contains a token, and no failure record carries the upstream's
 * own message. The provider's words reach the CLIENT untouched through the
 * passthrough; what Meridian keeps for its logs is a classification.
 */
import { describe, expect, it } from "bun:test"
import { isModelRefusal, sniffChatGptFailure, type ChatGptFailure } from "../proxy/chatgpt/stream"

const encoder = new TextEncoder()

const frame = (event: string, data: Record<string, unknown> = {}) =>
  `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`

function sseResponse(chunks: readonly string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } })
}

/**
 * A stream that delivers its chunks and only then fails.
 *
 * Delivered from `pull` rather than enqueued upfront: `controller.error()`
 * resets the queue, so enqueuing everything and then erroring would discard
 * the content and reject on the very first read - the opposite of the
 * mid-content drop this models.
 */
function droppedResponse(chunks: readonly string[]): Response {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!))
        index++
        return
      }
      controller.error(new Error("connection reset by peer"))
    },
  })
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<{ text: string; error: unknown }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
    return { text, error: null }
  } catch (error) {
    return { text, error }
  }
}

const CREATED = frame("response.created")
const IN_PROGRESS = frame("response.in_progress")
const TEXT_DELTA = frame("response.output_text.delta", { delta: "hello" })
const ITEM_ADDED = frame("response.output_item.added")
const TOOL_ARGS = frame("response.function_call_arguments.delta", { delta: "{\"path\":" })
const FAILED = frame("response.failed", { response: { status: "failed" } })
const COMPLETED = frame("response.completed")

describe("sniffChatGptFailure - a failure hiding behind the preamble", () => {
  it("sees response.failed even though response.created came first", async () => {
    const { failure } = await sniffChatGptFailure(sseResponse([CREATED, FAILED]))

    expect(failure).toEqual({ kind: "stream_failed", status: 200 } satisfies ChatGptFailure)
  })

  it("scans past several preamble frames to reach the failure", async () => {
    const { failure } = await sniffChatGptFailure(
      sseResponse([CREATED, IN_PROGRESS, IN_PROGRESS, FAILED]),
    )

    expect(failure?.kind).toBe("stream_failed")
  })

  it("finds it when the whole stream arrives as one chunk", async () => {
    // Frame boundaries do not align with chunk boundaries on a real socket.
    // An implementation that inspects only the first frame per chunk passes
    // the test above and fails this one.
    const { failure } = await sniffChatGptFailure(sseResponse([CREATED + IN_PROGRESS + FAILED]))

    expect(failure?.kind).toBe("stream_failed")
  })

  it("finds it when one frame is split across chunks", async () => {
    const split = CREATED + FAILED
    const cut = Math.floor(split.length / 2)
    const { failure } = await sniffChatGptFailure(
      sseResponse([split.slice(0, cut), split.slice(cut)]),
    )

    expect(failure?.kind).toBe("stream_failed")
  })

  it("treats a bare error event before output as a failure too", async () => {
    const { failure } = await sniffChatGptFailure(sseResponse([CREATED, frame("error")]))

    expect(failure?.kind).toBe("stream_failed")
  })

  it("hands back the bytes it consumed, so a last-account caller still has a body", async () => {
    const { failure, body } = await sniffChatGptFailure(sseResponse([CREATED, FAILED]))

    expect(failure).not.toBeNull()
    const { text } = await drain(body)
    expect(text).toContain("response.failed")
  })
})

describe("sniffChatGptFailure - once the client has seen output, it is theirs", () => {
  it("does NOT report a failure that arrives after a text delta", async () => {
    const { failure } = await sniffChatGptFailure(sseResponse([CREATED, TEXT_DELTA, FAILED]))

    expect(failure).toBeNull()
  })

  it("does NOT report a failure that arrives after a tool call", async () => {
    const { failure } = await sniffChatGptFailure(sseResponse([CREATED, TOOL_ARGS, FAILED]))

    expect(failure).toBeNull()
  })

  it("does NOT report a failure that arrives after an output item opens", async () => {
    const { failure } = await sniffChatGptFailure(sseResponse([CREATED, ITEM_ADDED, FAILED]))

    expect(failure).toBeNull()
  })

  it("passes the whole stream through unchanged when output came first", async () => {
    const original = CREATED + TEXT_DELTA + FAILED
    const { body } = await sniffChatGptFailure(sseResponse([CREATED, TEXT_DELTA, FAILED]))

    const { text, error } = await drain(body)
    expect(text).toBe(original)
    expect(error).toBeNull()
  })

  it("treats an unrecognized frame as output rather than as more preamble", async () => {
    // The safe default in the direction that cannot duplicate work. A new
    // event name this build has never heard of might be output, so the scan
    // stops; guessing "preamble" instead would keep scanning and could retry
    // a turn whose content the client already holds.
    const { failure } = await sniffChatGptFailure(
      sseResponse([CREATED, frame("response.some.future.event"), FAILED]),
    )

    expect(failure).toBeNull()
  })
})

describe("sniffChatGptFailure - a stream that simply stops", () => {
  it("lets a mid-content drop reach the client instead of converting it to a retry", async () => {
    const { failure, body } = await sniffChatGptFailure(droppedResponse([CREATED, TEXT_DELTA]))

    expect(failure).toBeNull()
    const { text, error } = await drain(body)
    expect(text).toBe(CREATED + TEXT_DELTA)
    expect(error).toBeInstanceOf(Error)
  })

  it("reports no failure for a stream that ends after the preamble without saying anything", async () => {
    const { failure } = await sniffChatGptFailure(sseResponse([CREATED]))

    expect(failure).toBeNull()
  })

  it("passes a healthy completed stream through byte for byte", async () => {
    const original = CREATED + TEXT_DELTA + COMPLETED
    const { failure, body } = await sniffChatGptFailure(
      sseResponse([CREATED, TEXT_DELTA, COMPLETED]),
    )

    expect(failure).toBeNull()
    expect((await drain(body)).text).toBe(original)
  })

  it("stops buffering a preamble that never ends", async () => {
    // An unbounded scan is a remote party's decision to make Meridian hold
    // memory. The budget resolves to "no failure seen", which passes the
    // stream through - the same answer as any other inconclusive scan.
    const endless = Array.from({ length: 5_000 }, () => IN_PROGRESS)
    const { failure } = await sniffChatGptFailure(sseResponse(endless))

    expect(failure).toBeNull()
  })
})

describe("sniffChatGptFailure - what the HTTP status alone decides", () => {
  const statusCases: ReadonlyArray<readonly [number, ChatGptFailure["kind"] | null]> = [
    [401, "requires_reauth"],
    [403, "requires_reauth"],
    [429, "rate_limited"],
    [500, "transient"],
    [502, "transient"],
    [503, "transient"],
    [529, "transient"],
    [400, null],
    [404, null],
    [422, null],
    [200, null],
  ]

  for (const [status, kind] of statusCases) {
    it(`maps ${status} to ${kind ?? "no failure"}`, async () => {
      const res = new Response(JSON.stringify({ error: { message: "..." } }), {
        status,
        headers: { "content-type": "application/json" },
      })

      const { failure } = await sniffChatGptFailure(res)
      expect(failure?.kind ?? null).toBe(kind)
      if (failure) expect(failure.status).toBe(status)
    })
  }

  it("keeps the four outcomes distinct rather than collapsing them to a boolean", async () => {
    const kinds = await Promise.all([401, 429, 500].map(async status => {
      const { failure } = await sniffChatGptFailure(new Response("{}", { status }))
      return failure?.kind
    }))
    const { failure: streamFailure } = await sniffChatGptFailure(sseResponse([CREATED, FAILED]))

    expect(new Set([...kinds, streamFailure?.kind]).size).toBe(4)
  })

  it("classifies a failing status without reading the body, so it still reaches the client", async () => {
    const res = new Response("upstream said something", { status: 429 })

    const { failure, body } = await sniffChatGptFailure(res)
    expect(failure?.kind).toBe("rate_limited")
    expect((await drain(body)).text).toBe("upstream said something")
  })

  it("does not treat a JSON 200 as a stream to be sniffed", async () => {
    const res = new Response(JSON.stringify({ id: "resp_1", status: "completed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })

    const { failure, body } = await sniffChatGptFailure(res)
    expect(failure).toBeNull()
    expect(JSON.parse((await drain(body)).text)).toEqual({ id: "resp_1", status: "completed" })
  })

  it("survives a response with no body at all", async () => {
    const { failure, body } = await sniffChatGptFailure(new Response(null, { status: 401 }))

    expect(failure?.kind).toBe("requires_reauth")
    expect((await drain(body)).text).toBe("")
  })
})

describe("sniffChatGptFailure - what a failure record is allowed to carry", () => {
  it("records a classification and a status, never the upstream's own words", async () => {
    const leaky = frame("response.failed", {
      response: {
        status: "failed",
        error: { code: "server_error", message: "trace-id 7f3a and other upstream detail" },
      },
    })

    const { failure } = await sniffChatGptFailure(sseResponse([CREATED, leaky]))

    expect(failure).toEqual({ kind: "stream_failed", status: 200 })
    expect(JSON.stringify(failure)).not.toContain("trace-id")
    expect(JSON.stringify(failure)).not.toContain("upstream detail")
  })

  it("still delivers those words to the client, which is who they are for", async () => {
    const leaky = frame("response.failed", {
      response: { status: "failed", error: { message: "you are out of credits" } },
    })

    const { body } = await sniffChatGptFailure(sseResponse([CREATED, leaky]))

    expect((await drain(body)).text).toContain("you are out of credits")
  })
})

describe("sniffChatGptFailure & isModelRefusal - client request errors vs seat/model refusals", () => {
  it("does not treat a client request error in response.failed as a seat failure", async () => {
    const badRequest = frame("response.failed", {
      response: {
        status: "failed",
        error: { code: "invalid_request_error", message: "Invalid value for input" },
      },
    })
    const { failure, body } = await sniffChatGptFailure(sseResponse([CREATED, badRequest]))
    expect(failure).toBeNull()
    expect((await drain(body)).text).toContain("invalid_request_error")
  })

  it("distinguishes model refusals from parameter validation errors that mention the model", () => {
    expect(isModelRefusal(400, "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.")).toBe(true)
    expect(isModelRefusal(404, "The model 'gpt-unknown' does not exist.")).toBe(true)
    expect(isModelRefusal(400, "Unsupported parameter: 'temperature' is not supported with this model.")).toBe(false)
    expect(isModelRefusal(400, "Invalid value for 'reasoning_effort': not supported with this model.")).toBe(false)
  })
})
