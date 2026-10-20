# Allowance-failover final local gate

Current head `2f17bf73d0b0974af229a9d1c8d12479bedcf8ec` is a signed,
conflict-free main merge with parents `cf399a7db7db59aa6d8f4596c3eb30d610a60a74`
and current product main `6c241a897bdc7ffe4c233d32270a17402b3528a0`.
The contributor's forwarding branch retains the original reviewed head and all
its authored ancestors unchanged. No source correction beyond the previously
reviewed effective Retry-After correction was added in this overnight refresh.
The owner-approved commit-preserving route remains required; refresh the full
introduced-commit/signature manifest before any future merge.

The [complete local gate](final-gate-summary.json) passes **7,059 tests / 36 skips /
0 failures**, all 24 isolated invocations on Bun **1.3.11+af24e281e**. Standalone
typecheck/build pass. [Exact-head CI](final-ci.json), including `test`, passes.
The earlier [418-case guarded correction proof](../../backlog-20261018/retry-after-correction.md)
retains its original/refinement failures, immutable source manifests and zero
native/network attempt controls. This new full pass does not establish the
cause of the original shared-SDK fixture failure elsewhere in the backlog.

The combined source was reviewed against current main: account/model marks
still only extend; effective exclusion is the later account/model deadline,
then the earliest across the actual eligible pool. Retained conversations use
only their retained account. Expired marks use the existing conservative wait.
JSON/header and SSE body waits agree; exposure, cancellation, same-turn identity
and commit/failback fences are retained. The additive `exhaustedModels` field
is on the existing in-memory dashboard `/profiles/health` route, not the stable
plugin `/profiles/list` or `/health` contract. Account-global diagnosis can still
cross-label concurrent scopes; this correction is not attempt-bound diagnosis.
No claim is made that current native refusal/model fallback is qualified here.

**Acceptance remains open:** naturally spent Fable allowance with capacity on
another account, whole-pool spent behavior, delayed post-heartbeat refusal,
actual native main/Fable-subagent routing and affected Linux proof. No quota
was deliberately exhausted and no paid overage was enabled. No additional real
model calls were made to complete these local gates. #1400 remains unmerged.
