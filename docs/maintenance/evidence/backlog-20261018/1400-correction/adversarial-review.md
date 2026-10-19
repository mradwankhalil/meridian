# PR #1400 offline correction: independent adversarial review

Reviewed on 2026-10-19. Contributor source HEAD: `9451a72aa48127ddd6106bedb48ecdb98e03f04d`; current `origin/main`: `da8187ab4553e4fd2120aa0098b2a81b197502dc`. The implementation correction was uncommitted during this review. This report is evidence for the parent's separate evidence PR, not contributor-branch source.

## Finding and resolution

**P2, resolved in the working diff: an expired eligible bench could advertise another account's hours-long wait.** The first proposed correction recomputed the pool minimum from live marks but skipped `benchedUntil() === null`. An earlier account can reopen while later accounts are still being tried. With work reopening at T+60 seconds, personal at T+3 hours, and spare at T+4 hours, terminal delivery after T+120 seconds incorrectly advertised personal's remaining wait even though work had no effective exclusion. Removing the old attempted minimum made this case newly visible: the old expired timestamp would instead have selected the existing retry fallback.

The final helper returns `null` immediately when any relevant pool member has no effective bench. Both terminal callers already translate this to the established 60-second quota fallback. This removes no real exclusion and preserves the effective minimum when every relevant account remains benched. The new HTTP JSON/SSE regression advances the mocked clock during personal's refinement, asserts a 60-second wait, and confirms health retains only personal/spare model marks. `red-expired.log` independently records both assertions failing before the guard: 10681 and 10680 seconds instead of 60. I inspected the guard, regression source, and completed final active-file log containing both passing expiry cases.

No other material finding survived this pass on the correction.

## Scope inspected

- Read repository AGENTS, contribution workflow, upstream-review/evidence skills, architecture, API contract, and affected E2E guidance.
- Inspected the complete PR production delta against current main: `errors.ts`, `limitDetection.ts`, `retryAfter.ts`, `routing.ts`, and `server.ts`, plus the original live harness and behavior documentation. The correction itself changes only `server.ts` and the two HTTP integration test files. Current-main policy/evidence additions appear as stale-base two-dot deletions; they are not introduced contributor PR files in the merge-base comparison.
- Followed both dispatch loops and their terminal JSON/SSE responses, candidate selection, effective pool construction, durable retained-route restrictions, explicit-profile bypass, ordinary non-pool routing, exposure/cancellation barriers, and asynchronous refinement.
- Verified `benchedUntil()` requires the later live account/model mark, and pool comparison takes the earliest of those effective exclusions. The caller supplies every configured eligible account, including skipped benches, while retained-only work supplies exactly the retained candidate. Model-local marks do not become account marks; account exclusions continue to apply to every model. Mark monotonicity and routing priority/affinity are unchanged.
- Checked that removal of the attempted-reset accumulator also avoids stale minima when a completed OAuth refinement extends an earlier account during later attempts. The request still does not wait for outstanding refinements; this is a snapshot at terminal computation.
- Checked status/error behavior: terminal JSON header/body parity, terminal SSE body wait for quota refusals, existing 24-hour retry clamp/defaults, billing status preservation, and unchanged no-retry barriers after exposure.
- Checked test discrimination: repeated shorter marks with the retried account first back and with a skipped account first back; opposite account/model overlap directions (effective minima differ from account-only, model-only, and raw-mark minima); deferred refinement; ordinary first default; expired bench; retained-only JSON/SSE retries; unrelated model remaining on work. These tests establish marks through mocked HTTP requests, not tracker injection.
- Checked global mocked-clock restoration and per-test event/store cleanup. The retained regression continues to verify that only personal is attempted and that its longer real mark remains on health/list.

## Evidence reviewed, not re-executed by reviewer

- `red-source-probe.log`: Bun 1.3.11; advertised 600000 ms versus effective earliest 10800000 ms. `green-source-probe.log`: both 10800000 ms.
- `red-active.log`: 2 passing ordinary controls, 6 failing stale-shorter/overlap cases; `red-refinement.log`: 2 failing refinement cases; `red-retained.log`: 2 failing retained cases. Failures reached the intended numeric assertions.
- `green-active.log`: 10 passed / 0 failed before the expiry guard was added. `green-retained.log`: 2 passed / 0 failed. Each log shows the actual Bun 1.3.11 runtime line and `SDK_BOUNDARY_TRAP` with empty attempts and zero native children/network calls.
- Inspected `offline-fixture.ts`: auth and executable resolution are fixed fixtures, platform stores return no credentials, native/network boundaries reject attempts, and model mapping/configuration remain real. This fixture is external evidence, not a committed infrastructure fix.
- The first `baseline-control.log` was run before that fixture and invoked native auth-status for synthetic profile directories. This is an explicit execution limitation, not erased by later clean runs. Subsequent guarded offline evidence does not establish real client/account access.
- Reviewer performed source/diff/log reads and `git diff --check` only. No tests, model requests, credential reads, client/access diagnostics, network diagnostics, pushes, comments, merges, or releases were performed by this reviewer.

## Final verification inspection

After the expiry guard landed in the working diff, I inspected these completed logs without rerunning them:

- `green-active-file.log`: 54 passed / 0 failed, 380 assertions, including the JSON and SSE expiry regressions; actual Bun 1.3.11 runtime line and empty native/network trap attempts.
- `green-retained.log`: 2 passed / 0 failed, 27 assertions; actual Bun 1.3.11 runtime line and empty native/network trap attempts.
- `green-units.log`: 362 passed / 0 failed across four files, 917 assertions; actual Bun 1.3.11 runtime line and empty native/network trap attempts.
- `typecheck-final.log`: `npm run typecheck` / `tsc --noEmit`, no errors; parent reports exit 0.
- `build-final.log`: `npm run build` / `bun scripts/build.ts`, successful bundles and certified local build 2; parent reports exit 0.
- `git diff --check`: clean. Working correction scope remains exactly the two integration files and `src/proxy/server.ts` (248 additions / 61 deletions versus contributor source).

Custody clarification requested by parent: I did not create, edit, copy, or patch `offline-fixture.ts`, any infrastructure fixture, repository source, or repository test. My only filesystem write was this `adversarial-review.md` artifact, using `apply_patch`. I read the concurrent infrastructure trap and sent recommendations but did not transfer or mutate its contents.

## Gates still open

Focused offline green and typecheck/build results above complete this review round's observed checks. The parent must still record final source SHA/signature and additive push verification. Full `npm test` remains pending the separate shared SDK/native-resolver fixture infrastructure task; this review did not run or substitute for it. Final-head CI and all applicable live gates remain pending.

This Retry-After correction does **not** provide attempt-bound diagnosis: the existing account-global freshness store can cross-label concurrent scopes. Naturally spent Fable with another account having capacity, whole-pool spent behavior, delayed refusals after real heartbeat delivery, actual Claude Code main/subagent acceptance, and Linux acceptance remain OPEN. No manufactured exhaustion or real model usage is authorized in this round. Temporary evidence must be escrowed by the parent in its durable separate evidence PR; this `/tmp` report alone is not durable acceptance evidence.
