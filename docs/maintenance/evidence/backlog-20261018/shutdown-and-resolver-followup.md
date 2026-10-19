# Shutdown correction and resolver follow-up

The initial [evidence PR #1412](https://github.com/rynfar/meridian/pull/1412)
merged as signed `da8187ab4553e4fd2120aa0098b2a81b197502dc`. Its combined tree
matches review; all 123 selected live-artifact hashes were rechecked from landed
Git objects. [Merge verification](backlog-evidence-merge.json). No product PR merged.
[Independent follow-up review](shutdown-followup-review.md) passed after fixing
one stale handoff sentence and ensuring ignored log receipts are included.

## #1399 correction

Signed additive commits `4644524c4905f364e995210fbcc2bb3e6952dbd4` and
`1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811` retain the original contributor
branch and all its commits. Remaining deletion attempts now clamp from live
drain state between joined transactions. Active deletion finishes and consumes
the allowance, as do failures; completed pre-drain work does not consume it.
Locks, ownership/generation fences, pins, deadline and single-flight joining stay.

The same archived regression patch produces **5 pass / 2 fail** before and
**7 pass / 0 fail** after. Pausing deletion 1 expects 16 total; pausing deletion
25 expects 40 total, distinguishing a remaining allowance from a lifetime cap.
Focused tests pass 16 cases; adjacency passes 63 with one platform skip.
Typecheck/build and eight final-head CI checks pass.

The full local run remains **6,396 pass / 36 skip / 89 fail**, exit 1, under
Bun **1.3.11**. All seven capacity controls pass later in that failed run.
The supplementary 23 stages pass 464 tests, but **all used Bun 1.3.14**.
The original report's opening runtime must not be applied to those stages;
their success does not make the failed npm invocation green.

- [Correction report](1399-correction/result.md), [code review](1399-correction/review-record.md).
- [Publication review](1399-publication-review.md), [safety review](1399-publication-safety-review.md).
- [Selected-file manifest](1399-correction/publication-manifest.json), [89 failures](1399-correction/full-suite-failures.json).
- [First failure/footer excerpt](1399-correction/full-suite-excerpt.json), [actual stage runtimes](1399-correction/runtime-qualification.json).

Thirty selected files preserve reviewed hashes. The historical source inventory
also names omitted verbose logs; the publication manifest distinguishes the
subset. The full failed log's hash, bytes, line ranges and red footer are retained
in the sanitized excerpt. Runtime credentials/private state are excluded.
Patch context prefixes and original log whitespace are retained to preserve
reviewed hashes; authored prose passes a separate diff whitespace check.

Run a writable scratch copy of the [reproducer](1399-correction/reproduce-offline.sh):
it writes logs beside itself. It needs both recorded commits, Bun 1.3.11 and
frozen dependencies, which may need registry/cache access. “Offline” means no
model/account call. Synthetic SDK deletion checks are not actual-client proof.
The macOS native Claude Code hour-long throughput/admission/503/lock-latency/stop
gate remains open. Follow that native client path; matching Meridian OpenCode
plugin preflight applies to OpenCode→Claude, qualifying broader original wording.

## Author verification

The [credit addendum](forwarded-credit-1399-addendum.md) and
[JSON](forwarded-credit-1399-addendum.json) retain every historical 58 commit
unchanged and add exactly two signed corrections: **60 introduced commits,
14 eamonster27 + 42 passabilities + 4 rynfar Authors**. All signatures were
GitHub-valid; signer and Author remain distinct. Addendum SHA-256:
`9efec62f4c7395b100d55c0e35e878c50d962affaff8e5f1f72b6f891f85801a`.

The snapshot compares all eight complete PR/API sets to `f81d9d8db`, before
#1412's evidence-only merge. Local #1399 ancestry also proves the additive chain;
all-head local objects were unavailable to that reader. Refresh exact heads,
introduced sets, signatures and local ancestry against current main before each
product merge. The historical manifest is unchanged; this is not merge acceptance.

## Shared test failure boundary

The [investigation](auth-cleanup-investigation/RESULT.md) and
[production-path analysis](auth-cleanup-investigation/production-analysis.md)
localize the common cascade: SDK-mocked HTTP tests still invoke real executable
discovery. A lookup missing a settlement witness rejects after its 2-second
timeout plus 3-second join allowance; its failed, unjoined owner blocks later
resolution before SDK admission. That quarantine preserves custody.

Synthetic production-source fixtures reproduce failure timing, persistence and
recovery after the exact late witness, without native/SDK/credential calls.
The two original suites share 88 failing instances. Their initiating missing
witness and separate Pi/watchdog timeouts remain unknown. Host load and isolated
green checks are not causal explanations; no production guard weakening is justified.

The [source/receipt manifest](auth-cleanup-investigation/manifest.json) preserves
these probes. `.test.ts.txt` suffixes prevent accidental discovery; local imports
need intentional scratch-copy adaptation. These are archived investigation records.
Separate isolated tasks are implementing the mocked-SDK test boundary from fresh
main and correcting #1400's Retry-After with focused offline controls. Their
implementation/PR results are pending; no live acceptance is claimed.
