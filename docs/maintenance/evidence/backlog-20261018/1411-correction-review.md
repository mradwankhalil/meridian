# Independent #1411 correction review

**Disposition: accept the scoped correction at `bd08c43d9139913ad52cd172690aa0b8cec707f7`; no material source, test or UX finding remains from this read-only pass.** Merge acceptance still requires the implementation lane's final local checks, actual-browser proof and final-head CI, followed by current head/base/mergeability recheck. This review does not claim those gates ran.

Reviewed worktree `/Volumes/DevSSD/meridian/t3-worktrees/t3-17f2168b`, clean at the inspected head. Exact parent/contributor source: `4036dd9b3636e1e550623e2b28b4f7c2e9bed0c4`. Complete correction diff: three files, one production behavior line plus comments and 73 lines of test changes. Full original five-file PR diff had been reviewed in the preceding round, with the all-off reload defect reproduced against the source JS. No edits, test execution, browser work, GitHub messages or model calls in this review. `git diff --check 4036dd9b..bd08c43d9` passes.

## Original objection resolved

`profileFilterUrl.ts:36` now distinguishes the exact empty serialized selection from absent/unrecognized values: `raw === ''` returns `[]`. The caller already distinguishes null from an array (`profileProviders.ts:205–208`), so an empty array sets URL custody and hides every provider rather than reading localStorage. The existing writer emits `provider=` for an empty set; read and write now round-trip.

This covers both bare `?provider` and `?provider=` because URLSearchParams reads both as an empty string. A nonempty unknown-only value still returns null, preserving saved-preference fallback. Whitespace-only and comma-only values remain unknown nonempty values; focused tests explicitly record that choice. Comments in both modules now state the new empty-selection rule instead of promising fallback for every unrecognized value.

## Regressions are meaningful

The added parameterized page scenario executes the actual embedded landing and profiles scripts, registers and dispatches their real root click listeners, and observes real `hidden` state changes over supplied cards. It does not substitute a copy of the filter algorithm.

For **each page**, the test:

- Starts on a URL-selected single provider while saved preferences have the other provider hidden.
- Dispatches the last active chip through the page's existing root handler and asserts every card hidden plus `provider=` in the address.
- Constructs a new page/script lifetime at that address and asserts cards remain hidden. Restoring the old parser would instead show ChatGPT from saved storage, so the central assertion is discriminating.
- Dispatches Show all and asserts both cards visible plus the nonempty URL selection.
- Changes location then dispatches only `popstate` for all-hidden → plain → all-hidden; directly observes card state. Removing either page's location listener/apply call would fail that page's history assertions.
- Asserts zero localStorage writes throughout and the unchanged remembered JSON; a new plain visit still restores the remembered view.
- Preserves an unrelated query key during the whole cycle. The profiles case also asserts the existing all-hidden empty state is shown.

The prior positive controls remain: normal single/list selection, unknown/prototype-like tokens, missing parameters, plain chip preference persistence, URL click rewriting without storage writes, unrelated query/hash preservation, and hidden-provider profile-anchor reveal. No existing useful assertions were weakened to make the correction pass. The deliberate former `provider=` fallback assertion was replaced by the newly requested empty-selection contract, with separate invalid/nonempty fallback cases retained.

The document stubs are suitable focused state controls; actual browser click targeting, DOM and history behavior remain the independent implementation lane's stated proof gate.

## Product fit and boundaries

The all-hidden state already exists in Meridian's provider UI with a Show all recovery action. Giving that existing state a stable empty URL representation fits the permalink feature and avoids silently changing saved preferences. Existing single-provider visibility policy, native buttons/ARIA, shared chrome, styling, anchor precedence and foreground account actions are unchanged.

The correction remains browser-local query state for `/` and `/profiles`; no `/profiles/list` or active-profile HTTP contract, health payload, headers, exported proxy config/lifecycle or public plugin contract changes. No separate API issue or owner approval appears required. The contributor's original PR should merge with the maintainer correction as a separate commit, per the repository attribution workflow.
