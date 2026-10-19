# PR #1410 maintainer correction

PR: https://github.com/rynfar/meridian/pull/1410

Status: signed correction pushed to the original contributor branch; focused checks, typecheck, build, full npm test and exact-head CI pass. Actual-client/E41 and realistic heap/churn acceptance remain open. No merge, release, external comment/review/message, amend/rebase, force-push, or edits in the original checkout.

## Exact source and checkout

- Fetched current origin/main: `095b4869b5fe386e2f3a273cc5b60ec3853c8659`.
- Original contributor head and correction parent: `d74048e4f9101abbdb269cac721f7e709470a6c2`.
- Original author: `Nowaker <spam@nowaker.net>`, authored `2026-10-18T23:30:47Z`.
- Separate correction: `423477f19812b08e15d332d4f7c9c91ebf4e8650`, `fix: preserve shared passthrough schema order`.
- Correction author/committer: `Trevor Walker <rynfar@gmail.com>`; SSH-signed. Verification passed using an explicit temporary allowed-signers file with the configured public signing key; no global Git configuration changed. Plain `git verify-commit` initially lacked `gpg.ssh.allowedSignersFile`, not a signature failure.
- GitHub independently confirms this correction as `verified=true`, `reason=valid` (`/tmp/meridian-1410-evidence/correction-verification.json`).
- Isolated worktree: `/private/tmp/meridian-pr1410-correction-20261018` (also `/tmp/meridian-pr1410-correction-20261018`). Created detached at fetched main, then `gh pr checkout 1410` selected original contributor branch `fix/shared-passthrough-definitions`, push remote `https://github.com/Nowaker/meridian.git`.
- Original user checkout: `/Volumes/DevSSD/meridian/t3-worktrees/t3-eb957b1a`, branch `t3/preserve-tool-schema-order`, still at `446a0f1633be3a0cf36d8f1e9f222e914d2f7c83`, clean and preserved.
- PR registered with this delegated T3 thread using `link_pull_request`.

## Review and correction

Read current fetched-main AGENTS/contributing/architecture, upstream-review/evidence skills and incorporation/verification references, applicable E2E mandatory plugin preflight/E41, and current handoff header. Reviewed the complete contributor diff (three files, 139 insertions/two deletions) plus surrounding builder/session cache/query consumers. Read `/tmp/meridian-passthrough-review.md` after it appeared. Separate independent final audit: `/tmp/meridian-1410-cache-audit.md`, copied into the evidence bundle.

Product fit: sharing identical immutable built Zod definitions addresses per-session duplication while retaining each query's own SDK MCP server. It does not share execution permissions, transport state, session IDs, authentication, profile state, or request hooks. No public interface changed.

Confirmed defect: the new global digest canonicalized raw schemas with `stableStringify`, while root `Object.entries` conversion and nested declared-schema rendering preserve insertion order. B's cache miss could reuse A's differently ordered advertised schema, making its prompt depend on which session arrived first. Only the new shared digest now uses `JSON.stringify(tool.input_schema ?? null)`. Existing `computeToolSetKey` canonicalization/description behavior is unchanged.

Correction touches only `src/proxy/passthroughTools.ts` and necessary regression coverage in `src/__tests__/passthrough-mcp-per-query.test.ts`; no evidence/harness/handoff artifacts were committed to the contributor branch.

## Meaningful red/green and real SDK evidence

Dependencies installed in the isolated worktree with `bun install --frozen-lockfile --ignore-scripts`; no lock/package edits. Real Agent SDK `0.2.141`, Zod `4.4.3`, Bun `1.3.14`, host Node `22.22.3`, macOS arm64. Locked Claude Code package `2.1.296` was installed but no native Claude or model call was made by these probes.

Before source correction, `bun test src/__tests__/passthrough-mcp-per-query.test.ts` failed both new root/nested schema-order regressions; the three existing per-query controls passed (3 pass/2 fail, exit 1). Failures compared the actual serialized SDK `tools/list` response with a fresh B build: shared B advertised `[a,b]` while fresh B advertised `[b,a]`, at both root and nested maps. Baseline log: `/tmp/meridian-1410-evidence/order-regression-red.log`.

After correction, focused checks passed: **64 pass/0 fail across eight files**, exit 0:

```sh
bun test src/__tests__/passthrough-shared-definitions.test.ts src/__tests__/passthrough-mcp-per-query.test.ts src/__tests__/defer-pin.test.ts src/__tests__/passthrough-tool-set-key.test.ts src/__tests__/passthrough-tool-aliases.test.ts src/__tests__/passthrough-tool-sort.test.ts src/__tests__/passthrough-declared-schema.test.ts src/__tests__/proxy-passthrough-oc-prefixed-tools.test.ts
```

Focused log: `/tmp/meridian-1410-evidence/focused-green.log`. Both new tests run in child processes isolated from process-global SDK mocks. They compare wire JSON (deep object equality alone ignores key order), root/nested maps, both cache-population orders, unchanged input schemas, clone cache hits, four distinct simultaneously connected server instances and continued catalog access after closing other queries.

Reproducible credential-free probe (parent should escrow separately):

```sh
bun /tmp/meridian-1410-sdk-order-probe.mjs /tmp/meridian-pr1410-correction-20261018
```

Harness also copied to `/tmp/meridian-1410-evidence/sdk-order-probe.mjs`. It calls public real MCP Client/InMemoryTransport `listTools`/`callTool`/close only; **zero model calls**. Sanitized complete records: `sdk-order-red.json` and `sdk-order-green.json` in that evidence directory; raw logs retain baseline assertion and green exit.

