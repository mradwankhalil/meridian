# PR 1396 second delegated live verification round

**Disposition: live acceptance remains OPEN. No merge approval.** Actual native Claude Code baseline/candidate runs reproduced the reminder-disappearance shape and demonstrated a concrete continuation/replay contrast. Exact Fable served identity on every tool round and prompt-cache continuity did not pass. No source changes, commits, pushes, PR creation, external comments, merges or releases occurred.

## Sources, platform and isolation

- PR: https://github.com/rynfar/meridian/pull/1396 . GitHub refreshed at start: OPEN, published candidate `a40be1795a1b8dbcdeccfe8525b972c17609ff73`, base `095b4869b5fe386e2f3a273cc5b60ec3853c8659`.
- Candidate: this task's preexisting isolated worktree `/Volumes/DevSSD/meridian/t3-worktrees/t3-48df6869` was clean, fetched and **detached** at the exact published candidate. Tree `31fa9355df3e86f5b25f01ffab2d0efb7c2753e5`; no tracked edits. Original branch is checked out elsewhere and was not touched.
- Before baseline: separate detached worktree `/tmp/meridian-1396-live-baseline` at current main `095b4869b5fe386e2f3a273cc5b60ec3853c8659`, tree `aff2161455f8c49b4422ea63740c32b3da45738f`. Main is the red baseline for the PR's original reminder problem. Original contributor head `83d15d5357fc6d50c96cb44ad4355b865467929b` already fixes that reminder and is the separate pre-correction durable-tail regression baseline; this round did not rerun its live edited-instruction case.
- Actual host: Darwin `25.6.0`, arm64; separately checked stock Node `v22.22.3`; native test runtime Bun `1.3.11`. The JSON reports' `node=v24.3.0` is Bun's `process.version` compatibility value, not a stock Node invocation. Frozen installs used available Bun `1.3.14`; lockfiles unchanged and identical.
- Both independently installed/built sources: `@anthropic-ai/claude-agent-sdk` `0.2.141`, installed outer Claude Code `2.1.296 (Claude Code)`, actual SDK child init `claude_code_version=2.1.302`.
- Requested literal model on **all 12 native requests**: `claude-fable-5-1`; Meridian query model `fable[1m]`; no fallback model was configured or different model selected by this harness.
- Read current origin/main AGENTS, evidence/upstream-review skills, verification reference, relevant architecture/E2E and prior reports. Parent evidence was found at `docs/maintenance/evidence/backlog-20261018` in `/private/tmp/meridian-pr1409-20261018` (the brief omitted `maintenance`). That checkout was read only.
- Owner clarified the plugin requirement after the initial question: plugins support OpenCode/Pi. These runs used the documented native Claude Code adapter, with no OpenCode/Pi client run or manual session/agent headers. Baseline public telemetry confirms `adapter=claude-code` for all six requests. The candidate's first harness did not retain telemetry; its real native subagent header, complete client wire skeletons, real SDK queries and supported product session mappings are retained. Do not claim candidate telemetry was captured.

Each arm used fresh owned loopback proxy/relay ports; separate Meridian config/store, profile config, native-client config, proxy workdir and disposable file-chain fixture. An unexpired access token was read through `createPlatformCredentialStore().read()`, kept in memory and passed to one explicit access-only `oauth-token` profile. No refresh token was forwarded or grant file written. `MERIDIAN_CREDENTIALS_READONLY=1` and isolated profile config prevented account refresh/write fallback. No login, account change, Extra Usage/credit switch, background warmer or alternative-model diagnostic occurred. No private SDK transcript file was opened. Follow-up history inspection used product `readSessionStoreSnapshot()` and SDK `getSessionMessages()` only.

## Commands and bounds

Both source directories:

```sh
bun install --frozen-lockfile
PATH=/tmp/meridian-1396-tooling/node_modules/.bin:$PATH npm run build
```

Candidate actual run (executed first; one attempt, no rerun):

```sh
E2E_ALLOW_LIVE_MODEL=1 E2E_SOURCE_ROOT=/Volumes/DevSSD/meridian/t3-worktrees/t3-48df6869 E2E_OUTPUT=/tmp/meridian-1396-live-evidence/candidate /tmp/meridian-1396-tooling/node_modules/.bin/bun /tmp/meridian-1396-live-evidence/native-fable-probe-attempt1.mjs
```

The candidate ran those exact bytes when they were named `native-fable-probe.mjs`; they were subsequently preserved as `native-fable-probe-attempt1.mjs`. Its SHA-256 is `749a668d9af40e4cb37e95be08cf6cfe3f33a8f26c7a367557b634b0281097f2`.

