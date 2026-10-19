# Meridian #1398 validation — implementation sub-agent

PR: https://github.com/rynfar/meridian/pull/1398

Disposition: **NOT merge-ready: the normal local `npm test` gate has four unresolved failures, and the original-author attribution needs parent disposition. Product/code review accepts the warning as proposed. No merge performed.** The change warns about existing Bun transport behavior; it does not fix cancellation. No substantive product correction was found, so there are no maintainer commits or pushes.

## Identity and checkout

- Reviewed candidate: `e87a79446cc8d8fe170fdc71ffefdd32c7a24c32`.
- Contributor branch/fork: `dex/bun-startup-warning`, `passabilities/meridian`.
- PR opener: `passabilities`; `maintainerCanModify: true` verified live.
- Fetched current base: `origin/main` = `095b4869b5fe386e2f3a273cc5b60ec3853c8659`.
- Merge base: `dfe264daf2bca18fcc426e4e1268987ea166c427`.
- Candidate worktree: `/tmp/meridian-pr1398-20261018`, created detached from fetched current main and then switched with `gh pr checkout 1398 --repo rynfar/meridian`. The existing contributor branch was retained. No integration copy was created.
- Unchanged-main comparison worktree: `/tmp/meridian-pr1398-baseline-20261018`, detached at the fetched base; dependencies symlink to the candidate's immutable lockfile install.
- User/parent checkout was not switched, reset or edited. Only shared Git fetch/worktree metadata changed. Candidate tracked worktree remained clean.
- No amend, rebase, force push, direct-main push, external comment/message, release action or merge occurred. Parent alone owns the durable handoff and merge decision.