All four root/nested × first-arrival-order baseline cases: `sharedObject=true`, second advertised order equals the first request's order, `serializedCatalogEqual=false`; independent transports/close survival/calls/input immutability already pass. Baseline exits 1. All four corrected cases: `sharedObject=false`, each catalog retains its own declared order, serialized shared B equals fresh B, identical clones reuse definitions, all four server instances are independent, calls and survivor access work, inputs remain unchanged. Corrected exits 0.

## Other risk findings

- No additional substantive bug survived independent full-diff/input/consumer/cleanup review.
- Digest includes namespace, resolved/pinned auto-defer, relevant lowercased core names, names, descriptions, defer flags and complete raw schema. Conservative extra misses for reordered tool/core lists are an efficiency limit, not wrong output sharing.
- Index contains only digest strings and WeakRefs; finalizer held values contain only digests. Existing session caches and active queries own strong lifetimes. Old finalizers check the current WeakRef and cannot delete a live replacement; no asynchronous gap exists within that check/delete.
- Consumers read shared aliases/name arrays; query allowed-tools are copied. Per-query SDK registration does not introduce request/session/auth state into shared definitions.
- Finalizer/GC timing is nondeterministic. This audit does not prove timely collection or heap plateaus. Contributor's 3,117 MB to 108 MB claim has not been independently remeasured here; parent should escrow a realistic 230-tool, bounded-session-churn heap harness/evidence separately.
- Existing per-session cache key ignores description changes and canonicalizes schema order, so changes inside an already cached session can retain the older catalog. This predates #1410 and is explicitly outside this correction.

## Required local and remaining acceptance gates

- `npm run typecheck`: PASS, exit 0 (`typecheck.log`).
- `npm run build`: PASS, exit 0, including Node entrypoint checks (`build.log`).
- `git diff --check`: PASS.
- `npm test`: PASS, exit 0, including pretest `tsc --noEmit` and all 24 isolated batches: **6,948 pass, 36 skip, 0 fail**, 6,984 tests including skipped across 406 file invocations. Main batch: 6,479 pass/36 skip/0 fail across 383 files, 558.52 seconds. Raw log `npm-test.log`, concise receipt `npm-test-summary.json`.
- Exact corrected-head CI, including required `test`: PASS. All eight applicable checks succeeded; changelog duplication skipped. Required CI `test` completed `2026-10-19T05:10:30Z` on `423477f19812b08e15d332d4f7c9c91ebf4e8650`; base remained `095b4869b5fe386e2f3a273cc5b60ec3853c8659`. Final snapshot `ci-final-snapshot.json`.
- Actual affected-client OpenCode + actual served Claude model/SDK/native CLI/platform acceptance: OPEN. No actual OpenCode/Claude run or access/login diagnostic was attempted. Although an OpenCode executable exists on this host, matching affected-version/model/platform qualification and required matching Meridian plugin/load/route witnesses were not established in this bounded correction task.
- All four E41 chain/parallel × streaming/nonstreaming modes: OPEN, not replaced by SDK MCP protocol evidence. Parent must retain exact call/result pairing, checkpoint/fork history, immutable parent history, saved-fork continuation and ≥95% prior-prefix cache reuse. Qualify the actual client and E42 extended V2 flows where applicable.
- Any actual OpenCode/Claude run, even a tiny diagnostic, must first install the generation-matching Meridian client plugin through tested setup, retain resolved config/plugin identity and pre-inference load witness, then preserve route/API prefix and plugin-generated session/agent/signed-turn headers as E2E.md requires. A server scrub alone or hand-set headers do not satisfy this gate.

This validation record is preserved here. Temporary paths identify supplemental transfer artifacts; durable SDK before/after probes are linked in README.md. Parent must put the sanitized harness, before/after record, audit/handoff and remaining gates into its separate maintainer evidence PR before claiming durable escrow. Parent owns CI decisions, acceptance, checkpoint and merge; this task has no merge/release authority.

## Completion

Fork push succeeded (exit 0): `d74048e4f..423477f19 HEAD -> fix/shared-passthrough-definitions`, using an explicit non-force push to `https://github.com/Nowaker/meridian.git`. GitHub immediately confirmed head `423477f19812b08e15d332d4f7c9c91ebf4e8650`, base `095b4869b5fe386e2f3a273cc5b60ec3853c8659`, PR OPEN, two commits preserving contributor history, `mergeStateStatus=UNSTABLE` while CI starts. Local correction worktree clean.

Initial exact-head CI snapshot: required `test` queued, authorship/Docker smoke/Ubuntu desktop in progress, Nix/macOS desktop/windows smoke queued; changelog duplication skipped. Snapshot `/tmp/meridian-1410-evidence/ci-after-push.json`. CI run: https://github.com/rynfar/meridian/actions/runs/39202398097 . This is not a final-head green claim; parent controls CI/merge/checkpoint.

Final read-only GitHub snapshot confirms the exact correction head and original tested base above, PR OPEN and `mergeStateStatus=CLEAN`. Authorship, required test, Docker smoke/build-push, Nix home build, both desktop builds and windows-smoke all succeeded. The changelog-duplication check was skipped. No merge was performed despite clean merge state; live/heap gates remain as above. Local `git ls-remote` matches the exact correction SHA; isolated worktree remains clean.

Full local npm command completed exit 0. No unrelated test failure or corrective rerun occurred. The same correction source tree passed focused checks, standalone typecheck/build and the full gate; no source changes followed the successful focused run. Both newly added real-SDK regressions passed inside the full batch as well.

PR linkage verified with `list_thread_pull_requests`; #1410 is linked. `unwatch_pull_request` returned `watching=false`, `wasWatching=false` before handback. Parent retains merge/checkpoint control.
