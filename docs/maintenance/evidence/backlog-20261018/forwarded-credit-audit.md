# Forwarded contributor credit audit: #1394–#1401

Snapshot completed 2026-10-19 05:17 UTC. Read-only GitHub REST/GraphQL and local commit inspection; no repository changes, GitHub writes, merges, tests, or historical attribution sweep. The JSON manifest contains every commit, identity, date, parent, signature verdict, source reference and patch comparison: [forwarded-credit-manifest.json](forwarded-credit-manifest.json). PR commit pagination was explicitly exhausted; all eight reported counts match all fetched pages (one page each, 5–10 commits). Source commit-file pages were also exhausted (1–13 files).

**Recommendation:** document a narrow exception for these existing forwarded, mixed-author PRs and use a normal merge of each accepted PR, pinned to its final verified head. This preserves the current source-author commits and forwarding/correction commits intact. It avoids a second authorship loss through squash, and avoids creating another maintainer integration PR or rewriting the forwarded history. The exception is still needed because current instructions require squash of a contributor’s own PR, whereas the source author here is not the PR opener. This audit does not itself change that policy or clear acceptance gates.

A normal merge retains the branch commits and adds a merge point; squash replaces them with one new base commit, and GitHub rebase-and-merge also creates new SHAs/committer metadata. [GitHub merge documentation](https://docs.github.com/en/pull-requests/reference/pull-request-merges).

## Verified current authorship and signatures

All eight PRs are opened by `passabilities`. Across their current heads there are **58 commits**: **14 authored by =DEX (`eamonster27`, `eamonbachari@gmail.com`)**, **42 authored by Noah Passalacqua (`passabilities`, `noah@passabilities.dev`)**, and **2 authored by Trevor Walker (`rynfar`, `rynfar@gmail.com`)**. GitHub maps each Author email to that stated account. All 58 current commit signatures are `VALID`: 56 are signed by `passabilities`, two by `rynfar`; none was signed by GitHub itself. Source Author and signer are separate identities.

| PR | Exact current head | Commits / Authors | Check snapshot |
| --- | --- | --- | --- |
| #1394 | `8dad6d4a89a17c5d18b47ab00f1a65be039578d9` | 6; eamonster27 1, passabilities 5 | SUCCESS; CLEAN |
| #1395 | `6cd3e6f292d060b620efd3f1417b544bbfe5fb6c` | 5; eamonster27 1, passabilities 4 | SUCCESS; CLEAN |
| #1396 | `a40be1795a1b8dbcdeccfe8525b972c17609ff73` | 10; eamonster27 3, passabilities 5, rynfar 2 | PENDING; UNSTABLE |
| #1397 | `5617da1f52d2c8c1c970b574d6302ccb648de160` | 8; eamonster27 2, passabilities 6 | SUCCESS; CLEAN |
| #1398 | `e87a79446cc8d8fe170fdc71ffefdd32c7a24c32` | 5; eamonster27 1, passabilities 4 | SUCCESS; CLEAN |
| #1399 | `a8fccdbdd9abe0f196168cf0a34a341caba1e1a5` | 7; eamonster27 1, passabilities 6 | SUCCESS; CLEAN |
| #1400 | `9451a72aa48127ddd6106bedb48ecdb98e03f04d` | 7; eamonster27 1, passabilities 6 | SUCCESS; CLEAN |
| #1401 | `356eeb0b536d8e3859e8a6f5e5bd1a58d674f8ec` | 10; eamonster27 4, passabilities 6 | SUCCESS; CLEAN |

#1396 includes the pushed maintainer corrections `db52bfd0187d9b61e3627f71059564f27e71b2cb` and `a40be1795a1b8dbcdeccfe8525b972c17609ff73`, both GitHub-verified with signer `rynfar`. Local `git verify-commit` could not authenticate their SSH signatures without an allowed-signers file; that local limitation is superseded for this snapshot by explicit GitHub `isValid:true/state:VALID` results, rather than being represented as local cryptographic verification. #1396 CI was still pending at the snapshot; the other seven had successful rollups.

## Original source objects and forwarding provenance

The 14 `cherry picked from commit` / `Carved from commit` references all resolve through GitHub’s `rynfar/meridian` commit API (shared fork-network objects). Every original has Author **and** Committer `=DEX <eamonbachari@gmail.com>`, GitHub account `eamonster27`, and **no signature** (`verified:false`, `reason:unsigned`). Every forwarded copy retains the original Author **name, email and timestamp exactly**, but uses a new SHA, new parent/context and Noah as Committer/signature signer. I additionally fetched all 28 original/copy git-format patch headers: the raw From and Date headers match for every pair, including the original timezone offset (for example #1394 is `Tue, 6 Oct 2026 17:18:34 -0500` in both objects). Therefore **zero** of these 14 are untouched original commit objects. These checks establish consistency with the published unsigned source-object metadata and patch provenance; they are not a cryptographic assertion that the source author signed or personally created those objects.

| PR | Forwarded commit → original source | Original AuthorDate (UTC) | Patch correspondence |
| --- | --- | --- | --- |
| #1394 | `496ef5f4fe` → `5afedf1045` | 2026-10-06T22:18:34Z | 4 code/test files have identical added/removed lines; E2E placement/heading changed. |
| #1395 | `57dbfb73e1` → `03f025a5a6` | 2026-10-06T03:59:05Z | All 6 files have identical added/removed lines; surrounding contexts differ. |
| #1396 | `7dcb2149c8` → `762f095542` | 2026-10-05T20:06:59Z | 4 code/test/harness files match added/removed lines; E2E adapted. |
| #1396 | `edd24f6a36` → `849ea02700` | 2026-10-05T20:45:15Z | Full stable patch ID equal (architecture docs); commit SHA still different. |
| #1396 | `b7a1504a1e` → `0e092fe8a4` | 2026-10-08T12:43:28Z | 4 code/test files match added/removed lines; E2E adapted. |
| #1397 | `759cf0c298` → `e836030083` | 2026-10-06T09:43:55Z | Server and cancel harness edit lines match; test adapted; 2 other source files omitted. |
| #1397 | `b22ea383f9` → `ca46feb25d` | 2026-10-06T09:45:41Z | Carved E87 documentation subset from a broader E2E change. |
| #1398 | `0341a48bed` → `38d43c0d6a` | 2026-10-06T11:07:38Z | 4 architecture/code/test files match edit lines; E2E adapted. |
| #1399 | `2d577070bf` → `3617ecaceb` | 2026-10-10T06:15:38Z | Ported to GC-specific leaf/tests and main’s 10-minute hold; source turnLimits/E2E omitted/adapted. |
| #1400 | `29fd486ff9` → `9cc451c435` | 2026-10-06T00:42:37Z | 9 files match edit lines; routing/server adapted to current dispatcher, docs/harness adjusted. |
| #1401 | `8c096b5928` → `835cbf192c` | 2026-10-06T08:23:02Z | Stale-copy guard subset: cache/lineage edit lines match; 8 carry-related source files omitted. |
| #1401 | `44a1343fcd` → `48f7825219` | 2026-10-06T09:14:50Z | Ranking/rewind guard subset; cache edit lines match; carry changes omitted. |
| #1401 | `b75bf73b16` → `0b9c8c4004` | 2026-10-06T10:53:20Z | Fingerprint stale-copy subset; source carry/E2E changes omitted/adapted. |
| #1401 | `8a53f0f8b7` → `8f6ec0f700` | 2026-10-06T11:04:46Z | Selected messagesHeld test work only; 6 other source files omitted. |

I downloaded all 28 complete source/copy unified diffs and compared `git patch-id --stable`, plus per-file added/removed line sequences. Only **1 of 14** full stable patch IDs is equal; patch-context changes alone can explain a different ID (notably #1395), so a mismatch is not automatically a different implementation. The manifest records exact matched/changed files and omitted source files for every pair. The broader source stack, especially transcript carry, is not silently included in the forwarded PRs.

## What normal merging can and cannot honestly claim

- It can preserve **these current 58 objects**, their actual Author/AuthorDate metadata, current Committer/CommitterDate metadata and current signatures, and make the existing forwarded PR show merged. =DEX’s 14 source-attributed commits become commits authored by =DEX on main, rather than mere coauthor trailers on someone else’s squash. Noah’s 42 adaptations/review corrections and Trevor’s 2 corrections likewise retain their own authors.
- It does **not** restore the original source SHAs, original parentage, or the unselected portions of carved commits. It does not turn Noah’s signature into =DEX’s signature. There are no original source signatures to restore: all 14 originals are unsigned.
- Appropriate wording is: “Merged the existing forwarded commits intact, preserving their recorded source Author and original AuthorDate; the forwarding commits have different SHAs and were signed by the forwarder.” Avoid “merged the untouched original commits,” “restored original signatures,” or “=DEX’s own PR was merged”: these PRs were opened by Noah.
- Keep the source/copy mapping and port/carve explanation durable. This does not authorize future maintainer cherry-pick integration PRs; keep the default source-author-owned, single-origin squash route and additive maintainer corrections. If a future multi-author/forwarded case does not meet the narrowly recorded exception, stop for owner direction.

## Branch-protection and merge preflight

Live API facts: `allow_merge_commit:true`, `allow_squash_merge:true`, `allow_rebase_merge:true`; `required_linear_history.enabled:false`; `required_signatures.enabled:true`; force pushes/deletions disabled. No rulesets were returned. These settings permit the proposed merge method with the already signed current commits; **no protection change or admin bypass is needed for this authorship solution**. Signed-head checks still matter: GitHub evaluates the commits introduced by its merge, and linear-history enforcement would prohibit a merge commit if enabled later. [GitHub protected-branch documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

After the narrow policy exception is established and each PR is actually accepted, use `gh pr merge <N> --merge --match-head-commit <freshly-verified-final-SHA>`, with no `--admin`, no rebase, no force push and no direct main push. Refresh all commit pages/signatures if any head changes. Maintain full local gates, exact-head `test`/other CI, resolved adversarial findings and actual affected-flow E2E; clean mergeability and valid signatures do not waive them. Existing material findings/live gaps remain; this audit does not authorize any of the eight to land now.

After each merge, verify the existing PR shows merged, the merge parent contains the exact reviewed head, and **every audited head-branch commit is an ancestor of origin/main with unchanged Author/email/date/signature metadata**. Checking only `git log -1` would inspect the new merge commit and miss whether =DEX’s actual commits survived. Preserve the manifest with the durable handoff/evidence; do not silently close shipped contributor PRs.


A narrow reporting-tool caveat: read-only inspection of `origin/main:scripts/attribution-audit.mjs` found `emailsByLogin` collects every carried commit email under the outside PR opener. With these forwarded mixed-author PRs its per-contributor table can count =DEX-authored commits under passabilities, and =DEX has no discovered PR of their own to create a separate table row. Its normal two-parent merge classification is not itself misflagged, but that aggregate table cannot certify source credit here. Use the explicit Author/login/ancestry manifest; a future narrow audit-tool correction should derive individual credit from commit authors rather than PR-opener email buckets. No historical ledger audit was executed.
