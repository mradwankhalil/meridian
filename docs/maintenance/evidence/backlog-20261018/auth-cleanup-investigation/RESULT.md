# Shared full-suite auth/resolver cleanup investigation

## Conclusion

**The cross-file failure cascade is localized and reproduced without any native process or auth/model call. The initiating missing callback/event in the original full suites remains unobserved.** Do not attribute it to host load, installation, Bun, the GC correction or the UI correction, and do not weaken process/pipe custody or clear its quarantine to get green tests.

The first proxy request starts an unmocked executable resolver even though its SDK is mocked. An owned lookup that fails to collect every settlement witness reaches its 2-second timeout plus 3-second kill/join allowance, rejects with the generic auth-status cleanup error, and retains a process-global unresolved resolver. Every subsequent executable resolution then rejects before even considering a new explicit executable path. This explains the ~5.2-second first failure followed by fast pre-SDK failures across otherwise unrelated tests. A synthetic omitted-pipe fixture against the actual production `models.ts` reproduces this sequence at 5,018ms, and an exact late witness recovers custody without a cache reset.

There is **no established production defect that can safely be fixed by loosening the current guards**. There is an established test-boundary gap: ordinary mocked-SDK integration tests still depend on real executable lookup/version/auth subprocess behavior. A focused maintainer test-isolation/diagnostic change from current main is the appropriate scope; neither #1399's GC correction nor #1411's browser filter should absorb an unrelated resolver rewrite. Original suite gates remain red and actual client acceptance remains separate.

## Exact original order and comparison

Inspected sanitized retained test logs only:

- #1399 final source `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`, `/tmp/meridian-1399-correction-evidence/npm-test.log`, plus exact failures JSON and correction report.
- #1411 source + correction `bd08c43d9139913ad52cd172690aa0b8cec707f7`, `/tmp/meridian-1411-evidence/npm-test.log` and `test-failure-analysis.md`. Discovered filenames before opening the evidence; no private transcripts, credential stores or auth output read.

