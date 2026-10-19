# PR backlog review — 2026-10-18 MDT / 2026-10-19 UTC

Base reviewed: `095b4869b5fe386e2f3a273cc5b60ec3853c8659` (`main`, 1.83.1).
This is a review and correction batch, not release authorization. The owner's
original checkout (`main` at `446a0f163`) and its desktop edits were preserved.
Contributor fixes stay on their own PR branches; this maintainer evidence PR
contains review records and proof only.

The initial record landed in #1412 as signed `da8187ab4`.
[Subsequent shutdown, credit and resolver-boundary results](shutdown-and-resolver-followup.md)
supersede its earlier #1399 status and 58-commit-current snapshot. No product
PR is represented as merged.

## Coverage and order

Paginated GitHub discovery refreshed the authenticated owner's repositories and
accessible organizations (`Centeva`, `pylon-code`, `kraken-crm`), including private
and archived candidates and the plugin links. Six managed repositories matched:
Meridian, OpenCode/Pi/Hermes/OpenClaw scrub, and HUDScrub. No additional managed
scrub candidate or inaccessible candidate was found.

Initial queue: **29 Meridian PRs, two scrub release PRs**. All five scrub
repositories have zero open issues and zero contributor PRs. Meridian's open
issues were inventoried; this batch prioritizes PRs and their linked reports,
without claiming unrelated issues resolved. Drafts, explicit no-review requests
and prior owner holds remain in force.

## Concrete review results

