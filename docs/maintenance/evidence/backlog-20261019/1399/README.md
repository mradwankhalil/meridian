# Native cleanup-load gate preparation

Source head `7379cd4652af910897480bae3469f6c6e65c3025` incorporates current main
`6c241a897bdc7ffe4c233d32270a17402b3528a0` without conflict. Capacity/limit
regressions pass 16 tests; typecheck/build and final-head CI pass. The previous
89-failure local gate remains retained. The [fresh complete pinned gate](final-gate-summary.json) passes 7,000 tests / 36 skips / 0 failures over all 24 invocations.

The [actual native-client preflight](native-client-preflight.json) passes three
client requests: real Read, result, resumed receipt. Both native CLI children
join. CLI 2.1.302 is pinned to SHA-256
`5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37`.
This preflight uses a loopback provider fixture, not a real model. It qualifies
this newer actual client; it does not claim the original 2.1.284–2.1.294 runs.

The [live driver](run-native-load.mjs) and [observer](native-load-observer.mjs)
are escrowed before inference. They run two or four actual native clients through the
real proxy, SDK 0.2.141, pinned native child and an explicitly selected model.
A full-hour gate requires four clients and the full 19,800-session fixture seed;
the two-client mode is pilot-only at the configured 25-second cadence.
[Offline invalid-hour controls](hour-plan-offline.json) reject an insufficient
client count and an empty seed before output/config/SDK construction. The
large-store seed path remains unqualified because the third pilot stopped
before seeding. A small-store hour must not be counted as that acceptance.
The load qualification selects **Opus 5.5, 200k**, via the supported `opus`
alias. This is a new qualified GC route, not proof of the unspecified original
reporter model/context or a change to the earlier failed E41 qualification. Only Read is enabled;
the local relay validates every tool/path against owned fixtures before the
native client executes it. Responses are buffered for this guard, so observed
request timings are not streaming first-byte latency. Existing `x-request-id`
tracing correlates exact SDK admission and lifecycle queue measurements; no
agent/session header is manufactured.

A new private access-only grant and both explicit live opt-ins are required.
The read-only official quota guard requires disabled Extra Usage and reserves
at least 25% of the five-hour / 10% of the weekly allowance, rechecking every
minute. No refresh or account setting write occurs. Bounds are one minute for
a pilot or one hour for load, plus two minutes to settle; at most 4,000 actual
provider generations, up to four clients and five CLI turns per print invocation.
Any provider error, unexpected model, missing quota witness or owned-path guard
stops further inference. All native/provider model metadata is observed without
reading private SDK files. Exact real source head and clean checkout are checked.

Large-store pressure uses up to 19,800 forks of an owned synthetic session via
the supported SDK `forkSession` API, verifying the source remains unchanged.
Only the newly owned Meridian lifecycle fixture index is initialized in bulk,
under its actual local lifecycle queue. Private SDK files are never opened by
the harness. Periodic GC is disabled during this fixture so it can be seeded;
actual publication-triggered GC and default backlog/deletion/grace values stay
in effect. This measures the back-to-back sweep path under load, not idle
periodic scheduling. Each worker cycle is paced to at least 25 seconds to keep the total generation
budget bounded. A full-hour pass requires at least 28 actual SDK queries
per minute, no capacity refusal, correct receipts and joined processes. Close
records active deletion state, elapsed time and at most 16 newly deleted rows.

Run only after the source's local/CI gates and native preflight pass. Start with
a new one-minute/no-seed pilot (`60 0 100` arguments), then review its real model,
routing, request and custody facts before any large run. Baseline/main and
candidate each need new owned output/config/session directories; preserve a
capacity refusal as the baseline result rather than silently rerunning it.
The original hour-long affected-flow acceptance remains open until an actual
complete run establishes it. The bounded pilot results below do not establish the full-hour acceptance gate.

## First live pilot — stopped before inference