Baseline actual run (one attempt):

```sh
E2E_ALLOW_LIVE_MODEL=1 E2E_SOURCE_ROOT=/tmp/meridian-1396-live-baseline E2E_OUTPUT=/tmp/meridian-1396-live-evidence/baseline /tmp/meridian-1396-tooling/node_modules/.bin/bun /tmp/meridian-1396-live-evidence/native-fable-probe.mjs
```

Each actual invocation asked the real parent to launch **one foreground native Agent-tool subagent**, explicitly configured for Fable, then wait for its result. That subagent followed three randomly named linked files using three dependent Read calls. The final file contained a random receipt. The first file disclosed only the next path, making the steps dependent. Bounds: 3 requested tool rounds, 8 outer-client turns, 12 recorded-request ceiling, 240-second client deadline. Each arm actually used **6 HTTP requests / 6 SDK queries**, including 4 subagent requests, and completed within its deadline.

Offline-only reanalysis and supported history inspection (no further client/model call):

```sh
E2E_SOURCE_ROOT=/Volumes/DevSSD/meridian/t3-worktrees/t3-48df6869 /tmp/meridian-1396-tooling/node_modules/.bin/bun /tmp/meridian-1396-live-evidence/analyze-sanitized.mjs /tmp/meridian-1396-live-evidence/candidate
E2E_SOURCE_ROOT=/tmp/meridian-1396-live-baseline /tmp/meridian-1396-tooling/node_modules/.bin/bun /tmp/meridian-1396-live-evidence/analyze-sanitized.mjs /tmp/meridian-1396-live-evidence/baseline
```

## Deterministic observed before/after facts

Both native clients exited **0**, returned the owned receipt and received HTTP **200** on all six requests. Each actual run emitted one stable native subagent id and the exact known English batching reminder. Sanitized skeletons hash each block after excluding only cache hints; no model wording is asserted.

- **Exact affected wire witness, both arms:** subagent request **3→4 at message position 4**, and **4→5 at position 7**, lose only the final exact known reminder block while retaining the complete durable system prefix. The same historical position is retained. The two pair witnesses and durable-prefix digests are in each `analysis.json`. This is real client traffic, not the earlier scripted API fixture. No reminder-only system turn was emitted.
- **Before, current main:** SDK queries 2→3 continue once; **queries 4 and 5 start fresh with `<conversation_history>` replay** after those exact reminder disappearances. Baseline telemetry for the subagent is `new, continuation, new, new`. Its final active public SDK history contains three rows and no structured earlier Read calls/results; earlier history was flattened into replay. This does not establish that the earlier results were absent from the flattened text.
- **After, candidate:** subagent queries **2→3→4→5** form three distinct SDK forks. Each resume target equals its previous observed query's served session; each `resumeSessionAt` equals an assistant UUID emitted by that source query. All three have `forkSession=true`, no `<conversation_history>` replay and request-reminder presence in the SDK input. The parent's query 6 resumes query 1 separately. Candidate per-request telemetry was not captured by attempt 1.
- **Structured state, candidate:** supported `getSessionMessages()` on its published active subagent yields **three `mcp__oc__Read` calls and three successful real tool_results**, exactly one result per id, no forwarding denial among these results and no pending tool ids. The parent holds one `mcp__oc__Agent` call/result pair. `mcp__oc__` is Meridian's SDK forwarding namespace here; it does not imply an OpenCode client was used. Published targets match captured SDK query targets.
- **Cleanup:** all observed original Node child handles reported leader exit, process close, stdout close and stderr close; all query iterators settled and queries were closed. Baseline also records settled relay handlers. Candidate attempt 1 did not instrument relay-handler settlement. These witnesses cover owned observed handles, not an independently audited global descendant inventory.

This establishes a useful real before/after **continuation contrast**. It does **not** establish every acceptance gate below.

## Failed and missing gates

