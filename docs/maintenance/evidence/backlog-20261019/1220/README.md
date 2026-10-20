# Async-store safety corrections on #1220

Original contributor head `63f541972475bfd9337bd7b983bd77e9eadcf6a9` still
lacked the known maintainer safety fixes from closed administrative draft #1245.
The async cleanup contract is already approved by #1244. No approval was
requested again, and no SQLite behavior was added. The prior real E41 residual
200-token cache-prefix failure remains an acceptance gate.

Current contributor branch head is `b1fffe4ac8118f52fec9d74555cae45f31332fb7`:
signed main merge `f3279411`, signed correction `7506dd4c`, and signed fixture
adaptation `b1fffe4a`. The original Nowaker commit is an unchanged ancestor.
No replacement integration PR, rebase, cherry-pick or force push was used.
The substantive corrections belong to the maintainer; a future own-PR squash
must preserve Nowaker as Git Author with proper maintainer coauthor credit.

The correction adapts the previously reviewed maintainer changes
`a58e98714`/`6ca536294` to current source while retaining the newer raw-client
versus SDK-prefix distinction. Mutable history, UUIDs, context, locators,
priority options and prune sets are captured before queue/disk yields. The
store rechecks synchronous publication authority after awaited write/fsync/close
and immediately before dispatching rename. All four server mapping publication
paths, terminal priority finalization and both locator-attachment paths supply
the guard; the newer silent-recovery attachment was absent from the older patch.
This does not claim cancellation can recall an already-dispatched filesystem
rename. Cache epochs prevent older writes/rollbacks from repopulating memory
across awaited cleanup, while later writes still publish.

Adversarial review found one further gap in the adapted old fix: the durable
store owned its inputs, but local read-error fallback still retained caller
UUID/locator references. Two new keyed/fingerprint cases fail before the extra
local snapshot and pass after it. The same snapshots now feed durable and local
publication. An AST scan also found seven newer test hooks that did not await
the newly asynchronous cache reset; they were adapted in a separate commit.
The merge preserves main's loop-lag diagnostics and the contributor's awaited
async measurement, without weakening its ratio threshold.

The [exact red stages](red-stages.json) distinguish the original implementation
from the intermediate corrected tree; no intermediate failure is relabeled as an
original-head execution. Retained red controls:

- [Queued input capture](red-input.log): one failure, including publication of
  a caller-injected invalid relative locator after validation.
- [Request/shutdown publication](red-publication.log): two failures; a real
  FileHandle fsync hold allows revocation before release, and the rename spy
  observes the forbidden publication, rather than only its eventual eviction.
- [Clear ordering](red-cache.log): two failures and two passing later-write
  controls, on genuine durable read errors to expose local fallback.
- [Local input ownership](red-local-input.log): two failures after the older
  safety corrections, before the newly added local snapshots.

After correction the complete affected files pass **29 tests** (10 mutation,
9 request-cancellation, 10 cache-coherence); [mutation](green-input.log),
[HTTP cancellation](green-publication.log), [cache](green-cache-final.log).
[Priority/store/prune adjacency](adjacent.log) passes **59 tests / 440 assertions**.
These use Bun 1.3.11, mocked SDK/owned filesystem fixtures and no model calls.
The committed tests on this contributor branch are the reproducible headless
regressions; private native transcripts are not inspected. Logs have explicit
[whitespace-normalization provenance](log-provenance.json).

The [final complete local gate](final-gate-summary.json) passes 6,997 tests /
36 skips / 0 failures across all 24 pinned invocations; standalone typecheck
and build also pass. [All exact-head CI checks](final-ci.json), including `test`, pass. This does not resolve the old
E41 cache failure or replace actual affected-client/model/platform acceptance.
#1220 and its dependent SQL proposals remain unmerged.