Both Bun1.3.11 logs begin with exactly the same order: `chatgpt-stream.test.ts` (34 pure cases), `lineage-dropped-content-safety.test.ts` (3), `priority-assignment-key.test.ts` (11), then `proxy-system-reminder-preservation.test.ts`. At line67 in **both** logs, the first HTTP request reports unconfirmed auth-status cleanup; the first assertion at line81 fails because the mock SDK was never called, leaving the prompt undefined. Durations: **5,201.11ms** (#1399), **5,307.81ms** (#1411). The next two tests in the same file fail in tens of milliseconds.

Chronological failure multisets match for **88 instances / 83 unique names** (some parameterized test names repeat). Additional cases differ:

- #1399 has one Pi cross-process `main first, stream=false` SDK-start timeout.
- #1411 has a Pi cross-process `main first, stream=true` timeout and the #1380 watchdog case failing before it obtains its first mock-SDK control.

Those extra cases require their own causal checks; the common cascade does not prove them explained. The trailing Bun failure recap repeats the failure lines; count only entries before `89 tests failed:` / `90 tests failed:` when comparing order.

The original final results remain #1399 **6,396 pass /36 skip /89 fail** and #1411 **6,398 pass /36 skip /90 fail**. Later isolated green checks and healthy CI do not retroactively resolve these original failures.

## Production chain, with concrete source locations

1. First integration file installs only SDK/logger/MCP mocks (`proxy-system-reminder-preservation.test.ts:19–48`) and imports the real server. The preload at `src/__tests__/preload.ts:96–97` disables only the SDK process gate. It does not replace executable resolution or auth-status subprocesses.
2. Server uses the real auth owner and executable probe owner (`server.ts:728`, `:4460`, `:5841`), before the mocked SDK can receive a query. The direct async resolver defaults to system/PATH lookup.
3. Owned PATH lookup uses `startOwnedClaudeProcess({shell: command}, timeoutMs=2000)` (`models.ts:1447–1454`). Version checks have a different 45-second aggregate budget, and auth-status has a 90-second spawn timeout. Therefore a five-second first failure strongly localizes to the lookup timeout path; it is a timing/source inference, not a missing command trace.
4. `authStatusProcess.ts:65–78` requires callback, exit (or spawn-failure), child close, stdout close and stderr close before resolving either result or joined ownership. At timeout, `:88–107` schedules owned TERM/KILL and rejects result/cancel with `reason:'join'` after 1,000+2,000ms, while leaving the live `joined` promise pending. It never signals a child whose exit/close has already been observed (`:80–85`).
5. `tryPathLookup` catches the failed result as a miss, but the subsequent scope check (`models.ts:1384` / resolver scope `claudeResolverOwnership.ts:18–20`) sees its existing unjoined child and throws cleanup-unconfirmed rather than admitting a fallback.
6. `createClaudeResolution` sets `failed=true` when result rejects and joins only after all owned leaf `joined` promises (`claudeResolverOwnership.ts:29–39`). `hasUnconfirmedFailure` remains true while failed and unjoined.
7. `models.ts:1477–1480` checks *all* active resolutions for that state before consulting cached path, environment override or saved preference. That preserves custody across new callers/preferences, but also propagates one unresolved lookup across all later test files in the same process. Removal happens only from the real joined continuation at `:1512–1515`.
8. The generic failure string is shared by lookup, version and auth leaves. The initial message saying “auth-status” does **not** prove that `claude auth status` itself was invoked or that credentials were at fault.

Current auth-status/resolver ownership production code is unchanged by the #1399 correction; differences in its `models.ts` relative to current main are unrelated comment edits. #1411 only changes browser provider filtering/tests. No earlier *executed* case in either chronological log uses the child-process boundary. The main-stage `node:child_process` mocks found in profile-expiry/login-deadline files are guarded worker-only branches, and the actual child-process/auth mock suite (`models-auth-status.test.ts`) is excluded from the main invocation and run separately. There is no evidence here that a later test's fake child initiated the first failure.

## Newly executed discriminating, credential-free controls

### Actual global resolver and exact late recovery

Command inspected before execution:

```sh
/tmp/meridian-1399-tooling/node_modules/.bin/bun test /tmp/meridian-auth-cleanup-probe/global-quarantine.test.ts
```

Bun1.3.11, **1 pass /0 fail /9 assertions**, fixture duration5.19s. The fixture imports the actual source `models.ts`; `child_process` exec/execFile are synthetic EventEmitter children, all other native start methods are traps, settings/tokenRefresh/logger are injected fixtures. No child is spawned, no SDK is imported/called, no auth-status command occurs, and no credential store is read.

- Positive control: synthetic PATH lookup and version process emit callback+exit+both pipe closes+child close; resolution succeeds as `/bin/sh` (a path fixture only; never executed).
- Failure control: next synthetic lookup emits successful callback, exit, stdout close and child close but omits stderr close. Result rejects with the original error after **5,018ms**.
- Persistent-state assertion: a later resolve with `MERIDIAN_CLAUDE_PATH=/bin/sh` rejects identically and creates no new fake child.
- Safety assertion: observed exited fake children receive **zero signals**.
- Recovery control: deliver only the omitted stderr close, let the owned join continuation settle, then the environment path resolves successfully with no new child and **without resetting the poisoned cache**.

Exact source and receipts:

- `/tmp/meridian-auth-cleanup-probe/global-quarantine.test.ts`
- `/tmp/meridian-auth-cleanup-probe/global-quarantine.stdout.txt`
- `/tmp/meridian-auth-cleanup-probe/global-quarantine.stderr.txt`

This reproduces a sufficient mechanism and its exact error/timing signature. It does not prove stderr-close was the missing original witness.

### Individual witness matrix

Independent leaf fixture: `/tmp/meridian-auth-cleanup-leaf-fixture.test.ts`, source head1399 exact final. The safe `.test.ts` transport asserts child-process mock identity before importing/calling production leaves. It ran **1 pass /0 fail** on Bun1.3.14 and pinned1.3.11 (latter520ms), with seven unspawned synthetic children, zero network/SDK/credential activity.

A complete delayed control joins only after its final exact witness. Independently omitting callback, exit, stdout close, stderr close or child close produces bounded join rejection and keeps joined pending; supplying that precise late witness joins ownership without converting the already-rejected result into success. The resolution wrapper changes `hasUnconfirmedFailure:true→false` only after that join. Receipts: `/tmp/meridian-auth-cleanup-leaf-fixture.stdout.log`, `.stderr.log`; full analysis `/tmp/meridian-auth-cleanup-production-analysis.md`.

One initial `/tmp` script-mode setup did not install Bun's child-process mock as intended; it failed before any fake fixture existed. Only an inert fake lookup placeholder was attempted, no Claude/auth command. It was corrected by moving to `.test.ts` and asserting mock identity *before* leaf invocation. Preserve this as a harness-transport failure, not product evidence.

## What remains unknown and the next useful fix/proof

The original logs preserve none of: command class, callbackDone, exitSeen, child-close, stdout-close, stderr-close, timer trigger, exit code/signal or eventual late witness. They cannot distinguish a real surviving actor, child/pipe event transport omission, missing callback after OS settlement, event delay, spawn failure shape or interference. Harmless native controls and placeholder fallback passing independently falsify simple necessary-cause claims, but do not reveal the first failed actor. Host load77 is context only.

Recommended focused work from fresh main:

1. **Fix the mocked integration boundary, not custody:** ensure tests that claim only mocked SDK/HTTP behavior also use a deterministic synthetic executable/auth boundary, preferably the existing stable per-file dispatcher pattern rather than new process-global last-wins mocks. Add a strict child/native/network trap in a minimal first-proxy gate. Dedicated resolver/auth ownership tests retain the real implementation and synthetic witness matrix; independent harmless process tests retain actual pipe/event coverage. Do not add arbitrary retries, broaden timeouts, clear active resolution state between individual requests, or disable ownership checks.
2. **Add bounded sanitized initiating diagnostics** to the owned process failure: command class (`lookup`/`version`/`auth`), reason/elapsed/deadline and five witness booleans; never arguments/output, credentials or customer content. Preserve the actual late-join transition. A deterministic fixture should assert each missing-witness diagnostic independently. This is internal diagnostic work and does not require public API changes.
3. **Reproduce the missing initiating event with a no-auth fixture** only after those observations exist. Use an owned harmless short shell/executable plus bounded synthetic scheduling/fault controls and exact original file order if needed; do not run actual Claude/access diagnostics for this test problem. The existing full-suite failure cannot be claimed fixed solely by an isolated green run or timeout increase.
4. **Keep callback result separate from OS custody under consideration:** current `joined` also requires the output callback. The omitted-callback control demonstrates possible logical quarantine even after exit+child close+both pipe close are all observed. That is a concrete design surface, not evidence the callback was omitted in the original run. Any change must preserve all process/pipe ownership witnesses, settle output truthfully and pass the complete delayed/missing-witness controls; do not apply it speculatively as the current failure's fix.

No full suite, actual Claude subprocess, model/access/auth diagnostic or process cleanup was run in this investigation. No checkout files were modified. Temporary probes and this report need durable escrow in the parent's evidence/handoff PR before relying on them beyond this session. The parent remains responsible for the original red gates and subsequent exact-head validation.