1. **Exact served model on all affected tool rounds — OPEN.** Native requests, SDK init and final answers name Fable. However real SDK assistant events and supported histories name **`claude-opus-4-8` on queries 1–4**, and `claude-fable-5-1` on final queries 5–6 in both arms. No replacement model was deliberately requested. The reason for this runtime model routing was not established; do not diagnose account failure or assert an all-Fable tool-round test. Fable final completion is accessible, so calling the account entirely inaccessible would also be inaccurate.
2. **Prompt-cache continuity — FAIL / unresolved.** Candidate subagent resumes read **6,112 / prior cached 12,154**, then **6,428 / 12,786**, then **0 / 13,448** tokens. All are below E41's required 95%. Parent continuation reads **0 / 22,200**. Baseline also fails its observed resumed-pair cache floor. Mixed runtime model labels are a confound; there was no causal diagnosis or green rerun, and this is not claimed repaired by the lineage fix.
3. **Independent unchanged-tail live negative control — NOT RUN.** The first pre-shedding continuation works on both arms, but it is not relabeled as the requested separate unchanged-system-tail control. Prior direct pure/HTTP unchanged-tail controls remain separate evidence in the earlier report.
4. **Reminder-only native shape — NOT OBSERVED.** Both actual runs exercised cached durable prefix plus reminder, not the sole-reminder turn. Existing unit/HTTP checks cannot replace this missing live shape.
5. **Source immutability before/after each fork and saved-session follow-up — NOT RUN / missing snapshots.** The public after-run active histories establish structured pair counts; there were no before-request supported source snapshots, so no unchanged-source claim is made.
6. **E41 four modes and remaining adjacent client gates — NOT RUN.** Chain/parallel × streaming/nonstreaming acceptance remains open. These native arms used streaming client requests. The broader paid matrix stopped before starting because exact served identity and cache gates remain unresolved. No OpenCode/Pi run was substituted.
7. **Live durable-instruction A→B correction-specific red/green — NOT RUN.** The actual native fixture did not edit a durable system instruction after a cache breakpoint. The original83d tests-only red and candidate direct regression green from the previous report remain the evidence for that separate correction.
8. **CI/signatures/integration/merge policy — parent-owned.** This task does not refresh all CI or authorize landing. The owner-approved PR1413 policy route does not waive any live/local/CI/signature gate.

## Harness failures and corrections preserved

Candidate attempt 1's recorded terminal label is **`BLOCKED_PROVIDER_REFUSAL`**, exit 1. That label was a **harness error**: it classified expected passthrough checkpoint `error_max_turns` as a provider refusal. All actual HTTP responses were 200; the native client exited 0 and delivered the receipt. The raw sanitized result is retained unchanged. Offline `analysis.json` reports the actual facts and `LIVE_ACCEPTANCE_INCOMPLETE`; it does not erase the failed attempt.

Attempt 1 also compared SDK profile config to the wrong expected directory and omitted candidate telemetry; a separate post-run supported product mapping lookup confirmed the actual config was under the owned `config/profiles/owned-access-only` (`candidate-owned-locators.json`). This is post-run confirmation, not a retroactive admission-time guard. The baseline harness was corrected to check owned profile paths, preserve telemetry, match captured source/checkpoint pairs, avoid expected-max-turn refusal classification, require a fresh output directory and bound cleanup. These are observation/guard changes, not product changes or a new candidate run. Both arms' shared offline analyzer evaluates the same sanitized reminder, checkpoint, model, cache and supported-history facts. Baseline actual harness exits 1 with **`INCOMPLETE_LIVE_ASSERTIONS`**; both offline analyses conclude **`LIVE_ACCEPTANCE_INCOMPLETE`**. The arms used equivalent client/model stimuli with different harness instrumentation, not byte-identical harnesses.

An independent read-only reviewer found additional harness limits, retained in `independent-evidence-review.md`. The live probe is deliberately escrowed as partial evidence, not presented as a finished replacement for the committed full gates. In particular no broad success label can close the cache, immutable-source, exact model, control or E41 gaps.

## Evidence escrow

- Working evidence: `/tmp/meridian-1396-live-evidence`.
- Durable sanitized copy: `/Volumes/DevSSD/meridian/evidence/pr-1396-live-20261018`.
- Source/build/lock/harness hashes: `provenance.json`; selected-artifact hashes: `MANIFEST.sha256`. Candidate hashes were supplemented after the run with its build unchanged; candidate v1 did not attest its imported bundle at launch. The successful captured build receipt supplies separate provenance, a narrower guarantee than a launch-time hash.
- Each arm: sanitized `report.json`, offline `analysis.json`, run/analysis summary logs. Runnable probe versions and analyzer are escrowed alongside build/install logs and this report.
- **Only explicit sanitized artifacts are copied.** Runtime `sdk-config`, `client-config`, `config`, `store`, proxy workdirs and owned session/transcript files are excluded from the shareable bundle. Do not recursively archive those runtime state directories.
- Parent must carry the sanitized harness/reports/logs into its separate maintainer evidence PR or durable PR/CI artifact before landing. No evidence-only commit was placed on the contributor branch.

Both sources were frozen-installed and built successfully; candidate final `git diff --check` and clean tracked status passed. The earlier full 6,961-pass local suite was read, not rerun or relabeled as this round. This task performed two bounded live scenarios, no model diagnostic loops, and left the acceptance gates above open.
