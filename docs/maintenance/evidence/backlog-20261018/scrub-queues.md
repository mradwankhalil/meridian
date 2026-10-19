# Managed scrub queue review — 2026-10-18

Read-only parallel review for the current Meridian backlog request. No repository
branches, GitHub comments, issue states, merges, releases, credentials or secrets
were changed. Current instructions read from fresh Meridian `origin/main`
(`095b486` per parent), including the contributor-own-PR attribution correction.
The checked-out 1.78 instructions and historical handoff are stale and must not
be used as the current incorporation procedure.

## Discovery and coverage

- Authenticated GitHub account: `rynfar`; Meridian remote owner: `rynfar`.
- Paginated `user/repos` across owner/collaborator/org affiliations and paginated
  repository listings for accessible `Centeva`, `pylon-code`, `kraken-crm`.
- Discovered exactly five managed name-containing-`scrub` repositories, all
  public, active, and reporting `admin=true`, `maintain=true`, `push=true`:
  `rynfar/hudscrub` (default `master`), `rynfar/meridian-plugin-hermes-scrub`,
  `rynfar/meridian-plugin-openclaw-scrub`,
  `rynfar/meridian-plugin-opencode-scrub`,
  `rynfar/meridian-plugin-pi-scrub` (the last four default `main`).
- Followed all four scrub-repository links in Meridian `docs/plugins.md`; they
  match discovery. No extra org/archived/private scrub candidate or inaccessible
  candidate was found. Unrelated repositories were not reviewed.
- Paginated open issue endpoints (which also include PRs), plus independent
  paginated open-PR endpoints for the two nonempty queues. Zero open issues and
  zero open contributor PRs across all five repositories.
- HUDScrub, Hermes scrub and OpenClaw scrub have no open items.
- OpenCode's historical source #5 and subsequent #22/#23/#24 are no longer open.
  Fresh handoff says #22/#23 merged as their contributors' own PRs and #24 closed
  unmerged; no attempt was made to revisit those historical attribution decisions.

## Open PR dispositions

### OpenCode scrub #20 — defer until explicit release authorization and release gates

https://github.com/rynfar/meridian-plugin-opencode-scrub/pull/20

- Title: `chore(main): release meridian-plugin-opencode-scrub 0.3.0`.
- Exact PR head: `8f58c474f4fd9ee18ea9a1a1dd65360d49939e6f`.
- Branch base recorded on PR: `c59fa180a67bdc0e92e54335faf37192df334b5c`.
- Current main: `8ecdf1e182688ea509e590703d96b24fc16b2584`.
- Non-draft, mergeable, `mergeStateStatus=UNSTABLE`, no comments or reviews.
- Complete four-file diff and sole release commit reviewed. Manifest, root and
  lockfile versions agree on 0.3.0; changelog includes #19 minimal mode and #22/#23
  cwd corrections. No metadata inconsistency found in that diff.
- PR head has **zero check runs and zero commit statuses**, aggregate `pending`.
  Main's `build`, `dispatch`, `release-please` checks passed, `publish` skipped.
  Main CI is not candidate-head CI. Branch protection API says branch unprotected,
  but that does not waive repository release gates.
- PR head is one release commit ahead and one docs/harness commit behind current
  main. Main-only commit #25 retains cwd evidence and `scripts/e2e-cwd-package.mjs`.
  It is not an implementation conflict; use the actual release merge tree when
  preparing release evidence.
- npm currently serves 0.2.3, so the proposed 0.3.0 has not published.
- Read README and retained minimal-mode proof. Existing feature proof covers
  actual OpenCode 1.18.33 / Opus 5.5 / Agent SDK 0.2.141 / Claude Code 2.1.284,
  independently installed tarball, actual read receipt and same-session
  continuation in both minimal/aggressive modes. This is historical feature
  evidence, not fresh final-release-candidate evidence. Current handoff also
  records package/parser cwd-boundary 48/48 proof for #22/#23.
- Observable revisit trigger: owner explicitly authorizes publication; then
  validate the exact candidate/merge tree, final-head CI, current matching
  Meridian OpenCode client plugin preflight and server scrub witnesses, affected
  real-client flow, package/version integrity, provenance, and fresh registry
  install after Release Please. Merge uses `--merge`, never squash/version/tag
  commands or direct publish. No release operations authorized by this task.

### Pi scrub #15 — defer until explicit release authorization and release gates

https://github.com/rynfar/meridian-plugin-pi-scrub/pull/15

- Title: `chore(main): release meridian-plugin-pi-scrub 0.2.3`.
- Exact PR head: `f650e9269a8adcdd31368527ab798473e5f73b29`.
- Current main / PR base: `188115f355f423cbff50b20a2e5fd7d932ec1746`.
- Non-draft, mergeable, `mergeStateStatus=UNSTABLE`, no comments or reviews.
- Complete four-file diff and sole release commit reviewed. Manifest, root and
  lockfile versions agree on 0.2.3; changelog records complete sectioned Pi docs
  scrubbing from #14. No metadata inconsistency found in that diff.
- PR head has **zero check runs and zero statuses**, aggregate `pending`.
  Main's `build`, `dispatch`, `release-please` checks passed, `publish` skipped.
  Main success is not candidate-head CI. Branch protection API unprotected.
- npm currently serves 0.2.2; 0.2.3 has not published.
- README and durable #13/#14 proof reviewed: reproduced two tests on published
  0.2.2, corrected 17/17 tests, actual Pi 0.87.1 / Opus 5.5 / SDK 0.2.141 /
  Claude Code 2.1.284 / macOS arm64, independently installed fixed tarball,
  client-only read receipt and same-session continuation. Good historical fix
  proof; no fresh release-candidate flow was run in this read-only task.
- Observable revisit trigger: explicit publication authorization, exact-head CI,
  candidate/packed-package gates and affected-client E2E; then Release Please
  `--merge`, publication/provenance/integrity and fresh registry-installed flow.

## Useful next work

There is no currently actionable contributor or issue implementation in this scrub
queue. The two releases have real final-head CI gaps; do not label them merge-ready
or silently merge them as backlog cleanup. Their workflows run CI on pull_request,
but neither generated bot PR presently has check runs. A future authorized release
round must arrange real exact-head CI (or a documented equivalent accepted by the
owner), rather than relying on older green main runs. No workflow change or
workflow run was initiated here because this child task is read-only.

Parent should link these two reviewed PRs to the thread if its linking tool is
available and preserve these release dispositions in the current durable handoff.
