# Contributor review and incorporation

Use the sections for the current phase.

## Decide whether the change belongs

1. Refresh origin/main and the live PR/issue inventory before selecting work. Record base SHA, contributor head SHA, linked issue, author and authored date. Read the full diff and neighboring code. CI status and PR descriptions are evidence inputs, not approval.
2. Confirm the reported behavior on current main and explain the desired behavior. Assess scope, architecture, stable API compatibility, session/history integrity, cache behavior, error handling, concurrency, affected clients and platforms. A requested feature is not automatically a desirable change.
3. Give each item an explicit disposition: accept as proposed, accept with maintainer corrections, superseded with linked evidence, defer pending a decision/environment, or decline with a concrete reason. Do not merge merely to clear the queue.

## Merge the contributor's own PR

Follow [Contributor pull requests](../../../references/contributing.md#contributor-pull-requests). The contributor must end up as `Author` on `main`, with the landing PR shown as merged. For an already-open forwarded contribution, use only the [qualified forwarded route](../../../references/contributing.md#forwarded-contributions), preserving and verifying all existing author commits.

- Work on their PR, not a copy of it. `gh pr checkout <N>` in a fresh isolated worktree; do not switch or reset the user's checkout or disturb existing worktrees. Do not create a `codex/` or other maintainer branch holding their commits, and do not open a maintainer PR for their change.
- Push maintainer corrections to their branch as separate signed commits, and resolve conflicts by merging `main` into it; do not wait on the contributor for either. Do not amend, squash, rebase or force-push their commits. Keep evidence, harnesses and handoff notes off their branch, in a separate maintainer PR, so the maintainer is co-author only of a change the maintainer actually altered.
- Check `mergeStateStatus` rather than assuming signed-commit protection blocks a fork PR. `CLEAN` merges directly. For a normal squash only, when unsigned commits are the only block and every check on the exact head is green, use `--admin` as step 3 allows. A forwarded commit-preserving merge never uses this exception.
- If their PR cannot carry the change, stop and ask the owner. Do not fall back to a maintainer integration PR.
- Repository settings verified 2026-09-08: PR_TITLE / BLANK. Do not use `--admin` outside that unsigned-commit case, push directly to main, or change those settings.

## Merge only what was validated

- Finish all local required gates on the contributor's head and wait for all relevant final-head CI checks. Any source change, rebase or changed base requires impact-appropriate revalidation; obsolete green runs do not validate a new head.
- Immediately before merge, re-read PR head/base and merge state. Use `gh pr merge <their-PR> --squash --match-head-commit <verified-SHA>` by default; qualified forwarded contributions use the documented `--merge` route, and Release Please PRs use `--merge`. Confirm the merged tree corresponds to the validated tree.
- Confirm authorship from git, not from intent: a squash must name the contributor as Author; a forwarded merge must retain every recorded introduced author commit SHA unchanged and reachable on `origin/main`, with matching Author/AuthorDate, reviewed parents/tree and signed merge commit. Record that output in the handoff. If source work is attributed to the maintainer instead, report it to the owner as a defect; legitimate maintainer correction commits and the merge commit do not replace source-author evidence.
- Close linked issues only when the evidence supports their resolution. Close a contributor PR only when its work is declined or superseded, never when it shipped.
- GitHub comments, email, Slack or other messages need the owner's explicit authorization. Draft the explanation, and when authorization is missing leave the PR open with the draft in the handoff. Never close a contributor PR without a posted explanation, and never tell a contributor their authorship was preserved before the check above shows it.

## Checkpoint and hand off

Update [docs/maintenance/REVIEW_HANDOFF.md](../../../../docs/maintenance/REVIEW_HANDOFF.md) as the portable checkpoint and keep per-item evidence in the PR or a linked review record. Local logs can supplement these records but must not be the only way another agent learns the status. Record item/disposition, the contributor PR and its landed commit with the verified Author, worktree, changes, commands, before/after failures, E2E versions, CI links, merge/closure status, known limitations and the next action. Keep historical logs, but replace contradictory status in the current handoff.

The owner may pause after the current ticket. Finish only that ticket, save a checkpoint and stop. A handoff to another agent is not authority for two agents to resume the same queue concurrently. On continuation, the receiving agent refreshes GitHub and chooses one bounded item using this process. Do not treat a release as completion of the whole backlog.
