/** Keep shutdown accounting alive until the client consumes or cancels the body. */
export function completeUpstreamResponse(
  response: Response,
  signal: AbortSignal,
  complete: () => void,
): Response {
  if (!response.body) {
    complete()
    return response
  }
  const reader = response.body.getReader()
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    signal.removeEventListener("abort", abort)
    complete()
  }
  const abort = () => {
    void reader.cancel(signal.reason).finally(finish).catch(() => {
      // Cancellation can race a transport failure; completion still runs.
      finish()
    })
  }
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()
        if (chunk.done) {
          finish()
          controller.close()
        } else {
          controller.enqueue(chunk.value)
        }
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        finish()
      }
    },
  }, { highWaterMark: 0 })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