Read current `origin/main` AGENTS, contribution/API references, upstream-review/evidence skills and their incorporation/verification references, active/current handoff sections (no #1398 entry), architecture dependency/cancellation boundaries, and affected E2E cases. Refreshed complete public PR body, all five commits, full five-file diff, reviews, issue comments, review comments and timeline. There were no review/comment objections to resolve.

## Required local checks

Environment: macOS 26.6.2 (25G83), Darwin 25.6.0 arm64; Bun 1.3.14 (`0d9b296a`), Node v22.22.3, npm 10.9.8, TypeScript 5.9.3, `@hono/node-server` 1.19.15, Hono 4.12.34, Agent SDK 0.2.141, packaged Claude Code 2.1.296. The SDK/model was not invoked in the live probes.

Commands ran in the candidate worktree unless stated otherwise:

| Check | Result | Evidence |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | PASS, 200 packages; lockfile unchanged | `/tmp/meridian-1398-install.log` |
| `bun test src/__tests__/runtime-cancel-warning.test.ts` | PASS, 4 pass / 0 fail / 7 expectations | `/tmp/meridian-1398-focused.log` |
| `npm run typecheck` | PASS, exit 0 | `/tmp/meridian-1398-typecheck.log` |
| `npm run build` | PASS, exit 0; Node syntax entrypoint checks and declaration build included | `/tmp/meridian-1398-build.log` |
| `git diff --check origin/main...HEAD` | PASS, exit 0 | complete proposed diff inspected |
| `npm test` | FAIL, exit 1; pretest typecheck passed; first segment: 6,467 pass / 36 skip / 4 fail, 31,264 expectations, 6,507 tests / 383 files / 755.08 s | `/tmp/meridian-1398-npm-test.log` |

The certified local build is counter 1, attempt `becb7b74-f7d0-47e7-a0ba-63f7985a11ea`, from the exact candidate. No source was changed after building.

The original complete first-segment run was retained; it was not rerun to replace a failure with green output. Three failures are `Profile switch API > GET /profiles/list returns all profiles with active status`, `GET /profiles/list reflects switched profile`, and `Profile rename API > GET /profiles/list surfaces the names a rename left behind`, at 30,015.91 / 30,115.68 / 30,003.64 ms, exceeding the existing 30,000 ms timeout. Diagnostic command `bun test --timeout 30000 src/__tests__/profile-switch-integration.test.ts` passed 12/12 with 25 expectations both on the candidate (3.21 s) and current main (3.10 s). Logs: `/tmp/meridian-1398-candidate-profile-switch.log`, `/tmp/meridian-1398-baseline-profile-switch.log`. These isolated passes demonstrate an order/environment-dependent failure; they do not make the original full gate green. The tests call `createProxyServer`, not the modified `startProxyServer` banner. Independent review found no demonstrated leaking mock: the profile tests mock model auth but not `tokenRefresh`, so their non-empty list calls still await native macOS credential-store reads and potentially shared `credentialFactsInflight` promises. This localizes a plausible boundary, not the proven root cause. Empty-list succeeds. Relevant `models-auth-status` mocks are excluded from the first segment, and other child-process mocks are worker-only; blaming them is unsupported. The three timeouts remain unresolved.

The failing first segment stops the normal npm script's `&&` chain, so its later 23 isolated commands did not run as part of the required gate. The auxiliary attempt below does not close that missing coverage. Required local acceptance therefore remains blocked despite green hosted CI and passing warning-specific checks. No unrelated test/package-script correction was pushed without a demonstrated candidate defect.

A fourth original-run failure appeared in `proxy-cross-process-coordination.test.ts:385`: `modified-history conflict is replayable only in passthrough across processes: passthrough=false, stream=true` expected status 400 but got status 500 / `Internal Server Error` (1,889.41 ms). Its worker uses `createProxyServer` and a mocked SDK, so the warning path is not invoked. There is no retained inner stack in the parent's output; cause is unresolved, not asserted to be a harmless timing flake. Diagnostic command `bun test --timeout 30000 --test-name-pattern 'modified-history conflict is replayable only in passthrough across processes: passthrough=false, stream=true' src/__tests__/proxy-cross-process-coordination.test.ts` passed on both candidate (1 pass / 0 fail / 10 filtered / 4 expectations, 6.93 s) and current main (same counts, 6.95 s). These selected passes do not explain or supersede the original failure. Logs: `/tmp/meridian-1398-{candidate,baseline}-cross-process.log`.

### Auxiliary tail-run harness failure (excluded from product/test-gate verdict)

Because the original first segment already had failures and its `&&` chain would skip later isolated segments, I attempted to run those segments separately using `/tmp/meridian-1398-tail-tests.mjs`. This auxiliary runner added the same Keychain-exec-denying macOS sandbox used for the no-generation CLI controls. **That environment was inappropriate for stateful tests:** it also prevents Apple's `/bin/ps` from executing, so session/process-incarnation capture cannot work. A direct control against the same live PID proves it: normal `/bin/ps -p <pid> -o lstart=` exits 0 with a start time; under the sandbox it exits 71 with `sandbox-exec: execvp() of '/bin/ps' failed: Operation not permitted`. `session/processIncarnation.ts` calls exactly that command. Thus the auxiliary `cannot capture lock owner process incarnation` failures have a concrete harness cause and are not candidate regressions.

I stopped that auxiliary runner and its exact child subtree with SIGTERM after identifying this; wrapper exit 143. Completed command/count receipts are `/tmp/meridian-1398-tail-results.json`: 13 completed segments, 191 pass / 85 fail in the unsuitable sandbox; a following segment was interrupted. Individual original logs `/tmp/meridian-1398-tail-01.log` through `-13.log` (plus any in-progress next log) and `/tmp/meridian-1398-tail-tests.log` are preserved. No sandbox-free green rerun is being substituted for them. These counts do not enter the required normal `npm test` totals. The auxiliary attempt does not establish complete tail coverage. It does not invalidate the CLI feature/channel assertions, which deliberately send no generation or session-store operation, but the CLI logs also retain any background session-GC warning from this sandbox.

One administrative metadata query, `node -p 'JSON.stringify({hono:require("hono/package.json").version})'`, exited 1 with `ERR_PACKAGE_PATH_NOT_EXPORTED`: Hono deliberately does not export that package subpath. Installed versions were then read from their installed `node_modules/<name>/package.json` files through `fs.readFileSync`, recorded in `/tmp/meridian-1398-versions.json`. This is package export encapsulation, not a build/test/product failure; no code was changed or check rerun because of it.

## Actual CLI warning and protocol proof (no generation)

Run: `node /tmp/meridian-1398-cli-probe.mjs`.

**PASS: nine cases, all server cases gracefully exited 0 after SIGINT.**

| Actual entrypoint | Expected/observed warning on stderr | stdout / HTTP assertions |
| --- | --- | --- |
| Current main, `bun bin/cli.ts` | 0 | no warning in stdout or control responses |
| Candidate, `bun bin/cli.ts` | exactly 1 | no warning in stdout or control responses |
| Candidate, `bun dist/cli.js` | exactly 1 | no warning in stdout or control responses |
| Candidate, `node dist/cli.js` | 0 | Node negative control; clean stdout/control responses |
| Candidate, `MERIDIAN_SILENT=1 bun bin/cli.ts` | 0 | no normal startup banner; control responses unchanged |
| Bun source and Node dist, `--version` (2 cases) | 0, stderr empty | exact package version plus newline; exit 0 |
| Bun source and Node dist, `--help` (2 cases) | 0, stderr empty | expected help prefix; exit 0 |

Each server's real loopback `GET /livez` returned HTTP 200 / `ok\n`; `GET /inflight` returned parseable JSON with HTTP 200, `total: 0`, `scope: "client-http"`. Neither response contained warning text. The positive warning named the running Bun 1.3.14, checked versions 1.2.20/1.3.11/1.3.14, allowance cost and both source/npm remedies. Source inspection confirms the call follows the optional `Build:` stdout line inside the same `!finalConfig.silent` banner. Because stdout and stderr are separate pipes, the harness asserts channels and counts rather than claiming cross-stream delivery ordering.

Credential isolation: fresh HOME/CLAUDE_CONFIG_DIR/MERIDIAN_CONFIG_DIR/XDG_CONFIG_HOME/TMPDIR per child, allowlisted environment (no inherited provider tokens), read-only credential mode (disables background renewal/auth keepalive), and macOS sandbox denying execution of `/usr/bin/security`. `MERIDIAN_CLAUDE_PATH=/usr/bin/false` deliberately makes the existing auth preflight fail without executing Claude or inspecting login state; its expected existing "Could not verify Claude auth status" warning is retained in logs. Thus these are real Meridian CLI/server starts with the auth preflight disabled for this probe; they are not proof of authenticated model cancellation. No credential file, login, private SDK transcript, health/profile endpoint, generation request or actual model was needed. The server only received liveness/inflight control requests.

Receipts: `/tmp/meridian-1398-evidence/cli-results.json`, `*.stdout.log`, `*.stderr.log`; original controller output `/tmp/meridian-1398-cli-probe.log`.

After adding only last-connection-error diagnostics to the controller (no product change), the same nine cases passed again; `/tmp/meridian-1398-cli-probe-final.log` retains that verification. There was no failed CLI run or relaxed assertion.

## Installed-runtime disconnect premise

Run: `node /tmp/meridian-1398-disconnect-probe.mjs`.

**PASS: four runtime/transport cases.** An external stock-Node raw TCP client sends a complete small HTTP POST, then drops its connection at 300 ms with zero response bytes received. Both the bare `node:http` server and the actually installed Hono adapter (using `overrideGlobalObjects: false`, as Meridian does) intentionally withhold the response. Receipt taken after a 2,300 ms observation window:

| Runtime / actual transport | Result |
| --- | --- |
| Node 22.22.3 / `node:http` | `res.close`, `socket.close`, `req.close` at 302 ms |
| Node 22.22.3 / `@hono/node-server` 1.19.15 | real Request signal aborted at 276 ms relative to fetch-handler entry |
| Bun 1.3.14 / `node:http` | none of the three close events during 2,300 ms |
| Bun 1.3.14 / same installed Hono adapter | real Request signal never aborted during 2,300 ms |

All four children exited 0 with confirmed closure and zero response bytes sent before client disconnect. The Node control makes the transport difference observable without depending on model wording, credentials or generation. This directly corroborates the limited Bun transport premise on the installed implicated runtime/platform; the real CLI probe separately proves the feature added by this PR. It does not establish cancellation of a real SDK/model turn or universal behavior on other Bun versions/platforms.

Receipts: `/tmp/meridian-1398-evidence/disconnect-results.json`, `{node,bun}-{http,hono}.log`, exact child script `disconnect-server.mjs`; original controller output `/tmp/meridian-1398-disconnect-probe.log`.

## Adversarial product/regression review

Independent read-only review: `/tmp/meridian-1398-adversarial.md` (native child agent). Concrete findings:

- **Product fit:** the warning reaches the documented direct Bun development start, names the allowance consequence and gives viable source and installed-package remedies. Existing supervisor prefers built Node; warning still matters when that supervisor is bypassed or dist is absent. Runtime advisory is reasonable within the selected PR's scope.
- **Architecture:** the helper imports nothing; no top-level log, mutable state or dependency cycle. Server orchestration calls it downward. Only an import and two banner lines change the production server.
- **Public compatibility:** `ProxyConfig`, returned Node-style server, lifecycle, routes, headers and message/SSE bodies are unchanged; no API-contract approval is implicated by the product code. No adapter-specific logic is introduced.
- **Regression boundaries:** generation, retries, cancellation implementation, concurrency, session/history/cache, profiles/credentials, package dependencies and versions are untouched in the PR diff. Node and silent paths do not call `console.warn` for this feature. CLI early-exit help/version paths and module import have no new top-level side effects. Normal/socket-activated Claude starts share the banner; no warning is emitted on a failed bind.
- **Tests:** four pure helper tests cover detection/text/probed-version scope/remedies/Node control; actual process tests above cover invocation, silent mode, output channels and clean protocol rather than relying on helper tests alone.
- **No material code finding survived review.** No contributor-branch correction was warranted.

Non-blocking limitations to retain: standalone `backend: "antigravity"` returns before this Claude/combined banner, so it gets no new warning. E2E.md's broad "a proxy"/"any Bun" wording should be read within the changed Claude/combined scope. Direct `createProxyServer().app` embedders have no owned startup banner, and silent embedders intentionally get no warning. The advisory prints on unprobed Bun versions but explicitly names versions checked; no evidence proves future releases still exhibit the issue. Full SDK/client/model cancellation and Linux/Windows re-probes remain unverified as the contributor's E2E section states; those are not the behavior added by this warning-only PR. No model calls were made to fill unrelated cancellation evidence.

Five newer main commits contain profile/auth/model fixes and release metadata. They do not touch the banner insertion/new helper. The PR's older package version is inherited base state, not a proposed version downgrade. No conflicts or hidden changed files were found; GitHub reports MERGEABLE/CLEAN.

## Attribution gate for parent (not a source-code correction)

Current contribution policy requires the original contributor to be Author on main and explicitly says `Co-authored-by` is insufficient. Live public facts:

- #1398 opener and head owner: `passabilities` (GitHub association CONTRIBUTOR).
- Original implementation commit `0341a48bed945f4a4671fcdec9fa18c84e7708d1`: Author `=DEX <eamonbachari@gmail.com>` / `eamonster27`, with `cherry picked from commit 38d43c0d6a836006a7090378b28bc44a25582b19` in its message.
- The PR body explicitly says "Authored by @eamonster27; split out of their fork work and rebased onto current main by @passabilities", followed by a co-author trailer for =DEX. The other four commits are passabilities's follow-up corrections/documentation.
- The public PR body/timeline/comments/reviews contain no explicit owner authorization or original-author consent for changing original authorship. Mentions/automatic subscriptions do not establish consent. This is disclosed contributor-to-contributor repackaging, not evidence that passabilities is a maintainer; the original-author issue remains either way.

Under the documented ordinary squash behavior, merging #1398 would name its opener passabilities as Author, not =DEX. Its green Attribution check and CLEAN merge state do not establish compliance with the stronger contribution rule. **Parent must resolve this before merging.** I did not choose another merge method, rewrite commits, recreate a PR, contact contributors, or ask the user to approve a hypothetical plan. This gate cannot be repaired by an unrelated signed product commit on this branch.

The exact source is the fetched [contribution workflow](https://github.com/rynfar/meridian/blob/095b4869b5fe386e2f3a273cc5b60ec3853c8659/.agents/references/contributing.md#contributor-pull-requests): "A `Co-authored-by` trailer is not credit for work they wrote." The [verification reference](https://github.com/rynfar/meridian/blob/095b4869b5fe386e2f3a273cc5b60ec3853c8659/.agents/skills/meridian-upstream-review/references/verification.md) says "The full gate is `npm test`, not a bare all-files `bun test`"; the [evidence skill](https://github.com/rynfar/meridian/blob/095b4869b5fe386e2f3a273cc5b60ec3853c8659/.agents/skills/meridian-evidence/SKILL.md) says "State missing evidence explicitly." These are the concrete policy sources for retaining the attribution and failed-local-gate holds; they do not authorize me to choose a different merge method or represent selected passing checks as the full gate.

## CI and remaining parent actions

Final live snapshot at **2026-10-19T05:06:22Z**, after a second `git fetch origin`: candidate and base unchanged, tracked candidate worktree clean, `maintainerCanModify: true`, `MERGEABLE`, `CLEAN`, not draft. Eight successful checks on the exact candidate; one skipped:

- `test`: https://github.com/rynfar/meridian/actions/runs/38955309153/job/117156574440
- `authorship`: https://github.com/rynfar/meridian/actions/runs/38955309032/job/117156576248
- Docker smoke: https://github.com/rynfar/meridian/actions/runs/38955309105/job/117156574119
- Docker build-push: https://github.com/rynfar/meridian/actions/runs/38955309105/job/117157826221
- Nix x86_64-linux home: https://github.com/rynfar/meridian/actions/runs/38955309103/job/117156575023
- desktop Ubuntu: https://github.com/rynfar/meridian/actions/runs/38955309076/job/117156574492
- desktop macOS: https://github.com/rynfar/meridian/actions/runs/38955309076/job/117156573920
- Windows smoke: https://github.com/rynfar/meridian/actions/runs/38955309153/job/117156574815
- `changelog-duplication`: skipped.

Machine snapshot: `/tmp/meridian-1398-github-final.json`. PR is registered with this T3 task/thread; no watcher was enabled. Parent must refresh head/base/merge state immediately before any separately authorized merge.

This report and local logs are deliberately outside the contributor branch. **The full validation record is preserved here; temporary paths identify auxiliary transfer artifacts.** Parent owns copying the sanitized report, exact runnable controllers and relevant logs into its review/evidence handoff or separate maintainer evidence PR before landing; no evidence/harness/handoff-only commits belong on #1398. All original failures must travel with the evidence, not just passing controls.

Prepared local handoff bundle: `/tmp/meridian-1398-handoff/`, with this report, independent review, exact probe controllers/child script, CLI/disconnect receipts, version/CI snapshots, gate logs except the raw full-suite log, and a concise sanitized original-gate failure footer. It includes the complete auxiliary attempt receipts/logs separately labelled `tail-*` so those unsuitable-environment failures are not discarded. `SHA256SUMS` records the copied artifacts. The original complete npm output remains at the path above; review it before any external publication. This prepared bundle is still temporary and must be escrowed by the parent.