| PR | Disposition | Work or remaining gate |
| --- | --- | --- |
| [#1409](https://github.com/rynfar/meridian/pull/1409) | Accept test infrastructure change, pending final validation disposition | Independent safety review, focused tests and exact before/after leak probe pass; typecheck/build pass. Local full-suite failures under investigation. See below. |
| [#1411](https://github.com/rynfar/meridian/pull/1411) | Accept with correction | Reproduced all-hidden URL state becoming visible after reload. Signed correction bd08c43d pushed; 50 focused tests and browser proof pass. Full local suite remains red (90 failures); corrected-head CI green; local red gate unresolved. |
| [#1410](https://github.com/rynfar/meridian/pull/1410) | Accept with correction; live gates open | Correction 423477f1, 6,948 full-suite tests and exact-head CI pass. Bounded real-SDK heap/catalog proof and actual matching-plugin OpenCode read/continuation pass. E41 model qualification failed; remaining E41/extended V2 gates stay open. |
| [#1396](https://github.com/rynfar/meridian/pull/1396) | Accept with correction; live gate open | P1 durable-instruction loss corrected by db52bfd0/a40be179; 6,961 full-suite tests and corrected-head CI pass. Actual Fable/client acceptance and final forwarded Author verification remain open. |
| [#1398](https://github.com/rynfar/meridian/pull/1398) | Validate warning change | Actual Bun/Node startup verification passes; full suite remains red (four unresolved failures). This warns; it does not fix underlying Bun disconnect handling. Forwarded-source attribution remains open. |
| [#1407](https://github.com/rynfar/meridian/pull/1407) | Accept code scope; hold acceptance evidence | No surviving source defect; actual AgentLink source consumes error after length finish. Need actual affected-client/model before/after error propagation and ordinary truncation control, plus local final gates. |
| [#1403](https://github.com/rynfar/meridian/pull/1403) | Accept code scope; hold acceptance evidence | No surviving source defect; downstream nested documents/replay supported. Need a complete PDF receipt through real message/tool-output JSON/SSE flows and actual affected client/model (unspecified by contributor), plus local gates. Header-only mapping fixture is not model PDF proof. |
| [#1406](https://github.com/rynfar/meridian/pull/1406) | Accept with corrections | Make passthrough CLAUDE.md Project/Full limitations truthful in UI/type/Crush docs. Prove fresh and previously contaminated resume isolation through actual plugin-qualified OpenCode. Does not resolve agent-switch issue #1404. |
| [#1394](https://github.com/rynfar/meridian/pull/1394), [#1395](https://github.com/rynfar/meridian/pull/1395), [#1397](https://github.com/rynfar/meridian/pull/1397) | Strong candidates after live gates | No surviving implementation defect in async process identity, client cwd, or abort-link ownership. Missing exact-head affected-client/model/platform proof; forwarded-source attribution hold. |
| [#1399](https://github.com/rynfar/meridian/pull/1399) | Accept with correction; local/live gates open | Signed 4644524c/1372390c correct remaining drain work. Red/green, focused, type/build and final-head CI pass; full-local gate retains 89 failures. Supplementary 464 passes used Bun 1.3.14. Actual macOS load acceptance remains open. |
| [#1400](https://github.com/rynfar/meridian/pull/1400) | Accept with correction; final gates pending | Signed cf399a7d corrects effective pool wait, retained scope and expiry. 418 guarded focused cases and type/build pass on Bun 1.3.11; target CI passes including test. Full local/live gates remain. See retry-after correction record. |
| [#1401](https://github.com/rynfar/meridian/pull/1401) | Partial fix, scope/evidence hold | Useful stale-copy guard; newer-map eviction/read failure still loses assistant answers. Need explicit accepted limited scope or own-copy gap backstop and real A→B→A/rewind controls. |
| [#1220](https://github.com/rynfar/meridian/pull/1220) | Accept direction, corrections required | Three known snapshot/revocation/cache-epoch fixes remain absent after rebase; original residual E41 cache failure unexplained. #1244 contract already approved. |
| [#1243](https://github.com/rynfar/meridian/pull/1243) | Defer submitted SQL implementation | Mutable authority, legacy retirement race and live-lease overwrite persist; automatic default migration conflicts with already approved opt-in/offline #1277. Depends on #1220. |
| [#1219](https://github.com/rynfar/meridian/pull/1219) | Defer corrected implementation | Approved opt-in SQL contract exists; immutable custody/admission/native recovery/shutdown and source/installed acceptance still incomplete. |
| [#1261](https://github.com/rynfar/meridian/pull/1261) | Defer unsafe sweep | Rebased core sweep/retention blobs remain identical to previously rejected ownership/deletion implementation; actual native-history and joined lifecycle proof missing. |
| [#1314](https://github.com/rynfar/meridian/pull/1314), [#1340](https://github.com/rynfar/meridian/pull/1340) | Defer demonstrated evidence gaps | Existing duplicate-write proof still fails or submitted gate passes unchanged baseline. Require discriminating actual-model proof and legitimate repeated-read control. |
| [#1317](https://github.com/rynfar/meridian/pull/1317), [#1322](https://github.com/rynfar/meridian/pull/1322) | Obsolete integration drafts; never squash | Carry source contributions under withdrawn process; attribution checks fail. Preserve useful evidence, move necessary changes onto original source PRs. No silent closures. |
| [#1266](https://github.com/rynfar/meridian/pull/1266), [#1347](https://github.com/rynfar/meridian/pull/1347), [#1359](https://github.com/rynfar/meridian/pull/1359) | Retain existing draft/environment holds | Exact macOS/nono diagnostics, qualified account-routing, or native Windows installed lifecycle evidence respectively. No account/paid-usage changes inferred. |
| [#1193](https://github.com/rynfar/meridian/pull/1193) | Retain owner hold | Prompt warming/background-call contract and real benefit/foreground priority/cancellation proof needed; no warming started. |
| [#1402](https://github.com/rynfar/meridian/pull/1402) | Respect explicit no-review request | Contributor wants to test/review privately first. No code review started; wait for ready/review request. |
| [#1408](https://github.com/rynfar/meridian/pull/1408) | Retain draft/contract/live holds | New Pi attestation/health/environment contract needs tracked approval; no successful live generation/tool/cache/priority failback proof. |
| [#1050](https://github.com/rynfar/meridian/pull/1050) | Historical research draft | Antigravity production work has advanced independently; no review-ready request and no reason to land research draft. |
| [OpenCode scrub #20](https://github.com/rynfar/meridian-plugin-opencode-scrub/pull/20), [Pi scrub #15](https://github.com/rynfar/meridian-plugin-pi-scrub/pull/15) | Defer releases | No release authorization; both candidate heads have no checks/statuses. Fresh release/installed-package gates remain, despite historical main evidence. |

Exact original heads, individual findings and revisit conditions are in
[older PRs](older-prs.md), [storage](storage.md), [session/routing](session-routing.md),
[passthrough](passthrough.md), [stream/PDF](stream-and-pdf.md), and
[scrub queues](scrub-queues.md). These record the review-stage heads; completed
correction/verification results below supersede their initial status.

## #1409 — independent proof and review

Source head `9ff41a427da3a67e207e3d83121cefa552b659a0`, Nowaker
(`spam@nowaker.net`), signed; base exactly the reviewed main. Eight applicable
CI checks succeeded, including [test](https://github.com/rynfar/meridian/actions/runs/39180208214/job/117831154161),
Windows smoke, desktop macOS/Linux, Nix and Docker; changelog duplication skipped.
Recheck head/base/checks before any merge.

Product fit: contains disposable test fixtures and explicitly inherited child
environments under an owned process temp directory. No runtime behavior or model
call changes. Independent full-diff review found no material safety issue:
ESRCH-only stale-owner detection, current/live-owner exclusion, foreign names,
symlinks and invalid PIDs remain protected. Every query/test process retains its
own directory, and existing once-per-run afterAll cleanup remains authoritative.
Windows TMP/TEMP and path joins are preserved. A Bun child with omitted env may
inherit startup env rather than the updated process.env on old Bun; the PR
discloses this limitation. No new production/public contract/dependency change.

Local platform: Darwin arm64, Node 22.22.3, Bun 1.3.14, frozen lockfile SDK 0.2.141
and Claude Code 2.1.296. Focused command:

```sh
bun test src/__tests__/preload-tmp-cleanup.test.ts src/__tests__/quiet-telemetry-banner.test.ts src/__tests__/polytoken-feature-defaults.test.ts
```

Result: **21 pass / 0 fail**, including passing/failing/timed-out/killed runs,
live owner preservation, child fixture cleanup and malformed-path safety.
Standalone `npm run typecheck` and `npm run build` both exit 0.

A single identical generated Bun fixture ran with a copy of unchanged main's
preload/helper and then with the candidate preload. It creates a fixture and an
explicit-env child fixture, asserts tmpdir is the process-owned directory, then
checks leftovers after process exit:

```json
{"label":"before","exit":1,"leftovers":["leaked-child-<id>","leaked-fixture-<id>"]}
{"label":"after","exit":0,"leftovers":[]}
```

The [normalized before/after receipt](1409-before-after.jsonl) and committed
regression test above independently retain this assertion.
This is test-infrastructure E2E, not a claim of model/client behavior proof.

**Full local gate remains under investigation.** Initial `npm test` under host Bun 1.3.14 exited 1 after its main stage:
6,472 pass / 36 skip / 4 fail (6,512 tests, 382 files, 683.56 seconds).
The chained isolated stages did not run after the failure. Failures: a race fixture read an existing but not-yet-written result as empty;
a Node child close test timed out; an optional Git timing-budget assertion
failed under load; and an uncooperative SDK fixture writer cleanup assertion
failed. The race/Node files pass **8/8 with 2 platform skips** on both
unchanged main and candidate when isolated. Isolated success is not proof of
causality or a green full gate. The complete unchanged-main comparison finished
with one failure, as did the pinned candidate run; see the runner-qualification
section below. CI job logs confirm
Bun 1.3.11 (`af24e281`), matching packageManager; the host defaults to 1.3.14.
This version comparison does not by itself establish the cause of the
1.3.14 failures; all failures are retained rather than dismissed by a green rerun.

## Corrections verified at the code/protocol level

**#1410:** maintainer correction `423477f19812b08e15d332d4f7c9c91ebf4e8650`
was pushed onto Nowaker's original branch. Only the shared digest and necessary
real-SDK regression tests changed. Both new root/nested cases fail before the
source correction (3 existing controls pass, 2 new cases fail). Afterward,
64 focused tests across eight files, typecheck and build pass. Independent
[correction review](1410-correction-review.md) finds the prior P2 resolved.
The exact credential-free [SDK catalog probe](sdk-order-probe.mjs) and
[red](sdk-order-red.json)/[green](sdk-order-green.json) records are escrowed here.
The copied probe was run again against `423477f1` and exited 0.

```sh
bun docs/maintenance/evidence/backlog-20261018/sdk-order-probe.mjs /path/to/meridian-pr1410-checkout
```

It exercises root/nested maps in both population orders, identical-clone reuse,
independent transports, tool calls, survivor access after closing siblings and
input immutability. Zero model calls. Full `npm test` also exits 0: **6,948 pass / 36 skip / 0 fail** across
24 isolated stages. All eight exact-head CI checks pass at `423477f1`, including
[test run 39202398097](https://github.com/rynfar/meridian/actions/runs/39202398097).
The follow-up bounded heap/catalog proof and actual matching-plugin OpenCode
read/continuation pass; E41 model qualification failed and other live gates remain
open. See [live follow-up](live-verification.md) for exact scope and limitations.
[Complete validation](1410-validation.md) and [test totals](1410-test-summary.json)
retain the executable checks and source/final identities.

**#1396:** signed corrections `db52bfd0187d9b61e3627f71059564f27e71b2cb`
and `a40be1795a1b8dbcdeccfe8525b972c17609ff73` preserve unknown durable tails
and require exact observed-reminder coverage in the existing client gate.
Independent [correction review](1396-correction-review.md) finds the P1 resolved.
New edited-tail HTTP variants fail on the unmodified adapter and require fresh
replay with the new instruction after correction; unchanged tails retain resume.
20 focused cases and 33 pure/recovery cases pass, as do typecheck/build.
The real installed client/SDK scripted gate witnesses five reminder-bearing
requests and four exact reminder disappearances. Opus-with-no-reminder fails
by default and passes only as an explicitly labeled negative control.
These are loopback scripted-provider runs, **not actual Fable model calls**.
Both corrections are pushed. Full `npm test` exits 0: **6,961 pass / 36 skip /
0 fail**; all eight applicable corrected-head CI checks pass, including
[test](https://github.com/rynfar/meridian/actions/runs/39203482443/job/117901207992).
Live affected-model acceptance remains open. Actual native traffic now witnesses
prefix-plus-reminder disappearance and preserved continuations, but mixed model
identities, cache failures and missing controls remain. Reminder-only traffic
has not been observed. See [live follow-up](live-verification.md). Existing
committed tests and `scripts/e2e-claude-code-system-turns.mjs` retain the probes.
[Complete validation](1396-validation.md) and [test totals](1396-test-summary.json)
preserve exact scripted-client controls and the red-before-fix record.

## #1411 correction and browser acceptance

Parent pushed signed correction `bd08c43d9139913ad52cd172690aa0b8cec707f7`
to Nowaker's original branch after source/focused/browser/typecheck/build
verification. The worker deliberately held its own push because the complete
suite was red; the parent publishes the reviewed correction to start CI, **not
as acceptance or a merge-gate waiver**. The contributor's PR summary now states
the explicit-empty behavior and retained red local gate. No source history was
rewritten and no contributor work was moved into this evidence branch.

Added regressions fail before the correction (47 pass / 3 fail) and pass afterward
(50 pass / 0 fail, 198 assertions). Empty `provider` means select none; nonempty
unknown-only/whitespace values still fall back to the saved preference.
Independent [correction review](1411-correction-review.md) finds the reload defect
resolved. Typecheck/build pass; no style/layout/model/API contract changes.

Actual T3 Chromium 154 on macOS, 1280×800, drove production page modules against
safe read-only synthetic account responses. Both pages reproduce baseline
all-hidden → reload → visible, then retain all-hidden on the corrected build.
Show all, actual history back/forward/popstate, unknown/plain URL fallback,
profile-anchor reveal and ordinary saved-preference clicks behave correctly.
The [fixture](provider-filter-fixture.ts), [DOM receipts](browser-receipts.json)
and [additional controls](browser-additional-controls.json) are escrowed here.
Owned fixture servers/tabs were closed. Synthetic screenshots were inspected;
PR-only media are retained in the local evidence transfer rather than committed
to source. Deterministic DOM receipts and the runnable production-page fixture
are the durable proof.

```sh
bun docs/maintenance/evidence/backlog-20261018/provider-filter-fixture.ts /path/to/source-head 42241 baseline
bun docs/maintenance/evidence/backlog-20261018/provider-filter-fixture.ts /path/to/bd08c43d-checkout 42242 candidate
```

Full local `npm test` under Bun 1.3.11: **6,398 pass / 36 skip / 90 fail**
(6,524 tests, 382 files, 600.50 seconds), exit 1; chained stages did not execute.
The first proxy test entered persistent “Claude auth-status process cleanup is
unconfirmed” refusal; subsequent SDK-admission failures cascaded across unrelated
files. A watchdog case and a cross-process Pi case also failed. Isolated original
source controls with both installed and reconstructed placeholder launchers
passed; therefore neither dependency repair nor a later isolated green run
establishes a cause or repair. Full-suite shared state, host contention and
installation/timing remain hypotheses, not proven excuses. All eight corrected-head CI checks subsequently pass at `bd08c43d`, but this
unresolved local gate remains required before merge.

## #1398 actual startup validation

At unchanged head `e87a79446cc8d8fe170fdc71ffefdd32c7a24c32`, four warning tests,
typecheck/build and nine credential-isolated real CLI cases pass: source and
built Bun warn exactly once on stderr; Node, silent mode, help and version do
not; liveness/inflight responses remain clean. Installed Node/Bun HTTP and Hono
transport controls corroborate the missed pre-byte disconnect on Bun 1.3.14
versus Node 22.22.3. No generation or owner credentials were used; startup-warning
acceptance is distinct from fixing underlying model cancellation.

[Complete validation and failure record](1398-validation.md),
[CLI receipts](1398-cli-results.json), and
[transport receipts](1398-disconnect-results.json) preserve the executed controls.

Full local main stage: **6,467 pass / 36 skip / 4 fail** (6,507 tests,
755.08 seconds), exit 1. Three profile-list API cases timed out; one cross-process
streamed modified-history case failed. Isolated candidate/main controls pass but
do not establish full-suite causality. An auxiliary tail controller was stopped after 13 completed segments
(191 pass / 85 fail) because its credential-isolation sandbox blocked a native
process-identity prerequisite. Those results do not establish complete tail
coverage and do not turn the original red `npm test` run green. No product
correction was needed or pushed. Eight source-head CI checks are green, but
local failure and primary-Author handling remain open merge gates.

## Main comparison and runner qualification

The complete unchanged-main Bun 1.3.14 comparison also exits 1: **6,474 pass /
36 skip / 1 fail**, 6,511 tests, 382 files, 604.07 seconds. Its failure is
cross-process turn coordinator “repeatedly adopts dead recovery claims and
cleans resolved tombstones”. This proves local main is not green; it does not
explain the different candidate failures. #1409's explicitly pinned Bun 1.3.11
run exits 1: **6,475 pass / 36 skip / 1 fail**, 6,512 tests, 382 files,
564.97 seconds. Its TERM-resistant Git control reports `status:null` instead
of 0. Chained stages did not run. This remains an unresolved red gate; no
repeated green rerun is substituted for explanation.

## Forwarded-source attribution

PRs #1394–#1401 were opened by `passabilities` and include verified commits by
`eamonster27`, a different account, plus the opener's corrections. No original
source-author PR exists in Meridian. Squashing the forwarded PRs gives the
opener primary authorship, contrary to the current source-Author rule. The owner explicitly prioritized true Author credit and avoiding the earlier
cherry-pick failure. The approved route is a narrowly documented normal merge
of these existing forwarded PRs, retaining every current author commit unchanged;
it is a bounded exception to the current squash default. On 2026-10-18 MDT /
2026-10-19 UTC the owner explicitly selected **“Approve the commit-preserving
route (recommended)”** for #1394–#1401, retaining all tests, live verification,
CI and signature requirements. The independently reviewed workflow change is
[#1413](https://github.com/rynfar/meridian/pull/1413), head `15f35f173d70d11c111da92081855bc36082ab0c`.
It merged as `f81d9d8dbc7ff0cd4faf2c48197b46f829921b77` at 2026-10-19
05:31:34 UTC after final-head CI passed, using the ordinary signed squash for
this maintainer-authored instruction PR. The signed landed tree exactly matches
the reviewed tree; [merge verification](policy-merge.json) records the base,
head, checks, signature and tree. The forwarded route itself preserves commits
with `--merge`. This authorization does not waive any product gate or authorize cherry-picking,
history rewriting, source PR closure, release publication or external comments.
The [complete credit audit](forwarded-credit-audit.md) and
[58-commit manifest](forwarded-credit-manifest.json) preserve exact current
Authors, dates, signature identities, earlier source mappings and adaptation
comparisons. In that historical snapshot, fourteen commits are authored by
eamonster27, 42 by passabilities and two by rynfar; its signatures are valid.
The [60-commit addendum](forwarded-credit-1399-addendum.md) retains all 58 and
adds two signed #1399 corrections. The [61-commit addendum](forwarded-credit-1400-addendum.md)
adds only #1400's signed correction and qualifies commit-rollup CI scope.
All 14 earlier source identities
and dates match their forwarded copies, including timezone, but original SHAs
and port/carve contents differ. A normal merge preserves the current objects;
it does not retroactively restore earlier objects or source-author signatures.
The manifest SHA-256 is
`a12ec7becafc2a90f1e7ebca2d25277cac9af88684d6aa9d81c3460aa6f5938a`.
The existing attribution tool conflates mixed-source emails under the opener;
its aggregate is not used as credit proof. The approved route requires per-commit
ancestry/Author verification and a truthful report instead.
No forwarded product PR has merged. Their remaining product gates must complete
before landing; the manifest must be refreshed against
the exact source head and current main before each merge.

The post-merge queue refresh found no additional Meridian PR. Drafts #1359 and
#1347 have advanced to `694df9fd46f484ba60458df4338ddb767b4646d2` and
`3103a6efe8408d52dc3b75b27915c9d079c72797`; the earlier reports are historical
review snapshots, not reviews of these new heads. Their existing draft and
platform/account acceptance holds remain.

## Live verification and remaining work

Two isolated follow-up tasks completed at `a40be179` and `423477f1`.
[Their retained evidence and failed/missing gates](live-verification.md) distinguish
bounded heap/catalog and client-flow success from incomplete acceptance. Both
observed mixed SDK model identities, and #1396 also failed cache floors.
Further inference stopped. No paid Extra Usage or changes to the owner's
accounts/configuration were used to obtain a passing result; fixtures used
isolated configurations.

#1399's active-sweep shutdown correction is now pushed and independently reviewed;
full-local and actual-model load gates remain open. Follow-up work on the
mocked-SDK test boundary is pending. #1400's signed Retry-After correction is now
pushed with [focused evidence and retained gates](retry-after-correction.md).
See the [shutdown follow-up](shutdown-and-resolver-followup.md) for those earlier results.

The [independent evidence review](evidence-review.md) and
[follow-up](evidence-review-addendum.md) cover the current record. The follow-up
resolves the stale #1409 status and verifies that bounded owner approval retains
all product gates. These are document reviews, not repeated test/model runs.

## Remaining operational gates

Actual OpenCode/Claude work always requires the matching Meridian client plugin,
mandatory E2E preflight, effective config and runtime load/route witnesses.
Mocks/loopback fixtures are distinguished from actual-model/client acceptance.
No paid Extra Usage, warmers, releases, external comments or destructive history
changes are authorized by this batch. Required exact-head CI is never bypassed
for code/evidence failures. The narrowly documented unsigned-commit exception
can only be considered after all other gates pass.
