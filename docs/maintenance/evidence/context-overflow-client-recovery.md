# Context overflow normalization: client recovery evidence

## Defect

The 400 classification added for #856 is correct, but its normalized wording
(`Prompt exceeds the model's context window...`) removes the canonical
Anthropic signal clients use to recognize overflow. OpenCode's classifier
recognizes `prompt is too long`, but not that rewritten sentence. It therefore
records a generic invalid request rather than starting reactive compaction.

This is independent of why the original request exceeded the effective window.
It matters below the advertised compaction threshold as well as at that
threshold. A reported Opus 5.5 incident at approximately 436K client tokens under
a 1M catalog motivated this investigation; the original upstream token count
and maximum were unavailable. Neither a 500K upstream cap nor a native Opus
1M-to-200K collapse is established by that report.

## Scope

Keep the HTTP status and Anthropic error type, and preserve `Prompt is too long`
in the normalized message. No new response fields, guessed effective window,
raw upstream error disclosure, or silent replacement of SDK resume history.

Fresh replays already use `trimReplayHistory` and `rebudgetReplay`. Resumes
deliberately skip that machinery because the SDK owns their historical prefix;
trimming only the new delta cannot compact it. Client recovery must remain able
to recognize the resulting overflow.

## Reproducible offline regression

```sh
bun test src/__tests__/errors.test.ts src/__tests__/proxy-extra-usage-fallback.test.ts
```

The added tests cover:

- CLI bare overflow, input plus `max_tokens`, and `context_length_exceeded`.
- A large first request followed by an SDK resume whose extended model is
  refused, then whose base retry reports an oversized hidden transcript.
- Both Extra Usage and rate-limit refusals, through JSON and SSE responses.
- Preservation of the last committed SDK session after failed fork attempts.

The fallback window/count in the test is simulated; it is not a claim about a
live Opus model. The SDK is mocked and the HTTP handler is called in-process.

Before the production change: 239 pass, 7 fail. All seven new failures were the
missing canonical phrase. After: 246 pass, 0 fail, 666 assertions.

## Actual client classifier witness

Checked OpenCode source revision
`bc58f4430966121b968fc2b9707610e96ca22852`:

- `packages/ai/src/provider-error.ts`: `isContextOverflow` and
  `classifyProviderFailure`.
- `packages/core/src/session/runner/step.ts`: `isContextOverflowFailure` gates
  `recoverOverflow` before output has started.
- `packages/core/src/session/compaction.ts`: recognized overflow also permits
  bounded shrinking of the compaction request itself.

With dependencies installed in a separate OpenCode checkout, run this offline
witness from the Meridian root. Replace `/path/to/opencode` with that checkout.
It imports the actual client implementation; it never starts either service.

```sh
bun -e '
const client = await import("/path/to/opencode/packages/ai/src/provider-error.ts")
const { classifyError } = await import("./src/proxy/errors.ts")
const before = "Prompt exceeds the model\u0027s context window. Compact or trim the conversation before retrying — an identical retry fails the same way."
const after = classifyError("Prompt is too long").message
const check = (message) => {
  const result = client.classifyProviderFailure({
    status: 400, message,
    rawBody: JSON.stringify({type: "error", error: {type: "invalid_request_error", message}}),
  })
  return {recognized: client.isContextOverflow(message), tag: result._tag, classification: result.classification}
}
console.log(JSON.stringify({before: check(before), after: check(after)}))
if (check(before).recognized || check(after).classification !== "context-overflow") process.exit(1)
'
```

Observed:

```json
{"before":{"recognized":false,"tag":"InvalidRequest"},"after":{"recognized":true,"tag":"InvalidRequest","classification":"context-overflow"}}
```

## Acceptance limits

This demonstrates the proxy error contract and real client classification, not
successful live compaction. No live Claude calls or production service changes
were made. Quota exhaustion, indivisible oversized newest turns, clients without
overflow recovery, and errors after delivered output remain outside this fix.
Affected-flow live E2E with the actual model, client, platform and required
Meridian OpenCode plugin preflight remains a maintainer acceptance gate.
