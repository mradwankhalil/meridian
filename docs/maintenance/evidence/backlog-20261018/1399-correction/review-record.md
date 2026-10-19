# PR #1399 shutdown correction

Scope: only https://github.com/rynfar/meridian/pull/1399. The dirty parent checkout was not edited, switched or reset. Contributor source commits were not rewritten, rebased, cherry-picked, squashed or merged. No comments, external messages, release, account changes or paid usage were performed.

- Source: `a8fccdbdd9abe0f196168cf0a34a341caba1e1a5`.
- Refreshed origin/main: `095b4869b5fe386e2f3a273cc5b60ec3853c8659`.
- Contributor branch: `passabilities/meridian:dex/session-cleanup-throughput`.
- Correction: `4644524c4905f364e995210fbcc2bb3e6952dbd4`.
- Regression tests/final: `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`.
- Both additive commits are SSH signed; local verification is in `signatures.log`. The initial `git log %G?` could not verify because no allowed-signers file was configured; verification with a temporary explicit public-key file succeeded. Global git configuration was not changed.
- Push: fast-forward to the actual contributor branch succeeded (`push.log`). Original source head remains an ancestor. Original contribution by =DEX/eamonster27 and forwarding/corrections by passabilities are unchanged.

## Defect and corrected semantics

An idle `close()` joined a normal sweep already running with a captured 64-attempt allowance. Flipping the proxy's drain flag did not reach that sweep. HTTP drain has no busy request to wait for, so the existing sweep added its full remaining duration to shutdown.

The server now supplies a callback reading its live drain flag. Lifecycle GC clamps its remaining attempt allowance before claims and after joined settlement, then decrements it. The allowance can only decrease. When drain begins during a deletion, that deletion finishes and counts toward the 16 remaining attempts; completed pre-drain attempts do not count against this new allowance. The original total sweep limit and deadline still bound the run. New draining sweeps remain capped at `min(configured cap, 16)`.

Physical deletion, claim-token checking, durable settlement, process-incarnation ownership, executor fencing, pin refresh, native child joining and the existing single-flight promise are unchanged. No shutdown cancellation signal is passed to cleanup and no deletion is detached or abandoned. This is an internal behavior correction; public proxy lifecycle signatures and HTTP contracts are unchanged.

## Discriminating offline proof

Bun 1.3.11 (`af24e281`), Node v22.22.3, Darwin arm64, Agent SDK 0.2.141. Dependencies installed from the unchanged lock with scripts disabled. No model calls or actual client access diagnostics were started.

`regression-tests.patch` contains the exact tests applied before the production correction. On the published source:

- Normal 64 attempts, new draining 16 attempts and lower configured 8 attempts: pass.
- Pause deletion 1, start idle close, prove close stays pending, release: **64 received / 16 expected**, fail.
- Pause deletion 25, start idle close, prove close stays pending, release: **64 received / 40 expected**, fail.
- Existing retirement/backlog and fresh shutdown-cap controls: pass.
- Overall: 5 pass, 2 fail (`original-head-regression.log`).

On the corrected tree, the identical assertions pass (`focused-green.log`, 16 pass across limits and capacity files). The deletion-25 case rejects an incorrect total-sweep cap of 16 as well as the original captured-64 bug. Sidecar checks require every completed deletion settled and no resource left `deleting`.

Direct lifecycle controls cover a lowered allowance that cannot replenish when the provider increases again, failed attempts consuming allowance, and zero allowance preventing any destructive claim. Adjacent lifecycle, contention, process-owner and Windows child-join tests: 63 pass, 1 platform skip, 0 fail (`lifecycle-adjacency.log`). The skip is the executor-PID-reuse recovery control; it remains disclosed rather than treated as executed platform proof.

`reproduce-offline.sh REPOSITORY FINAL_SHA` archives each recorded commit to disposable directories, applies the same regression patch only to the original head, installs the pinned lock without scripts, and asserts the exact original red/corrected green outcomes. Supply an absolute Bun 1.3.11 path via `BUN`.

## Independent adversarial review

One read-only agent reviewed the complete contributor diff versus refreshed origin/main and all GC callers before correction. A second read-only agent reviewed the complete source diff and correction, including shutdown/claim/settlement interleavings and ownership safeguards. Neither ran tests or modified files. No material finding survived the correction.

Finite defaults remain 2,112 pending and 22,112 owned; no new unbounded default queue was found. Known limitations remain: very large configured grace/very short interval can derive impractically large finite bounds; lifecycle rewrites cost O(store size) per transaction; back-to-back deletion can contend with admission; a last claim near the sweep deadline can waste work. Existing configuration conflict markers match main and were not changed.

## Full local gate investigation and retained gates

The first full `npm test` log is retained in `npm-test.log` without replacement. Its pretest typecheck passed. It developed failures before the new GC file ran, with early errors `Claude auth-status process cleanup is unconfirmed` and later missing SDK attempts. Source review found the resolver/auth modules and dependency metadata unchanged by this correction. The first 5.2-second failure matches resolver timeout plus kill/join grace; a retained unresolved executable resolver then blocks later SDK calls. This is an observed failure chain, not a proven underlying cause.

`auth-owned-process-probe.ts` invokes only `/bin/sh` with fixed public `printf offline` output, through raw and owned file/shell forms. Under the pinned Bun all callback, exit, child-close and pipe-close events arrived and owned joins succeeded (`auth-owned-process-bun-complete.log`). This falsifies a general missing-close-runtime explanation. It does not explain or clear the suite failure. Host load averages reached 68–77 during the run (`host-load-during-suite.txt`); contention is recorded, not used to excuse failures.

Final results: main npm stage 6,396 pass / 36 skip / 89 fail; all 23 separately executed isolated stages 464 pass / 0 fail; standalone typecheck and build pass. All seven capacity controls pass in the full main process too. `full-suite-failures.json` preserves every one of the 89 failing test instances and original log locations. The additional Pi main-first/nonstream cross-process failure timed out after five seconds waiting for `pi-owner:sdk-start`; its cause also remains unresolved. A green diagnostic or isolated stage does not convert the original red full gate to green.

The validated archived reproducer produced the same original 5 pass / 2 fail and corrected 7 pass / 0 fail outcomes (`reproduced-original.log`, `reproduced-corrected.log`, `reproducer-validation.exit=0`). Offline real SDK controls passed: 64 deleted in 12.7s; new draining sweep 16 deleted in 3.8s; both retired all 300 synthetic orphans and left no deleting state. The exact command escrow is `offline-sdk-commands.sh`.

Final GitHub snapshot (`pr-final.json`) matches `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`: eight SUCCESS checks including required `test`, one SKIPPED changelog-duplication check, PR OPEN / CLEAN. CI is green; local full-suite and actual-client gates remain open independently.

Actual macOS parallel Claude Code throughput, transcript-admission latency and stop time under approximately one hour of affected-client load are still OPEN. No actual acceptance, merge or release is claimed. Every future actual Claude/OpenCode access diagnostic or client run must satisfy generation-matched Meridian plugin preflight with configuration, load, route and header witnesses. Synthetic deletion and mocked tests do not close that gate.

This directory is a temporary escrow for the parent workflow. The parent must copy the exact sanitized harnesses, red/green logs and final handoff into its separate evidence PR #1412. Nothing here was committed to the contributor branch; durable publication remains a parent handoff action.
