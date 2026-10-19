# PR 1396 maintainer correction

Status: both signed corrections pushed to the contributor branch at `a40be1795a1b8dbcdeccfe8525b972c17609ff73`; full local `npm test`, typecheck and build passed. No merge, release, external comment/message, source-author rewrite, rebase, amendment or force push.

## Identity and checkout

- PR: https://github.com/rynfar/meridian/pull/1396 ; fork `passabilities/meridian`, branch `dex/system-turn-lineage`; maintainer edits enabled.
- Isolated worktree: `/Volumes/DevSSD/meridian/t3-worktrees/t3-51877477` (also `/Users/rynfar/.t3/worktrees/meridian/t3-51877477`). Existing clean task branch started at `446a0f1633be3a0cf36d8f1e9f222e914d2f7c83`; preserved by switching this task's isolated worktree with `gh pr checkout 1396`.
- Fresh fetched `origin/main`: `095b4869b5fe386e2f3a273cc5b60ec3853c8659`.
- Original contributor PR head: `83d15d5357fc6d50c96cb44ad4355b865467929b`; confirmed before correction and again immediately before committing. Merge base with current main: `dfe264daf2bca18fcc426e4e1268987ea166c427`.
- Correction 1: `db52bfd0187d9b61e3627f71059564f27e71b2cb` — `fix: preserve durable Claude Code system tails in lineage`.
- Correction 2 / final local head: `a40be1795a1b8dbcdeccfe8525b972c17609ff73` — `test: require witnessed Claude Code batching reminder coverage`.
- Final tree: `31fa9355df3e86f5b25f01ffab2d0efb7c2753e5`; final gate script blob: `f5e221cbb412829b1c3a14d00783213572622db0`.
- Both correction commits use repository identity `Trevor Walker <rynfar@gmail.com>` and SSH signatures. `git -c gpg.ssh.allowedSignersFile=/tmp/meridian-1396-allowed-signers verify-commit db52bfd0187d9b61e3627f71059564f27e71b2cb a40be1795a1b8dbcdeccfe8525b972c17609ff73`: exit 0, two good signatures, key fingerprint `SHA256:MIQlVgbMwpydbVe4w7eML0WlJNdddjg/BCl2+2v4GSs`. Default local `git log --show-signature` lacks an allowed-signers configuration; this was resolved only for verification via a temporary public-key allowlist, without repository config changes.

## Scope and review

Read fresh main's AGENTS, contribution workflow, upstream-review skill and incorporation/verification references, evidence skill, architecture adapter/dependency/lineage sections, relevant E2E sections and API contract. Current architecture has `Agent Adapter Pattern` rather than a heading literally named `Agent-Specific Logic`; the adapter boundary and useful NOTE markers are retained. Read the full contributor diff, live PR body, full commit list and adjacent adapter/lineage/server/tests/gate callers. Live PR had no comments or reviews. Earlier handoff was inspected only for existing review context; live state was refreshed.

The material defect was the cache-breakpoint `findLastIndex`/`slice`: both `[cached stable, durable A]` and `[cached stable, durable B]` lost their second blocks before hashing. An edited system instruction resumed the old SDK session and was omitted from the tool-result delta.

The adapter now removes only the final exact known batching-reminder block. Every other block remains significant, including arbitrary durable blocks after a cache breakpoint, reminder lookalikes, and a reminder followed by durable text. Trailing reminder-only turn handling is limited to one exact single-block/string turn at the request end; whitespace lookalikes and earlier reminder-only turns stay. No server/UUID-map or SDK prompt construction code was changed by the correction. Existing captured `[cached token notice, reminder]` to historical string normalization and reminder-only UUID position tests remain green.

Pure tests replace the old test that explicitly endorsed arbitrary truncation. HTTP tests cover streaming/nonstreaming × edited/unchanged durable tail × reminder present/absent, require modified-history fresh replay with Durable B and no Durable A for edits, and checkpoint resume plus exact tool-result SDK input for controls.

Independent read-only adversarial review found no surviving material defect in the correction. It checked preserved durable tails, captured block/string identity, valid trailing-only removal, test falsifiability, prompt and UUID handling, and affected-case gate claims. Earlier independent gate review found count-only reminder detection and no-reminder PASS; both are corrected. Public plugin contracts, module dependencies, cancellation and concurrency ownership are unchanged by these corrections.