[The first pilot](pilot1-before-inference.json) returned HTTP 400 before any SDK
query or provider generation. The [exact native request construction](native-client-preflight-controls.json)
requests adaptive thinking with `display: omitted`. Main's unchanged
`haikuThinkingCompatibilityError` deterministically rejects that control on
Haiku 5.5. The original HTTP error body was not retained; the construction
fixture plus exact pure guard establish the unsupported control. The driver now
retains bounded early error details. All client/quota processes joined, and
owned config was removed. No guard or real client payload is weakened.

A separate credentialless Opus construction check and bounded Opus pilot are
required before the large run. This does not claim a Haiku fix. Other E41 modes
remain held by the unexplained historical Opus 4.8 annotation mismatch.

## Opus pilot — passed

[The bounded actual Opus pilot](pilot2-opus.json) passed 63 real SDK/provider
requests, 21 read/result/follow-up cycles (one warm-up), 59.7 SDK queries/minute,
all receipts and resumed answers. All 63 native SDK children, 42 actual client
children and two quota-check children joined. Current provider/native/stored
model metadata identifies Opus 5.5; this fresh success does not explain the
old E41 Opus 4.8 tags. The [Opus construction preflight](native-client-opus-preflight.json)
passed first. The full-hour gate remains open.

The next pilot additionally tests eight supported public SDK forks and three
dependent file reads. Only the first path is in the prompt; each file reveals
the next path, and the last holds the random receipt. Five real requests per
cycle are required, then an ordinary saved-session follow-up. Real adapter
telemetry must say `claude-code`. The observer now joins all root spawn/execFile
children, including cleanup workers, and records the provider context beta.
No larger run starts until this additional pilot is reviewed.


## Dependency-chain pilot — refused, then stopped

[The third pilot](pilot3-refusal-summary.json) failed during warm-up before any
public forks, large-store seed or hourly run. Provider generations one through
three were all Opus 5.5. The second and third stopped with `refusal`; the native
CLI then attempted Opus 4.8 despite the requested model and null SDK fallback.
The model guard rejected that fourth request **before network**. No Opus 4.8
provider response was received. The old report's `generations: 4` counts that
blocked attempt; it is not four actual upstream generations. See the original
[append-only metadata](pilot3-model-metadata.jsonl), [report](pilot3-report.json)
and [request receipt](pilot3-requests.jsonl). All five owned processes joined;
owned access-only grants and client/profile configuration were removed.

A tool block also failed the front relay's owned-path guard. Its input was not
retained, so this artifact cannot establish why; no outside path executed. That
assertion previously returned HTTP 500, which could trigger a client retry.
The harness now latches this failure, emits a bounded sanitized diagnostic and
returns nonretryable HTTP 400. It canonicalizes existing whitelisted fixtures
without admitting arbitrary project files or symlink escapes. On provider
`refusal` it stops all further inference, suppresses returned tool blocks and
terminates only its owned clients. Attempted, admitted and blocked generation
counts are separate. [Offline regression controls](load-guards.test.mjs) and
[receipt](load-guards-offline.json) pass; these are harness corrections, not a
production behavior fix or a rerun of the refused request.

The [actual pinned native offline control](native-refusal-control.mjs) uses an
owned SSE fixture, not a real model. [Its result](native-refusal-offline.json)
shows two Opus 5.5 fixture requests by default and with
`CLAUDE_CODE_NO_MODEL_FALLBACK=1` alone, versus one with that flag plus
`CLAUDE_CODE_DISABLE_REFUSAL_RETRY=1`. Every variant retains `is_error: true`
and joins its child. No variant attempted a different model in this API-key
fixture, so it cannot prove prevention of the real OAuth fallback pivot.
Production defaults were not changed based on undocumented controls. Any
future live qualification must stop on refusal and explicitly establish its
model/fallback policy first; do not retry or switch models to get past one.

The newly witnessed fallback mechanism may be relevant to old mixed-model
histories, but the missing old provider boundary prevents a causal attribution.
#1399 remains held. No further paid-model calls were made after this refusal.
