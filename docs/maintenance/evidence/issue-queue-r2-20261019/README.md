# Renewed issue queue: correction custody and acceptance limits

The owner requested more issue work after release 1.84.0 and deferred Mac
notarization. Six managed public queues were refreshed without a coverage gap.
This is a maintainer checkpoint; it does not grant product acceptance or replace
the full signature/introduced-commit audit required before a forwarded merge.

## Account-copy read failures, PR 1401

The contributor guard treated an unreadable other-account mapping as missing.
Two direct fault controls fail before the correction: one unreadable copy and a
later read error after a valid newer copy was already found. The fix uses the
existing fail-closed session-store error path before SDK execution.

- [Before: seven passes, two failures](account-copy-read-errors-before.txt).
- [After: thirteen passes, including existing mocked HTTP controls](account-copy-read-errors-after.txt).
- [Ten original authored objects retained unchanged](account-copy-retained-source.json).

The clean main merge is `07f4fe9ed23070fbb5dc23ec40323975b3d8f5b3` and the
signed correction is `32483870992ce3f953322cf6c1bf9bbdaede2469`, pushed to the
existing source fork's `dex/stale-copy-guard` branch. No source object was
rebased, cherry-picked, rewritten or claimed as landed. The source manifest is
custody evidence rather than a completed forwarded-merge qualification.

At that correction the pinned complete 24-invocation local gate passed
**6,995 / 36 skip / 0 fail**, plus standalone typecheck/build. Exact-head CI run
[39289578058](https://github.com/rynfar/meridian/actions/runs/39289578058) failed
with the independently reproduced logger counts **[0, 1, 1]**. PR 1425 preserves
that cause and its correction; signed main merge `1c2bd51dd940c082cdcfc85bdea31671edb650b0` now integrates
that repair. Its parents are the reviewed correction `3248387099` and main
`3feb772479`. All ten original authored objects were rechecked unchanged. Fresh
25-invocation local and final-head CI results are recorded in the source PR
body; standalone typecheck/build pass. The missing/evicted-map fallback and clock-based
comparison remain known limits. Actual E85 client/account/model proof, a durable
actual-client harness, all four E41 modes and prior model/cache holds remain.

## OpenCode primary-agent changes, draft PR 1423

The source and independently installed artifact proof are preserved at
[the immutable evidence commit](https://github.com/rynfar/meridian/blob/b904ee7153cac195f6549d1f777be6d73d124cf4/docs/maintenance/evidence/1404-opencode-agent-switch-20261019/README.md).
Actual supported OpenCode 2.0.21, matching V2 plugin, SDK 0.2.141, native
2.1.301 and Haiku 5.5 reproduce the old behavior and establish the new canary
transitions on Debian Linux arm64. This does not qualify the reporter's 2.0.31
setup, satisfy all E41 modes, resolve the separate Opus model/cache hold, or fix
same-agent instruction edits. Final-head CI at `b904ee7153` passed its active
jobs; a superseded duplicate Nix build was cancelled while the same context
also succeeded. Keep draft 1423 and issue 1404 open.

## Queue disposition

No issue is closed on partial proof. Existing contributor drafts, no-review
requests, source-author credit, public API/SQLite decisions, naturally exhausted
allowance tests, native platform and model/cache gates remain in force. Issue
1390 has a source-author fork branch but no open source-author PR; no code was
copied into a maintainer PR. A supported permission/classifier and client-denial
review is still needed. The two scrub release PRs remain held, and this task does
not authorize another release or Apple secret changes.

The [fixture-repair merge receipt](ci-fixture-merge.json) records the final local
25-invocation gate and reviewed/signed mainline tree for PR 1425. Its original
failed runs and negative controls remain in the adjacent logger evidence.

[Fresh paginated repository/queue counts](queue-refresh.json) include this open
documentation PR. No new issue appeared in the six managed queues.
