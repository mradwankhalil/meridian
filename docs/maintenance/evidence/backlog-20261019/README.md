# Overnight backlog results — 2026-10-19

The owner authorized autonomous safe backlog work, not a release. Six product
and test PRs landed with verified trees, required exact-head CI and preserved
contributor Authors. Five more contributor branches received corrections or
fresh main integrations and now pass full local gates and CI; their real-flow
evidence remains incomplete. No issue was closed on partial proof. No release or
external comment/message was published. The user's dirty desktop checkout was
preserved; all work used isolated worktrees. This root run used Centeva
GPT-6.1-Sol after the requested account handoff; the earlier fixture task result
was incorporated and independently corrected/verified.

The paginated inventory covered 165 accessible repositories and six managed
Meridian/scrub repositories without a discovery gap. The product-batch refresh
recorded 28 open Meridian PRs (including the then-open evidence PR), 18 issues, and only the
two already-held scrub release PRs. Every still-open PR/issue has a [current disposition and revisit trigger](queue-dispositions.md);
the detailed prior source findings remain in [the earlier handoff](../backlog-20261018/README.md).

## Landed and verified

| PR | Result | Exact receipt |
| --- | --- | --- |
| [#1415](https://github.com/rynfar/meridian/pull/1415) | SDK mock boundary, worker startup/auth controls; 6,959 pass / 36 skip; signed squash `658a3b5c5` | [gates](1415/final-gate-summary.json), [merge](1415/merge-receipt.json) |
| [#1411](https://github.com/rynfar/meridian/pull/1411) | Provider-filter URLs, including corrected all-hidden selection; 6,972 pass / 36 skip and 19 asserted browser cases; signed squash `58d9dd8c0` | [gates](1411/final-gate-summary.json), [browser](1411/browser-control.json), [merge](1411/merge-receipt.json) |
| [#1420](https://github.com/rynfar/meridian/pull/1420) | Watchdog fixture asserts real timer ownership instead of a 150ms threshold; old-leak mutation fails; 6,972 pass / 36 skip; signed squash `f01ba1ae3` | [gates](1420/final-gate-summary.json), [merge](1420/merge-receipt.json) |
| [#1409](https://github.com/rynfar/meridian/pull/1409) | Owned per-process test temp directory and child cleanup; 6,973 pass / 36 skip; signed squash `355f9b34c` | [gates](1409/final-gate-summary.json), [merge](1409/merge-receipt.json) |
| [#1398](https://github.com/rynfar/meridian/pull/1398) | Bun startup advisory; 6,977 pass / 36 skip, nine CLI/four transport controls; signed merge `70b5af12a`; eight introduced author objects unchanged | [gates](1398/final-gate-summary.json), [manifest](1398/premerge-commit-manifest.json), [merge](1398/merge-receipt.json) |
| [#1407](https://github.com/rynfar/meridian/pull/1407) | Typed OpenAI streaming errors; actual AgentLink interruption distinguishes baseline false length from candidate error; 6,982 pass / 36 skip; signed squash `6c241a897` | [gates](1407/final-gate-summary.json), [live](1407/live-summary.json), [merge](1407/merge-receipt.json) |

Each complete gate above ran all 24 isolated invocations on pinned Bun 1.3.11
(`af24e281`), typecheck and build. Every relevant final-head check, including
`test`, passed. Each landed tree equals the reviewed tree. Contributor-owned
PR squashes retain the actual contributor as Git Author; clean main merges
alone earn no maintainer coauthor. The owner-approved #1398 forwarded route
retains every recorded source commit, Author and AuthorDate unchanged.
[The refreshed attribution audit](attribution-audit.json) adds no maintainer
re-land defect; the 137 legacy cases and one older unmapped case remain owner
work under #1363.

The #1409 CI watchdog failure is retained in the #1420 mutation record. A
separate [Bun bundler EISDIR failure](1420/earlier-bundler-failure.json) remains
unexplained: replacing a dependency symlink with an owned frozen install led
to a complete pass with the same lockfile/Zod source, not an established
bundler fix. Broader flaky-test issues #917 and #933 stay open.

## Corrected branches with open acceptance gates

| PR / exact head | Completed | Remaining gate |
| --- | --- | --- |
| [#1406](https://github.com/rynfar/meridian/pull/1406) `c8bab07d0` | Truthful isolation UI/docs, readable mobile select, actual fresh/resumed native SDK fixtures, desktop/mobile browser checks; full 6,984 pass / 36 skip, type/build and CI | Actual affected OpenCode/model and applicable E41/E42 matrix. Resumed sessions retain earlier foreign guidance; fresh conversation required. #1405 stays open. |
| [#1419](https://github.com/rynfar/meridian/pull/1419) `8ca566398` | Maintainer correction preserves assistant-ending legacy last-user fallback; two discriminating red tests then 68 message tests green; full 6,988 pass / 36 skip, type/build and CI | Final-head actual-client verification and applicable resume/cache matrix. Earlier DeepSeek Harness/Haiku framing/tool-result proof is explicitly on an earlier head; baseline answer omission did not reproduce. |
| [#1399](https://github.com/rynfar/meridian/pull/1399) `7379cd465` | Cooperative shutdown clamp corrected; 16 focused cases, full 7,000 pass / 36 skip, type/build and CI; actual native bounded pilot | Native large-store/hourly throughput, admission and bounded shutdown proof. The dependency-chain pilot stopped on refusal/fallback before seeding; no hour claim. |
| [#1220](https://github.com/rynfar/meridian/pull/1220) `b1fffe4ac` | Known queued-input, pre-rename revocation and clear-epoch corrections plus new local-fallback ownership fix; seven red cases, 29 affected and 59 adjacent tests green; full 6,997 pass / 36 skip, type/build and CI | The original unexplained residual E41 cache-prefix failure plus actual affected-client/model/platform acceptance. No SQLite changes; existing #1244 approval remains valid. |
| [#1400](https://github.com/rynfar/meridian/pull/1400) `2f17bf73d` | Effective Retry-After correction retained with a clean main merge; full 7,059 pass / 36 skip, type/build and CI | Naturally spent model allowance with other-account capacity, whole-pool/late-refusal behavior, actual native main/subagent and Linux proof. No quota burn or paid overage. |

Full receipts: [#1406](1406/final-gate-summary.json),
[#1419](1419/final-gate-summary.json), [#1399](1399/final-gate-summary.json),
[#1220](1220/final-gate-summary.json), [#1400](1400/final-gate-summary.json). [The #1220 correction record](1220/README.md)
retains all seven failing-before controls, the new recovery attachment guard and
the seven newer hooks adapted to await async cleanup.
The earlier #1406 benchmark miss is [retained](1406/earlier-benchmark-failure.json)
without a claimed causal fix. Its benchmark/session-store bytes match main;
concurrent work was present, but its effect is unknown. The later complete gate
followed a real UI correction; no timing threshold was weakened.

#1406's [fresh fixture](1406/candidate.json) removes foreign MCP declarations
and SessionStart guidance while keeping client tools/context. Its
[resumed fixture](1406/resumed-session.json) removes declarations but retains
old guidance; no history purge is claimed. [Browser proof](1406/browser-receipt.json)
covers 1280×800 and 375×812 with no horizontal overflow. The final copy and
75.5px mobile select fix ship only on that contributor branch.

#1419's [actual earlier live receipt](1419/live-summary.json) uses the
published DeepSeek Harness adapter 0.2.1-rc.2 / pi-ai 1.1.0, Node 22.22.3,
SDK 0.2.141 and native CLI 2.1.302 with Haiku 5.5. It establishes three user
frames and a tool-result-plus-reminder continuation. Baseline also answered
its receipt, so it does not establish the reporter's answer omission. These
are production headless client components, not desktop UI coverage.

## New native refusal/fallback finding

The initial #1399 Haiku native pilot returned HTTP 400 before SDK/provider
inference because the native request uses unsupported adaptive thinking. A
separate Opus 5.5/200k pilot passed 63 real requests, 21 read/result/resume
cycles, 59.7 SDK queries/minute and all process joins. That small-store success
does not establish sustained large-store acceptance.

The next [real dependency-chain pilot](1399/pilot3-refusal-summary.json)
failed in warm-up. Three requests reached the provider, all Opus 5.5; the
second and third returned `stop_reason: refusal`. Native CLI then attempted
Opus 4.8 despite requested Opus and null SDK fallback. The guard blocked that
fourth request **before network**. No 4.8 response was served. All five owned
processes joined and private grants/config were removed. No seeds or hourly
load started, and no more paid-model calls followed the refusal.

The manual harness had not stopped retries on an HTTP-200 refusal. It now
latches that stop, denies further inference/tool forwarding, distinguishes
attempts from admitted generations and returns nonretryable errors on tool
whitelist failures. [Offline guard controls](1399/load-guards-offline.json)
pass. An [actual native credentialless refusal fixture](1399/native-refusal-offline.json)
shows default two requests versus one with no-fallback plus no-refusal-retry
controls, always retaining an error. The API-key fixture did not pivot models,
so it does not prove the real OAuth fallback is disabled. Production defaults
were not changed based on undocumented controls. See the
[driver, limits and full analysis](1399/README.md).

A separate [bounded E41 diagnostic](model-boundary-qualification/README.md)
passed five provider generations with correlated Opus 5.5 provider/native/
stored IDs, three sequential calls, source immutability and cache assertions.
Its earlier aggregate-context-label guard failure is retained. This fresh
pass does not explain historical Opus 4.8 tags; the new refusal/fallback
mechanism cannot retroactively supply the missing old provider boundary.
#1410, #1396 and other applicable matrix gates stay open. Do not rerun refused
requests or switch models to obtain acceptance. Establish an explicit model/
refusal policy and preserve provider IDs before resuming those flows.

## Release and remaining queue holds

The new Release Please [#1418](https://github.com/rynfar/meridian/pull/1418)
was reviewed for the forwarded-merge requirement. Its body includes #1411 and
#1407 but [omits the #1398 startup advisory](1398/release-notes-followup.json)
despite retained conventional source commits. Resolve that omission before an
authorized release; no author history was rewritten. No release is authorized.
Scrub release PRs OpenCode #20 and Pi #15 remain held, with no contributor/issue
queue behind them. The old product, platform, draft, owner-decision and
no-review dispositions in the prior evidence remain in force. In particular,
#1403 lacks actual reported PDF client/model proof; #1404 needs actual agent-
switch reproduction; #1400 needs real spent-allowance failover without forced
exhaustion; unapproved public API proposals retain approval holds; already-approved storage
contracts require correct implementation and native acceptance.

Native executables, access grants, raw customer content and private SDK files
are excluded. New native controls pin Claude Code 2.1.302 SHA-256
`5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37`.
Screenshots were visually inspected and retained locally; structured browser
receipts and drivers are committed. [The media follow-up](visual-media-status.json)
records both available GitHub browser profiles signed out, no upload/login
attempt beyond that check, and closed agent tabs. Media upload remains explicit
before accepting held #1406. No full-queue-clear or release claim.