## Red before fix

Using Bun 1.3.11, with the product adapter still exactly at original head and only regression tests added:

```sh
PATH=/tmp/meridian-1396-tooling/node_modules/.bin:$PATH bun test src/__tests__/claude-code-system-turn-lineage.test.ts src/__tests__/passthrough-early-stop-integration.test.ts --test-name-pattern 'durable|lookalikes'
```

Exit 1: 3 pass / 9 fail / 177 filtered. Four pure failures prove durable-block loss, identical hashes for changed tails, erroneous replay of an unchanged tail when cache hints disappear, and loss of lookalikes. All four edited-tail HTTP variants failed because `options.resume` was populated and telemetry showed continuation rather than modified-history replay. One additional unchanged HTTP control failed before any affected product behavior with `cannot capture turn-lock owner process incarnation` from unchanged `crossProcessTurnCoordinator.ts:461`; this is retained as an unrelated preflight failure observed on the original product code. Its deeper host-capture cause was not independently diagnosed and is not claimed fixed by the adapter correction. The other unchanged controls passed. Exact log: `/tmp/meridian-1396-red.log`. The tests-only `/tmp/meridian-1396-red-tests.patch` is the exact pre-fix test delta; `git apply --cached --check` against an isolated index populated from the original head passed. Apply it to that head and run the command above to reproduce.

## Green and versions

Host Darwin arm64; Node `v22.22.3`; full/focused checks run with CI-pinned Bun `1.3.11 (af24e281)`, isolated under `/tmp/meridian-1396-tooling` (host Bun 1.3.14 was used only for frozen dependency installation). Frozen install made no tracked lock/package changes. Agent SDK `0.2.141`; installed outer Claude Code `2.1.296`; real SDK child `cc_version=2.1.302.275` observed on the scripted API wire. Tests ran 2026-10-18 America/Denver / 2026-10-19 UTC.

| Check | Result | Log |
|---|---|---|
| Focused durable/lookalike/one-request/reminder-only HTTP and pure cases | exit 0, 20 pass / 0 fail / 170 filtered | `/tmp/meridian-1396-green-focused.log` |
| Entire pure lineage + silent-turn recovery files | exit 0, 33 pass / 0 fail | `/tmp/meridian-1396-unit-recovery.log` |
| `npm run typecheck` | exit 0 | `/tmp/meridian-1396-typecheck.log` |
| `npm run build` | exit 0 | `/tmp/meridian-1396-build.log` |
| Full `npm test` (including pretest and all 24 Bun invocations) | exit 0; 6,961 pass / 36 skip / 0 fail total | `/tmp/meridian-1396-npm-test.log` |
| `git diff --check` | exit 0 | final correction range |

The full run completed once without a rerun: main block 6,497 pass / 36 skip / 0 fail across 383 files (561.60s), then all 23 isolated-file commands passed (464 additional tests). Earlier failures listed in the contributor PR body did not reproduce here; no claim is made that this correction fixes them. There were no full-suite failures requiring baseline replay. The separate red-run process-incarnation preflight failure above remains explicitly unexplained. Machine-readable totals: `/tmp/meridian-1396-npm-test-summary.json`.

Focused green command:

```sh
PATH=/tmp/meridian-1396-tooling/node_modules/.bin:$PATH bun test src/__tests__/claude-code-system-turn-lineage.test.ts src/__tests__/passthrough-early-stop-integration.test.ts --test-name-pattern 'durable|lookalikes|reminder-only|one-request reminder'
```

## Installed-client scripted gate (no model calls or real credentials)

The existing committed actual-client gate was corrected in place; no separate evidence/harness/handoff file was added to the contributor branch. Executed gate source and product code match the final committed tree; commits only recorded the already-tested bytes. It drives the real installed outer client through Meridian, real Agent SDK and real child CLI to a loopback scripted Messages API, with isolated configs/sessions and dummy credentials. It does not establish live Fable acceptance.

