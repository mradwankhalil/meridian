# Meridian #1399 correction result

Correction pushed for review; no merge or acceptance claimed.

- PR: https://github.com/rynfar/meridian/pull/1399 (T3 linked).
- Source SHA: `a8fccdbdd9abe0f196168cf0a34a341caba1e1a5`.
- Final SHA: `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`.
- Original branch: `passabilities/meridian:dex/session-cleanup-throughput`.
- Signed additive fix: `4644524c4905f364e995210fbcc2bb3e6952dbd4`.
- Signed additive tests: `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`.
- Push: successful fast-forward to the actual contributor branch. No rewrite, replacement PR, rebase, cherry-pick, squash or force push. Original =DEX/eamonster27 and passabilities authors preserved; original source remains an ancestor. Local SSH signature verification passed for both correction commits.
- Worktree: `/Volumes/DevSSD/meridian/t3-worktrees/t3-b7f6ebd1`, clean. Dirty parent checkout untouched.

The GC now clamps its remaining deletion attempts from the live drain state between joined transactions. A deletion active when drain starts finishes and counts toward the 16 remaining attempts. Earlier completed work does not consume this shutdown allowance; original batch/deadline bounds still apply. Failed attempts consume the allowance and it cannot replenish. Physical deletion joining, durable locks/settlement, owner/executor fences, pins, generations and the single-flight promise are preserved. Public proxy signatures/routes are unchanged.

## Exact verification

Bun **1.3.11 (af24e281)** via `/tmp/meridian-1399-tooling/node_modules/.bin/bun`; Node v22.22.3; macOS Darwin arm64; installed SDK 0.2.141 / Claude package 2.1.296 (package metadata only). No model calls or actual client/access diagnostics.

- Original-head regression: `bun test src/__tests__/proxy-session-gc-capacity.test.ts`, **5 pass / 2 fail**. Paused first deletion then idle close: received 64, expected 16. Paused deletion 25 then close: received 64, expected 40. Normal 64/new-drain 16/lower 8 controls pass. Exact tests were added before the production fix; original log and patch retained.
- Corrected focus: `bun test src/__tests__/session-gc-limits.test.ts src/__tests__/proxy-session-gc-capacity.test.ts`, **16 pass / 0 fail**. All 7 capacity tests also pass inside the full suite.
- Adjacency: `bun test src/__tests__/session-lifecycle.test.ts src/__tests__/session-lifecycle-process.test.ts src/__tests__/session-lifecycle-windows-gc.test.ts src/__tests__/session-gc-contention.test.ts`, **63 pass / 1 platform skip / 0 fail**. Includes new allowance/failure/zero controls plus process ownership, stale-owner, uncertain-delete, native join and pin protections. PID-reuse recovery control skipped; no platform proof claimed for that case.
- Final `npm test`: pretest typecheck PASS; main stage **6,396 pass / 36 skip / 89 fail**, exit 1, 409.03s. Original failure retained. The first failures report unconfirmed auth-status process cleanup before SDK calls and before the new GC test file; later requests show the same unresolved resolver chain. Also a Pi main-first/nonstream worker timeout waiting 5s for `pi-owner:sdk-start`. All 89 exact failing instances are in `full-suite-failures.json`, with original log lines. Underlying causes remain unresolved; no passing rerun is offered as an explanation.
- Because npm's `&&` chain skipped stages 2–24, each of those exact 23 commands was executed once sequentially by `run-remaining-gates.py`: **464 pass / 0 fail**, every stage exit 0. This does not make the original npm gate green. Per-command argv, exit/time and logs are escrowed.
- `npm run typecheck`: PASS, exit 0, 13.674s. `npm run build`: PASS, exit 0, 7.895s; bundled/certified successfully.
- Archived original/final reproducer validated: `BUN=/tmp/meridian-1399-tooling/node_modules/.bin/bun sh reproduce-offline.sh REPOSITORY 1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`. Confirms original 5/2 red and final 7/0 green using disposable source copies, same test patch and pinned lock. Harness exit 0.
- Real SDK offline synthetic controls: `bun scripts/e2e-session-gc-throughput.mjs` with DRAINING=0/1, **64 deletions in 12.7s / 16 in 3.8s**, both PASS and within 30s; all 300 synthetic orphans retired. Exact commands: `offline-sdk-commands.sh`. These are no-model deletion checks, not client acceptance.
- Harmless owned-process diagnostic (`/bin/sh`, fixed `printf offline`; also `which sh`) observed all close witnesses and successful joins under Bun 1.3.11. Auth/resolver source identities match original head. It did not explain or clear the full-suite failure. Host load 77.35 was recorded; contention is not an excuse for red results.
- `git diff --check`: PASS; working tree clean. Complete contributor diff/callers review and independent final adversarial re-review: no material correction regression found. Known finite-bound/lock-duty-cycle/near-deadline-claim limitations remain disclosed in `review-record.md`.
- Exact final-head CI: **eight SUCCESS**, including [test](https://github.com/rynfar/meridian/actions/runs/39205238710/job/117906534346), one SKIPPED changelog check; PR OPEN/CLEAN. Snapshot: `pr-final.json`.

## Retained gate and handoff

**Local full-suite failure and actual macOS affected-client acceptance remain OPEN.** Approximately one hour of real parallel Claude Code throughput, ownership/admission 503 monitoring, lifecycle-lock admission latency and active-sweep stop timing is still owed. No unbounded/model load was started. Future actual client/access diagnostics require generation-matched Meridian plugin preflight/configuration/load/route/header witnesses; synthetic SDK calls or manual headers cannot substitute.

All artifacts: `/tmp/meridian-1399-correction-evidence`. The parent must escrow the exact sanitized probes, before/after logs and this report durably in its separate **#1412** evidence PR; no evidence/harness/handoff changes were added to the contributor branch. Existing forwarded-author adoption/landing is left to the parent; no squash/rewrite/landing was attempted. No comments/messages, release/account changes, paid usage or protection changes were performed.
