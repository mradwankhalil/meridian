# Forwarded-credit addendum — #1399 additive corrections

Snapshot: `2026-10-19T05:48:13.836413+00:00`. Fresh remote main and existing local `origin/main` both resolve to `f81d9d8dbc7ff0cd4faf2c48197b46f829921b77` (adopted policy #1413). All eight PR heads were refreshed in one bounded GraphQL round; no source mutation, fetch, checkout edit, merge, test/model call, comment or release occurred.

**Credit audit PASS:** the introduced set is now **60 unique commits**, exactly the historical 58 plus the two #1399 corrections. All 58 original SHAs remain on the same eight current PR heads, with unchanged Author/AuthorDate, Committer/CommitterDate, parent lists, mapped GitHub logins and signature identities. #1399 is the only head that changed. No rebase, replacement or rewrite was found.

The historical manifest remains untouched at `/private/tmp/meridian-pr1409-20261018/docs/maintenance/evidence/backlog-20261018/forwarded-credit-manifest.json` with SHA-256 `a12ec7becafc2a90f1e7ebca2d25277cac9af88684d6aa9d81c3460aa6f5938a`. Its count remains correctly **58** for that earlier snapshot; this separate addendum records the new **60**-commit state.

| New #1399 commit | Actual Author / Committer | AuthorDate = CommitterDate | GitHub signature |
| --- | --- | --- | --- |
| `4644524c4905f364e995210fbcc2bb3e6952dbd4` | Trevor Walker `<rynfar@gmail.com>`; both mapped to `rynfar` | `2026-10-18T23:32:27-06:00` (`2026-10-19T05:32:27Z`) | `VALID`, signer `rynfar`, not GitHub-signed; SSH signature present locally |
| `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811` | Trevor Walker `<rynfar@gmail.com>`; both mapped to `rynfar` | `2026-10-18T23:32:27-06:00` (`2026-10-19T05:32:27Z`) | `VALID`, signer `rynfar`, not GitHub-signed; SSH signature present locally |

The exact parent chain is:

```text
a8fccdbdd9abe0f196168cf0a34a341caba1e1a5
  -> 4644524c4905f364e995210fbcc2bb3e6952dbd4
  -> 1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811
```

Local `git merge-base --is-ancestor` proves the old #1399 head is still an ancestor. Local `rev-list old..new` contains exactly those two commits, and local `rev-list new --not <fresh-main>` contains exactly the nine #1399 PR commits. The original seven source/forwarder commits are intact. Current totals are **14 eamonster27 + 42 passabilities + 4 rynfar Authors**; signatures are **56 passabilities + 4 rynfar**, all 60 GitHub-valid. The two new maintainer corrections retain their own proper Author credit and do not change the earlier source-author provenance.

All PR commit connections returned `hasNextPage:false`, with returned counts matching GitHub totals. I additionally compared every exact head to fixed fresh main through GitHub’s compare API; each complete introduced set matches its PR connection, and their union is exactly 60. Not all eight heads are present in the local object database, so an all-head local `rev-list` was unavailable; no fetch was performed. The local #1399 proof is complete, while the all-eight cross-check uses complete API comparison sets. Before any actual merge, satisfy the adopted policy’s fresh local ancestry cross-check as well.

| PR | Current head | Introduced commits | Snapshot state/check rollup |
| --- | --- | --- | --- |
| #1394 | `8dad6d4a89a17c5d18b47ab00f1a65be039578d9` | 6 | OPEN, CLEAN, SUCCESS |
| #1395 | `6cd3e6f292d060b620efd3f1417b544bbfe5fb6c` | 5 | OPEN, CLEAN, SUCCESS |
| #1396 | `a40be1795a1b8dbcdeccfe8525b972c17609ff73` | 10 | OPEN, CLEAN, SUCCESS |
| #1397 | `5617da1f52d2c8c1c970b574d6302ccb648de160` | 8 | OPEN, CLEAN, SUCCESS |
| #1398 | `e87a79446cc8d8fe170fdc71ffefdd32c7a24c32` | 5 | OPEN, CLEAN, SUCCESS |
| #1399 | `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811` | 9 | OPEN, CLEAN, SUCCESS |
| #1400 | `9451a72aa48127ddd6106bedb48ecdb98e03f04d` | 7 | OPEN, CLEAN, SUCCESS |
| #1401 | `356eeb0b536d8e3859e8a6f5e5bd1a58d674f8ec` | 10 | OPEN, CLEAN, SUCCESS |

**No product acceptance or merge approval.** #1399’s correction report retains its original local `npm test` failure (89 failing instances), although final-head CI is green, and the actual affected-client macOS hour-long throughput/admission/stop evidence is missing. Those gates remain open. The approved commit-preserving route changes attribution handling only; use the existing PR, keep every audited commit, and never bypass checks/protection or silently close shipped contributor work. Recheck main, head, full introduced sets, signatures, combined-tree behavior and final CI immediately before landing.

Machine-readable details, source snapshot and per-head comparison sets are preserved in `/tmp/meridian-forwarded-credit-1399-addendum.json`. Copy this addendum to separate durable evidence alongside the unchanged historical manifest; do not replace the historical 58-commit record.
