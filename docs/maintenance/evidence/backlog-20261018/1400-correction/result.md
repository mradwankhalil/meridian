# PR #1400 offline correction handoff — 2026-10-19

The authorized implementation round is published for review/CI. This is not completed product acceptance and is not merge-ready: full local suite, exact-head CI, affected live flows, and durable parent evidence escrow remain pending.

## Source, branch, authorship and publication

- PR: https://github.com/rynfar/meridian/pull/1400 (OPEN, linked to this T3 thread; unwatched before handoff).
- Refreshed main: `da8187ab4553e4fd2120aa0098b2a81b197502dc`.
- Original published source head: `9451a72aa48127ddd6106bedb48ecdb98e03f04d`.
- Final published head: `cf399a7db7db59aa6d8f4596c3eb30d610a60a74`.
- Actual fork/branch: `passabilities/meridian`, `dex/model-allowance-failover`.
- Local branch: `dex/model-allowance-failover` in `/Users/rynfar/.t3/worktrees/meridian/t3-fa1c2388` (physical path `/Volumes/DevSSD/meridian/t3-worktrees/t3-fa1c2388`). The initial stale worktree was switched to the exact fetched source head. The dirty parent checkout was not operated on or edited.
- One additive correction commit, whose direct parent is exactly the source head. All seven original introduced commits remain unchanged reachable objects. Their SHA, Author, AuthorDate, Committer and GitHub signature records are escrowed in the evidence directory. GitHub final PR commit list is the original seven followed by this correction.
- Correction Author/Committer: Trevor Walker <rynfar@gmail.com>; existing author metadata was never changed. No cherry-pick, rebase, amend, force push or replacement PR.
- Local SSH verification: good ED25519 Git signature for `rynfar@gmail.com`. GitHub: `verified: true`, `reason: valid`. All seven original signatures also reported valid.
- Exact push: `git push https://github.com/passabilities/meridian.git HEAD:refs/heads/dex/model-allowance-failover` → exit 0, fast-forward `9451a72aa..cf399a7db`. Remote ref and GitHub PR head independently matched the final SHA afterward.
- No merge, admin/protection change, external comment/message, release, model request, paid usage, account-setting change or quota-spending load was performed. The initial unguarded test fixture deviation below is explicitly disclosed.

## Correction and independent review

Only these three files changed in the additive commit:

- `src/proxy/server.ts`: `markPriorityFailure` no longer returns a newly attempted deadline. Both JSON and SSE terminal paths calculate the wait from current effective `benchedUntil` values across `options.poolIds`, without a historical attempted minimum. Existing `benchedUntil` takes max(account, requested model); the terminal calculation takes the earliest eligible account. A retained continuation continues to use its retained-account-only pool. Existing monotonic marks, model scope, candidate ordering and exposure barriers are unchanged.
- `src/__tests__/active-priority-integration.test.ts`: JSON/SSE regressions cover repeated shorter marks with the retried or distinct skipped account opening first, overlapping whole-account/model exclusions, asynchronous refinement during later attempts, expiry during dispatch, and ordinary first-mark behavior. Controls prove unrelated models still serve from the model-benched active account.
- `src/__tests__/priority-routing-integration.test.ts`: retained-account JSON/SSE regressions repeat a shorter refusal while its longer exclusion remains, excluding the other account's earlier opening.

Independent same-provider read-only review inspected the complete production diff against current main, adjacent dispatch/pool callers, contract and tests. It found one material additional P2 in the initial correction: ignoring a now-unbenched pool member could advertise another account's hours-long wait. Red JSON/SSE tests received 10681/10680 instead of the normal 60-second fallback. The helper now returns the existing fallback when any actually relevant member has no effective exclusion. Final review found no surviving material correction finding. Its report is `adversarial-review.md`.

The existing diagnosis-freshness record remains account-global; concurrent requests can cross-label model/account scope. This correction supplies no attempt-bound diagnosis and makes no such claim. The terminal calculation reflects effective marks present at response construction; it does not await an uncompleted background usage refresh.

## Runtime and offline boundary

Pinned executable used: `/tmp/meridian-1400-tooling/bin/bun`, a symlink to `/tmp/meridian-1399-tooling/node_modules/bun/bin/bun.exe`. Direct `--version`, test runner lines and in-process `Bun.version` all verified **1.3.11** (`af24e281`); the host Bun launcher was not relied on. Platform: Darwin arm64. Installed SDK package: 0.2.141. Installed CLI package: 2.1.296, read from package metadata only; no native CLI version/access diagnostic was used to qualify the final tests.

Dependencies were installed only in this worktree with pinned `bun install --frozen-lockfile --ignore-scripts`; exit 0. No dependency/lock changes were committed.

**Fixture deviation retained:** the first existing SDK-mocked baseline control passed 1/0 but unexpectedly invoked native auth-status lookups for synthetic work/personal profile directories and logged `loggedIn:false`. SDK mocking alone did not isolate the resolver/credential boundary. This was not a live model request, and it is not claimed as guarded offline evidence. The log `baseline-control.log` is retained; no further HTTP tests were run until an external guard was installed. The initial fixture can also reach native credential-store reads, so zero credential/native access is not asserted for that first control.

All subsequent HTTP/source checks used `offline-fixture.ts` or the source-only probe. The external HTTP fixture mocks auth lookup, executable resolution and platform credential-store creation, preserves real model mapping, and traps child-process/network APIs. It also stubs unrelated build provenance and process-incarnation native probes. Guarded test logs show `SDK_BOUNDARY_TRAP {"attempts":[],"actualNativeChildren":0,"actualNetworkCalls":0}`. This temporary fixture is deliberately off the contributor branch. The separate infrastructure task owns the repository's shared SDK-mocked/native-resolver boundary and heavy full suite.

