# Forwarded credit addendum: PR #1400

Read-only snapshot at **2026-10-19T06:16:39.625151+00:00** against current main `da8187ab4553e4fd2120aa0098b2a81b197502dc`. Credit preservation passes this bounded audit: the previous **60** introduced commits remain unchanged, and #1400 adds exactly one signed maintainer correction, for **61** unique introduced commits. No source PR was merged and product acceptance is not established.

## New correction and original source preservation

- New SHA: `cf399a7db7db59aa6d8f4596c3eb30d610a60a74`; sole parent `9451a72aa48127ddd6106bedb48ecdb98e03f04d`.
- Subject: `fix: derive pool retry waits from effective benches`.
- Author and Committer: Trevor Walker <rynfar@gmail.com>, mapped by GitHub to `rynfar`.
- AuthorDate and CommitterDate: `2026-10-19T00:09:53-06:00` (`2026-10-19T06:09:53Z`).
- GitHub REST: `verified=true`, `reason=valid`; GraphQL: `isValid=true`, `state=VALID`, signer `rynfar`, signature email `rynfar@gmail.com`, not signed by GitHub. Local SSH signature header is present. An independent local check found a cryptographically good ED25519 signature, fingerprint `SHA256:MIQlVgbMwpydbVe4w7eML0WlJNdddjg/BCl2+2v4GSs`; local principal trust is unverified because no allowed-signers file is configured. This local limitation does not replace GitHub's separate verification.

Local ancestry proves the original head is an ancestor of the new head and `original..new` contains only this correction. The final PR commit connection and fresh-main compare contain the same original seven objects followed by the correction. Each original object's SHA, actual Author/email/AuthorDate, Committer/email/date, parents, GitHub author/committer login mapping and signature identity match both earlier snapshots. Exact local dates with original timezone offsets are recorded per commit in the JSON:

- `29fd486ff91ab8bc04f670d7ea19bd1ac5c8ca47`
- `34e7e52136f8a3107ddc0c1eaaf158465008fc1f`
- `851d1592a3fb01164b2adea4f9f7e7bf146781a5`
- `4342d0b3d4094015bf252fee2fdf4f83803e77f6`
- `21cec7b5cd1e6cc56dfa8ce478718c0926a92c72`
- `a2ac4cd94b47c723d7e254ca4e162492ba99e3e0`
- `9451a72aa48127ddd6106bedb48ecdb98e03f04d`

This proves preservation of the existing forwarded objects. Those objects were already copied by the forwarding contributor; retaining them does not restore earlier source SHAs, parents or signatures. The historical58 manifest retains the earlier source-object/patch comparison; this addendum did not repeat that broader audit. Credit is checked through actual per-commit Authors, independently of the PR opener.

## Bounded current batch

Only #1400's head changed since the previous60 snapshot. All eight PRs remain OPEN and non-draft. GitHub PR commit connections used `first:100`; every returned count equals its total and every `hasNextPage` is false. Each was independently compared with a complete GitHub `compare(main...head)?per_page=100` list; all eight sets and order match.

| PR | Exact current head | Introduced commits | Merge state at snapshot |
|---|---|---:|---|
| #1394 | `8dad6d4a89a17c5d18b47ab00f1a65be039578d9` | 6 | CLEAN |
| #1395 | `6cd3e6f292d060b620efd3f1417b544bbfe5fb6c` | 5 | CLEAN |
| #1396 | `a40be1795a1b8dbcdeccfe8525b972c17609ff73` | 10 | CLEAN |
| #1397 | `5617da1f52d2c8c1c970b574d6302ccb648de160` | 8 | CLEAN |
| #1398 | `e87a79446cc8d8fe170fdc71ffefdd32c7a24c32` | 5 | CLEAN |
| #1399 | `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811` | 9 | CLEAN |
| #1400 | `cf399a7db7db59aa6d8f4596c3eb30d610a60a74` | 8 | UNSTABLE |
| #1401 | `356eeb0b536d8e3859e8a6f5e5bd1a58d674f8ec` | 10 | CLEAN |

The 61-commit union has 14 commits authored by `eamonster27`, 42 by `passabilities`, and five by `rynfar`. All 61 GitHub signatures are VALID: 56 signed by `passabilities`, five by `rynfar`. All historical58 and previous60 commit identities/parents/signature mappings are unchanged; no object disappeared.

Local `origin/main` equals the fresh remote snapshot main. Local `rev-list head --not main` exactly matches GitHub for #1396, #1398, #1399 and #1400. The local database lacks the #1394, #1395, #1397 and #1401 head objects, so those four local ancestry checks are incomplete. No fetch or checkout change was performed. The full fresh local all-eight cross-check remains a premerge gate.

## CI scope correction and remaining gates

The stored `headRef.target.statusCheckRollup` values, including the historical60 snapshot's SUCCESS values, are **not proof that required target-repository CI/test passed**. For this #1400 snapshot, that SUCCESS contains only a Nix check in `passabilities/meridian`. The old60 snapshot is retained byte-for-byte; this addendum corrects its interpretation.

Actual `gh pr checks 1400 --repo rynfar/meridian` at `2026-10-19T06:17:33.942226+00:00` separately reports the required target-repository `test` **IN_PROGRESS**. CI run [39208367317](https://github.com/rynfar/meridian/actions/runs/39208367317) independently has `head_sha=cf399a7db7db59aa6d8f4596c3eb30d610a60a74` and `status=in_progress`; seven other checks pass and changelog-duplication is skipped. #1400's merge state was UNSTABLE. These are bounded observations; no wait or continued CI polling was performed.

The correction handoff reports the full local suite pending and affected actual model/client/platform live gates open. This credit audit runs no tests, builds, model requests or access diagnostics, and does not override those gates. Immediately before eventual integration, refresh main/head, complete local/GitHub introduced sets, all signatures, protection, mergeability, actual target-PR contexts and required `test`, and the reviewed combined tree. The owner-approved #1413 commit-preserving route and all ordinary gates remain mandatory; no admin bypass is authorized.

## Preserved snapshots and publication custody

- Historical58 manifest SHA256 remains `a12ec7becafc2a90f1e7ebca2d25277cac9af88684d6aa9d81c3460aa6f5938a`.
- Previous60 addendum SHA256 remains `9efec62f4c7395b100d55c0e35e878c50d962affaff8e5f1f72b6f891f85801a`.
- This new JSON manifest SHA256: `a25fee1c66c4ae0ce99fffdec13451970f8e5a4fb87edc2bab3b90c935a99a76`.

The new files are `/tmp/meridian-forwarded-credit-1400-addendum.md` and `.json`; supporting bounded public metadata is `/tmp/meridian-forwarded-credit-1400-data/`. They contain public commit identities and sanitized audit facts, with no runtime account configuration or private transcripts. Parent owns durable escrow in the separate evidence follow-up; temporary files alone are not durable publication. No GitHub write, source edit, merge, comment or release occurred here.
