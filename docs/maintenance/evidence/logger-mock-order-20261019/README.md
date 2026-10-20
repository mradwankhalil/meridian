# Remaining logger registration collision

The documentation-only PR #1424 failed its required `test` gate on
[`787619532`](https://github.com/rynfar/meridian/actions/runs/39287527796).
The failure-observer fixture received logger/diagnostic/telemetry fault counts
**[0, 1, 1]**, where its unchanged assertion requires **[1, 1, 1]**. It failed
in 43 ms. [Original CI excerpt](ci-failure.txt).

`telemetry-settings-routes.test.ts` still registered its own process-global
`mock.module("../logger", ...)`. Loading it after the shared logger dispatcher
replaced that dispatcher with a silent stub, so the recovery test never reached
its logger failure injection. The fix installs the telemetry implementation
through `installLoggerMock` and its existing per-suite `beforeAll` mechanism.
There is now one logger module registration, in `loggerMock.ts`.

The [committed import-order fixture](../../../../scripts/fixtures/logger-mock-load-order.test.mjs)
loads the real test suites in that order. It registers SDK/MCP dispatchers first
to keep the test offline, and uses the original assertions for telemetry settings,
logger/diagnostic/telemetry throws, stream error/terminal closure and mapping
ownership. No production code, assertion, timeout or performance bound changes.
The existing passthrough suite is byte-identical to the baseline; its hash is in
[the proof receipt](proof.json).

Run the exact gate from the repository root with pinned Bun 1.3.11:

```sh
bun test --timeout 30000 \
  --test-name-pattern 'naturally closes failed recovery|telemetry settings routes' \
  ./scripts/fixtures/logger-mock-load-order.test.mjs
```

`npm test` includes this as its **25th** isolated invocation after the existing
24 gates. Its ordinary pretest still typechecks the application and test suites.
No live model call is required for this test-only fix.

| Controlled run | Before | After |
|---|---|---|
| Darwin arm64, Bun 1.3.11 | 12 pass / 1 fail | 13 pass / 0 fail |
| Debian Linux arm64, Bun 1.3.11 | 12 pass / 1 fail | 13 pass / 0 fail |
| Restore the old direct registration after the fix | 12 pass / 1 fail | Candidate restored afterward |

The controlled failures reproduce the exact CI **[0, 1, 1]** counters. An ordinary
two-file invocation passed locally even when command arguments were reversed;
it did not change the observed module order, so it is retained only as a
[control](ordinary-pair-control.log). The explicit sequential-import fixture
provides the discriminating before/after evidence.

Logs: [Darwin before](darwin-baseline.log), [Darwin after](darwin-candidate.log),
[Linux before](linux-baseline.log), [Linux after](linux-candidate.log),
[old-registration mutation](mutation-baseline.log).

Related issues #933 and #917 remain open. This establishes one reproduced logger
mock mechanism; it does not establish that every historical CI failure has the
same cause. Final local totals and final-head CI belong in the PR body before
merge. Documentation PR #1424 still needs a fresh passing head containing this
fix; its failed run is preserved rather than replaced by an unexplained retry.


## Drain fixture cleanup

The first full local gate with the logger correction exposed an independent
fixture-lifetime race: the raw-abort test's complete store snapshot acquired a
`session-gc.json.lock.candidate-*` file while its SDK-call and session-store-read
assertions remained zero. That run stopped after **6505 pass / 36 skip / 1 fail**;
[the failure excerpt is retained](drain-full-gate-failure.txt).

The fixture previously released streams, slept 25 ms, and removed its root.
An opportunistic GC sweep can still be awaiting filesystem I/O at that point;
`closeBackend` alone does not join it. The next test changes the shared store-root
override, allowing old fixture work to touch the later root. Teardown now owns
every proxy created by this suite, begins drain, releases its streams, waits for
accepted requests, and joins each actual GC sweep and backend before removing
the root and resetting the override.

The new regression test pauses the real `node:fs/promises.link` publication after
the actual GC candidate has been written and fsynced. Cleanup must reach and join
that pending sweep before the gate is released. Restoring the former 25 ms sleep
makes the regression fail with **expected "joined", received "returned"**;
the real candidate is always released and joined even on this negative control.
No synthetic candidate is injected, and no candidate is filtered from snapshots.
The original raw-abort and store-snapshot assertions remain unchanged.

Run `bun test --timeout 30000 src/__tests__/drain.test.ts` with pinned Bun 1.3.11.
The complete corrected drain file passes **31 / 31** on both Darwin arm64 and Debian Linux arm64. The
[old-sleep mutation](drain-old-sleep.log), [Darwin corrected file](drain-darwin-candidate.log), [Linux corrected file](drain-linux-candidate.log)
and source commit in [the receipt](proof.json) preserve the discriminating proof.