## Reproduction and checks

All Bun commands below used `/tmp/meridian-1400-tooling/bin/bun` and `PATH=/tmp/meridian-1400-tooling/bin:$PATH`. The precise command ledger, exit codes and associated logs are `commands.json`. `<evidence>` is `/tmp/meridian-1400-correction-evidence`.

Before the production correction, against unchanged source head with only the new tests added:

- `bun test --preload <evidence>/offline-fixture.ts src/__tests__/active-priority-integration.test.ts --test-name-pattern 'effective pool retry waits'` → exit 1; 2 pass / 6 fail. Ordinary first marks passed; repeated/overlap waits returned 600 rather than about 10800 seconds. `red-active.log`.
- `bun test --preload <evidence>/offline-fixture.ts src/__tests__/active-priority-integration.test.ts --test-name-pattern 'uses a bench extended'` → exit 1; 0 pass / 2 fail. `red-refinement.log`.
- `bun test --preload <evidence>/offline-fixture.ts src/__tests__/priority-routing-integration.test.ts --test-name-pattern 'keeps the retained account'` → exit 1; 0 pass / 2 fail. JSON/SSE retained wait returned 600 instead of about 10800 seconds. `red-retained.log`.
- `bun <evidence>/pool-source-probe.ts .` → exit 1; exact source-helper output `reportedMs:600000`, `effectiveEarliestMs:10800000`. `red-source-probe.log`. This extracts the current helper and uses the real pure tracker without loading the server or any model/client.
- `red-tests.patch` contains the exact added test diff for those original-source red runs. The later expiry regression is against the initial correction, not falsely attributed to the original source. `correction-before-expired.patch` and `red-expired.log` preserve that intermediate red state.

Final code checks:

- `bun test --preload <evidence>/offline-fixture.ts src/__tests__/active-priority-integration.test.ts` → exit 0; **54 pass / 0 fail**, 380 assertions. `green-active-file.log`.
- `bun test --preload <evidence>/offline-fixture.ts src/__tests__/priority-routing-integration.test.ts --test-name-pattern 'keeps the retained account'` → exit 0; **2 pass / 0 fail**, 27 assertions. `green-retained-final.log`.
- `bun test --preload <evidence>/offline-fixture.ts src/__tests__/routing.test.ts src/__tests__/errors.test.ts src/__tests__/limit-detection.test.ts src/__tests__/retry-after-unit.test.ts` → exit 0; **362 pass / 0 fail**, 917 assertions. These leaf files were unchanged by the final expiry guard; affected server tests were rerun afterward. `green-units.log`.
- `bun <evidence>/pool-source-probe.ts .` → exit 0; `reportedMs:10800000`, `effectiveEarliestMs:10800000`. `green-source-probe-final.log`.
- `PATH=/tmp/meridian-1400-tooling/bin:$PATH npm run typecheck` → exit 0. `typecheck-final.log`.
- `PATH=/tmp/meridian-1400-tooling/bin:$PATH npm run build` → exit 0; bundles, TypeScript declaration generation and Node entrypoint syntax checks passed. `build-final.log`. This certified the final source bytes before commit; the commit did not change those bytes.
- `git diff --check HEAD^ HEAD` → exit 0. Worktree clean after commit/build. Local signature verification and ancestry assertions passed; GitHub verified the final signature and exact head.
- `node --check <evidence>/replay.mjs` → exit 0. The convenience replay wrapper is syntax-checked, not claimed as an additional executed acceptance run. It rewrites only the fixture's recorded absolute checkout root into a caller-selected isolated root, pins Bun 1.3.11, and runs the source/affected checks; no full suite or model calls. Underlying exact probes/tests were executed as listed above.

Final focused total: **418 passing tests**; fourteen JSON/SSE regression cases exercise this correction (twelve active-pool cases and two retained cases, including the rewritten retained control). This is not `npm test` or whole-PR acceptance.

## Pending gates and custody

1. **PENDING full local suite:** no concurrent `npm test` was started. Parent must delegate a fresh validation round after the shared SDK-mock/native-resolver infrastructure settles, using actual Bun 1.3.11. The entire priority-routing file was not rerun in this round; its affected retained cases were.
2. **PENDING final-head CI**, including required `test`, on `cf399a7db7db59aa6d8f4596c3eb30d610a60a74`. Parent owns monitoring; this thread is unwatched. No acceptance is inferred from old-source CI.
3. **OPEN live E78/affected-flow acceptance:** naturally spent Fable allowance with account-wide/other-model room plus a second account with real Fable capacity; `ALSO_SPENT` whole-pool behavior; actual delayed post-heartbeat refusal; real Claude Code main plus Fable subagent flows using implicated SDK/model/CLI; Linux acceptance. No quota exhaustion was manufactured, no paid usage enabled, and no real model requests were made in this correction round. Parent's prior unresolved model-identity/cache failures remain unresolved, not superseded by these mocks.
4. **OPEN account-global diagnosis limitation:** concurrent scopes can cross-label diagnoses; the retry-timing correction does not solve or prove attempt-bound evidence.
5. **PENDING durable escrow:** this directory and `/tmp/meridian-1400-correction-result.md` are the transfer packet for the parent's separate evidence PR. A temporary path alone is not durable acceptance evidence. The contributor branch intentionally contains only necessary source/regressions. Parent must publish the sanitized probes, exact original failures, before/after logs and this handoff in that evidence PR; this task opened no extra PR and posted no comments.
6. Before any eventual merge, parent must refresh the full batch/per-PR Author/signature manifest, current main/head/combined tree, protection, mergeability and all final gates. The approved commit-preserving forwarded route remains mandatory. No product PR was merged here.

Evidence directory: `/tmp/meridian-1400-correction-evidence`.
