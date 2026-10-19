# #1400 effective Retry-After correction

Signed additive commit `cf399a7db7db59aa6d8f4596c3eb30d610a60a74` directly
extends original `9451a72aa48127ddd6106bedb48ecdb98e03f04d` on the contributor's
`dex/model-allowance-failover` branch. All seven earlier commits remain unchanged.
GitHub verifies the new Trevor Walker Author/Committer signature; no product
merge, replacement PR or rewritten history is claimed.
The [fresh credit addendum](forwarded-credit-1400-addendum.md) and
[JSON snapshot](forwarded-credit-1400-addendum.json) retain all previous 60
objects and add only this correction: 61 introduced commits, with 14 eamonster27,
42 passabilities and five rynfar Authors. All 61 signatures were valid. The
snapshot's JSON SHA-256 is
`a25fee1c66c4ae0ce99fffdec13451970f8e5a4fb87edc2bab3b90c935a99a76`.
Four local head-object sets remain missing; complete local/GitHub ancestry and
signature verification must be refreshed before any product merge.

The terminal JSON/SSE wait now uses each relevant account's effective exclusion
(the later account/model deadline), then the earliest across that actual pool.
It no longer seeds the calculation with a shorter attempted mark. Retained
continuations use only their retained account. If a relevant member has reopened
during later attempts, the existing 60-second fallback applies. Monotone marks,
model-local scope, ordering and exposure/cancellation barriers remain.

The [correction report](1400-correction/result.md),
[independent review](1400-correction/adversarial-review.md) and
[artifact hashes](1400-correction/SHA256SUMS) retain exact sources and controls.
The [publication review](1400-publication-review.md) and
[safety review](1400-publication-safety-review.md) found no credential/customer
content blocker. The [final synthesis review](1400-final-synthesis-review.md)
checks the summary, per-commit credit and later target-CI receipt. This publication preserves the complete small transfer, with
all 41 source hashes unchanged, including the disclosed initial control.
Archived patches retain their space-prefixed context lines; test logs retain
original source excerpts, CRLF test strings and typecheck footer blank lines.
These produce archive-only whitespace diagnostics. Authored prose is checked
separately; historical evidence bytes are preserved.
The reviewer found and resolved the reopened-account case in the first correction;
its separate intermediate red evidence is retained rather than described as an
original-source failure.

Verified Bun **1.3.11** results:

- Original source: six repeated/overlap failures, two refinement failures and
  two retained-account failures; ordinary first-mark controls pass. The pure
  source probe reports **600,000 ms versus effective 10,800,000 ms**.
- Final source: **54 active-pool tests + 2 retained tests + 362 leaf tests =
  418 pass**. Fourteen JSON/SSE regressions cover repeated shorter marks,
  opposite account/model overlap, completed asynchronous refinement, expiry and
  retained scope. The source probe reports **10,800,000 ms for both values**.
- Typecheck/build pass. This round did not run the full priority-routing file
  or full `npm test`; the separate infrastructure task owns the heavy suite.
  Final-head CI was still pending at the credit-audit snapshot; the later
  [target-CI receipt](1400-target-ci-snapshot.json) records all eight target
  checks passing, including `test`, plus the skipped changelog check. The run
  and PR contexts both match `cf399a7d`. Receipt SHA-256:
  `b51bc1d2f9060dcce4c0437036ac64176c4cb665dabec836478d871f4c563f53`.

The new credit audit also corrects CI interpretation: a commit object's
`headRef.target.statusCheckRollup` SUCCESS can contain only the fork's Nix build.
Historical snapshot values do not prove the target PR's required test passed.
The actual target CI run 39208367317 was independently matched to `cf399a7d`
and still running at that audit; the later receipt records its success.
Inspect target PR contexts and exact heads,
including `test`, rather than accepting an aggregate commit rollup.

The initial SDK-mocked baseline control unexpectedly invoked real native
auth-status probes for synthetic work/personal profiles and could reach the
credential-store boundary. It generated no real model request, but it is not
claimed as credential/native-isolated proof. Its original log remains visible.
All later HTTP checks use the retained external fixture, which mocks auth,
executable and credential-store boundaries and traps native/external-network
attempts. Guarded receipts record zero such attempts. This external fixture is
evidence only; the shared repository fixture implementation remains separate.

The [replay wrapper](1400-correction/replay.mjs) was syntax-checked only and is
not another executed acceptance run. It adapts the archived local source path
into a selected checkout and requires Bun 1.3.11. Use a scratch copy/output area
and inspect its prerequisites before running; preserve historical hashes.

Full local validation must follow the shared SDK-mock infrastructure work.
Naturally spent Fable allowance with another account's capacity, whole-pool
spent behavior, delayed post-heartbeat refusal, actual Claude Code main/Fable
subagent and Linux acceptance remain open. No quota-spending load or paid usage
was enabled. Existing account-global diagnosis can still cross-label concurrent
scopes; the retry-timing correction does not provide attempt-bound diagnosis.
Refresh full Author/signature/local-ancestry and exact-head gates before landing.
