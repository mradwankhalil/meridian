# Forwarded-policy final review — 2026-10-19

## Resolution recheck — PASS

Both requested corrections are now present in the proposed worktree:
`git show --no-patch --format=fuller <SHA>` explicitly inspects each recorded
commit; incorporation now reports source-work misattribution while distinguishing
legitimate maintainer correction commits and the merge commit. Re-read those
two changed diffs and reran `git diff --check origin/main` successfully.
**PASS: no outstanding material findings.** Earlier findings below are retained
as the resolved review record, not current blockers. Owner approval/ordinary
validation and merge gates remain separate from this review result.

Reviewed the full unstaged five-instruction-file diff against
`origin/main` `095b4869b5fe386e2f3a273cc5b60ec3853c8659` in
`/private/tmp/meridian-forwarded-credit-20261018`.

**Disposition: accept with two small verification-instruction corrections.**
No unsafe authority expansion, source-credit misrepresentation, signature bypass
or changed normal/default merge policy found. The exception itself remains
conditional on recorded owner approval for an already-open PR/bounded batch.

## Corrections

1. **`.agents/references/contributing.md:132` — pin the identity inspection to
   the recorded source commit.** The literal command
   `git show --no-patch --format=fuller` defaults to HEAD, which is normally the
   merge commit and therefore does not inspect the source Author/AuthorDate.
   Use `git show --no-patch --format=fuller <SHA>` for each recorded SHA, matching
   the already-pinned ancestry command directly above. The current sentence
   otherwise repeats the precise merge-author-only verification pitfall that
   the new route intends to prevent.

2. **`.agents/skills/meridian-upstream-review/references/incorporation.md:25` —
   qualify the leftover "If it names the maintainer ... defect" condition.**
   The same bullet now describes retained forwarded commits, which intentionally
   include legitimate maintainer correction commits as well as a merge performed
   by the maintainer. Their names are expected there. Report a defect when a
   *source contributor's work* is attributed to the maintainer, or when recorded
   Author/AuthorDate/source commit identity fails verification. Do not make any
   maintainer-named commit automatically a failure. The detailed contributing
   section already distinguishes these roles correctly.

After these corrections, no material objection remains from this review.

## Checks and positive findings

- Complete diff read across AGENTS, contributing, upstream SKILL/incorporation
  and backlog SKILL. All primary own-PR/squash instructions now point to the
  explicit narrow forwarded exception rather than contradicting it.
- Defaults stay source-author-owned PR + squash; no new maintainer integration,
  cherry-pick/rebase/retype/re-sign/force-push path; no silent source closure.
- Eligibility is explicit owner approval plus already-open forwarded PR/bounded
  batch. Existing source-author-owned PR is preferred; every introduced commit
  and source provenance must be recorded. Current copied objects are accurately
  distinguished from earlier source SHAs and the forwarder's signature.
- Full product/regression/local/live/exact-head CI gates remain. Signatures and
  protection are rechecked; commit-preserving merges categorically prohibit
  `--admin` or weakening protection, while the old narrowly signed-squash-only
  unsigned-commit exception remains confined to its original use.
- Merge command uses `--merge --match-head-commit`; neutral subject/body avoids
  adding a conventional merge summary. Normal squash settings stay unchanged.
- Postmerge rules check PR MERGED, signed two-parent merge, reviewed base/head/
  combined tree, per-source SHA reachability and Author/AuthorDate. Concurrent
  base advancement is explicitly called out. Green Attribution or merge Author
  alone is explicitly insufficient.
- Release-note multiple-entry tradeoff and next Release Please PR inspection are
  stated. No publication, external-comment or repository-setting authorization
  is inferred from this route.
- All **28 relative links/heading anchors** in the five changed files resolve.
  `git diff --check origin/main` passes. `gh pr merge --help` confirms the cited
  merge/head/subject/body-file flags. The ancestry command is valid; the missing
  SHA on identity inspection is the only concrete command correction identified.

No files/settings/PRs/comments/merges/tests were changed or run. Only this
temporary review report was written outside the repository.
