# Final adversarial evidence review

The final change against current product main is documentation and manual
proof only. It carries no unmerged contributor implementation, application
module, package/version metadata, dependency or workflow change. The source
fixes remain on each contributor's own PR. Required exact-head CI, including
`test`, still gates this evidence PR; no admin bypass applies.

Concrete findings and resolutions:

- Stale in-progress counts/heads could imply merged work still failed local
  tests. The new top-level handoff distinguishes six verified product/test
  merges from five advanced but unmerged branches, and dates the queue snapshot.
- A real refused native generation was retried, followed by an unrequested
  model pivot. The original append-only witness is retained: three actual 5.5
  provider requests, then a fourth 4.8 request blocked before network. The
  historical report's attempted-generation count is explicitly qualified.
- Manual relay refusal/path/parser failures could permit later retries. The
  updated guards latch refusals, suppress tool forwarding, stop owned clients,
  count admitted/blocked attempts separately, canonicalize exact owned fixtures
  and return nonretryable errors. Offline regression controls pass. No new real
  model run was used to turn that failed gate green.
- The unexecuted hourly preparation allowed an insufficient two-client cadence
  and an empty large-store seed. Both invalid plans now fail before output,
  credential, native or SDK construction. The actual seed/hour path remains
  unqualified; the small-store pilot is not represented as large-store proof.
- #1220's adapted old fixes missed local fallback input ownership and a newer
  recovery-attachment call site. Separate failing controls and the corrected
  guard/snapshots are preserved on its own branch. Seven newer async cleanup
  hooks were adapted. The original versus intermediate red stages are explicit.
- Earlier native aggregate `[1m]` labels, output-cap recovery, unreplicated
  client answer omission, unrelated Bun bundler failure, timing miss and
  original cache-floor/model-history failures are retained with exact limits.
  A fresh pass does not supply missing old provider causality.
- Contributor ownership and merge trees are recorded per PR; the forwarded
  merge has the full author/object manifest. The after-batch audit adds no
  legacy maintainer-author row. No source author history was rewritten.
- Fresh and resumed #1406 isolation are distinguished; old guidance survives
  resume. Actual OpenCode/model acceptance and visual-media upload remain open.
  Two browser profiles were signed out; no new login or message was attempted.
- All open PRs/issues have dispositions and observable triggers. Existing
  #1244/#1277 approval is retained, explicit no-review/owner/platform holds are
  respected, and release publication/comments remain unauthorized. #1418's
  missing startup-advisory note is a release gate, not an authorship rewrite.

Local validation: parse every new JSON/JSONL receipt; syntax-check manual `.mjs`
files; resolve relative Markdown links; inspect source/receipt claims and
selected artifact hashes; scan for live token prefixes; check the staged diff
for whitespace/conflict markers. The offline native fixture retains refusal
as an error and joins every child; no provider or account credentials are used.
Source PRs' complete pinned local/type/build/CI receipts are separate evidence,
not a substitute for this PR's final CI. No application rebuild is required
for this documentation-only delta.

Private grants/native executables/raw customer content/private SDK files and
browser media are excluded from git. All 12 original dirty/untracked checkout
files match their pre-work SHA-256 values; ignored dependency installs are not
claimed unchanged. The earlier accidental root frozen dependency install made
no tracked/untracked file delta and is outside that hash claim.