```sh
PATH=/tmp/meridian-1396-tooling/node_modules/.bin:$PATH E2E_CLAUDE_CLIENT=node_modules/.bin/claude bun scripts/e2e-claude-code-system-turns.mjs
PATH=/tmp/meridian-1396-tooling/node_modules/.bin:$PATH E2E_CLAUDE_CLIENT=node_modules/.bin/claude bun scripts/e2e-claude-code-system-turns.mjs claude-opus-5-5
PATH=/tmp/meridian-1396-tooling/node_modules/.bin:$PATH E2E_CLAUDE_CLIENT=node_modules/.bin/claude bun scripts/e2e-claude-code-system-turns.mjs claude-opus-5-5 --expect-no-reminder
```

- Fable 5.1 named fixture: exit 0 / PASS, `coverage=affected-reminder`, five reminder-bearing requests and four witnessed exact reminder disappearances with the entire durable prefix retained (cache hints ignored, historical strings normalized). Six total requests: `new, continuation, continuation, continuation, continuation, continuation`; chained SDK resume/checkpoint queries, all structured tool calls/results, exact reminder delivered on all five rounds. `/tmp/meridian-1396-client-fable.log`.
- Opus 5.5 default affected gate: expected exit 1 / FAIL, zero reminder requests/transitions, while every resume and structured-history check passed. It cannot silently claim affected-case PASS. `/tmp/meridian-1396-client-no-reminder.log`.
- Explicit Opus 5.5 no-reminder control: exit 0 / PASS, `coverage=negative-control`, zero transitions, all resume/history checks pass. `/tmp/meridian-1396-client-control.log`.

The gate now checks exact known wording and a consecutive active-to-historical system-turn pair with all other blocks unchanged, not arbitrary block-count shedding. At least two rounds are required. Missing/changed reminder traffic fails the default gate. No-reminder control is explicit and separately labeled. E2E instructions and architecture descriptions were corrected to describe this contract; historical evidence is not relabeled as a new run.

## Open acceptance and attribution holds

1. Actual Fable 5.1 live affected-client/model acceptance through the final build remains OPEN. No live model/real credentials were used by this task. A scripted endpoint cannot close this gate. E41 all four live modes and relevant existing live trailing-system gates were not run here. The reminder-only shape also remains unobserved through a real client gate, as documented.
2. Primary Author attribution remains a CRITICAL HOLD owned by the parent: PR opener is `passabilities`, but source commits `7dcb2149c8b6d7cc8a5008440268e7e6afb74655`, `edd24f6a36f60539873396a3e64bb68a2ade02c1`, `b7a1504a1ef46109f14ec0617f64958f9043548e` name `=DEX <eamonbachari@gmail.com>` / GitHub `eamonster27`. GitHub API independently confirmed first source commit verified=true, reason=valid, login=eamonster27. The ordinary squash opener-author rule cannot itself resolve source primary Author here. No source authors were rewritten; all eight original commits remain ancestors and unchanged.
3. Final-head CI and current head/base/mergeability checks remain parent acceptance gates. Original-head green CI is not final-head validation.
4. Parent owns merge/checkpoint and durable review-handoff/PR evidence escrow. Sanitized logs, tests-only red patch and correction patch are also preserved outside `/tmp` at `/Volumes/DevSSD/meridian/evidence/pr-1396-correction-20261018/`. This report and logs must be carried to the parent's shareable PR/CI or repository handoff before any landing; no evidence-only maintainer commit was placed on the contributor branch.

## Push and final remote state

`git push` exited 0 and fast-forwarded `https://github.com/passabilities/meridian.git`, branch `dex/system-turn-lineage`, from `83d15d5357fc6d50c96cb44ad4355b865467929b` to `a40be1795a1b8dbcdeccfe8525b972c17609ff73`. No source commits were rewritten and no merge was performed. Final GitHub head/check-state snapshot: `/tmp/meridian-1396-final-pr.json`.

GitHub verified both maintainer correction signatures (`verified=true`, `reason=valid`, Author `Trevor Walker <rynfar@gmail.com>`). The final refreshed PR was OPEN, base `095b4869b5fe386e2f3a273cc5b60ec3853c8659`, head `a40be1795a1b8dbcdeccfe8525b972c17609ff73`, merge state UNSTABLE with final-head CI just starting (Attribution/authorship queued at https://github.com/rynfar/meridian/actions/runs/39203479599/job/117901200361). No final-head green CI claim is made. PR is linked to this task thread; monitoring/merge/checkpoint remain with the parent.
