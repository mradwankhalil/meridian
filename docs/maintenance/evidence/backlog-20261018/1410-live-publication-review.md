# Independent #1410 live/heap evidence review — 2026-10-19

**Disposition: safe to publish the sanitized, unchanged transfer as partial historical evidence with the parent qualifications. Product acceptance remains open.** No secret/private-transcript/dependency-tree or retained-license-notice blocker was found. Do not describe the live scripts as byte-exact executed, portable final runners, the generator source escrow as complete, or the E41/model qualification as passed.

Reviewed `/tmp/meridian-1410-live-result.md`, the 106-file escrow, heap/catalog scripts and receipts, actual-client/E41 records, and the parent's current `docs/maintenance/evidence/backlog-20261018/live-verification.md`. A delegated reader independently inspected publication sensitivity, licenses/source completeness and portability; its report is `/tmp/meridian-1410-escrow-publication-review.md`, with a source/license subreport at `/tmp/meridian-1410-escrow-license-review.md`. No retained scripts, models, builds or tests were executed; no original artifacts or repository files were edited. Standard-library metadata/hash inspection only.

## Heap and catalog validity — bounded claim supported

- Both stock Node workers compile the selected unchanged production builder and production LRU implementation, use real SDK 0.2.141/Zod 4.4.3, the identical frozen fixture, the same `{key,mcp}` owner structure and equal retained raw-schema clones. Baseline selects per-session construction; correction selects the new sharing function. No mocked SDK or native/model call enters this memory workload.
- Twelve strong owners, 48 total identical admissions, bounded eviction, then 36 distinct-content admissions under four owners are explicit. Description revisions prevent sharing in the distinct phase. The release observations use weak handles and event-loop/GC rounds without requiring immediate finalizer cleanup.
- Saved post-GC heap **262.3744 → 44.5800 MiB** at twelve identical owners is an **83.009%** reduction in this workload. Identical churn plateaus near **262.52 / 45.00 MiB**; distinct-content owners remain four/four. These are bounded builder/cache observations, not whole-server memory, a thousand-session measurement, a hard RSS bound or reproduction of the contributor's original multi-GB scale. Existing report and parent summary retain these limits.
- Four catalog records per arm have matching serialized wire hashes across baseline/correction. Clone equality, changed-description/fresh equality and inequality from original, independent concurrent transports, survivor listing after sibling close, real MCP argument validation/call and input immutability are asserted. The no-op `read` handler is correctly distinguished from an actual filesystem read. This control changes description, not schema order; prior root/nested order tests remain separate evidence.
- The fixture is honestly identified as a constructed public-source workload: eleven selected native schemas, 131 unique GitHub snapshots plus 88 second-instance aliases, not the actual live V2 roster or reporter capture. The rc.111 measured fixture is preserved separately from the beta.83 conversion; documented two-keyword-map ordering differences do not change the preserved measurement input.

The portable offline proof can consume the frozen JSON with clean exact-commit checkouts/frozen dependencies and a fresh output directory. `run-heap-proof.mjs:15` checks HEAD rather than independently verifying clean source; the parent correctly requires clean checkouts. No heap rerun is needed to validate the saved arithmetic/catalog hashes.

## Publication completeness and provenance qualifications

All **105 manifest-listed entries** match their recorded byte counts and SHA-256; there are **106 regular files** including the manifest, no unlisted files and no symlinks. All four cross-arm catalog hashes match; both fixture hashes match provenance.

**The original complete-source claim must be superseded:** `prepare-escrow.mjs:19` excludes `.snap`, so all **141 GitHub MCP snapshot inputs** are absent. Their pinned listing/manifest/provenance remain, but the generator cannot regenerate offline from this transfer alone. This does not invalidate direct frozen-fixture heap reproduction. The parent's live-verification addendum already states the missing-source/pinned-public-download prerequisite and says not to describe every generator input as escrowed. Restore verified snapshot bytes as a separately hashed supplement if full offline regeneration is wanted; preserve the original transfer/manifest unchanged.

Complete MIT notices are present for OpenCode, GitHub MCP and E42's OpenCode source set. Retain them beside redistributed source-derived fixtures. Per-tool provenance is pinned; some unused extra/E42 renamed source files lack direct immutable repository-path mappings, a nonblocking provenance limitation rather than evidence they are private. No runtime dependency tree is included. Package locks are installation receipts; some encode original filesystem prefixes and are not themselves portable package roots.

The full scan/manual receipts review found no OAuth/provider token values, attestation keys, private keys, raw customer/native transcript bodies or private credential-store payloads. Local fixture passwords/API-key strings are explicit nonsecrets. Remaining identifiers are owned session/tool IDs, fixture paths and credential-presence/expiry metadata. Neither those IDs nor a public license/signature hash is a secret.

## Live proof and remaining acceptance

The retained actual OpenCode 2.0.21 arm supports the stated read/result and same-client-session continuation observation, matching-generation setup/config/discovery, cryptographically checked plugin-generated headers, scrub invocation and 100% observed prior-prefix cache reads. It deliberately blocks title requests and does not prove extended E42. SDK history in this arm records only the intended model, but do not use Meridian's HTTP model echo alone as independent served-model proof.

E41 sequential JSON **failed** supported-history exact-model qualification after three requests; three remaining modes and extended V2 were not run. The preserved initial API-auth fault was explained and occurred before inference; it is not a credential diagnosis. No alternate-model green rerun is substituted. Immutable history, full exact-one-answer settlement, saved-fork continuation and the full matrix remain incomplete. #1413 credit-policy adoption changes none of these gates.

The parent is correctly adding two static-boundary qualifications: `opus[1m]` Options do not imply absence of the numeric per-request environment pin (`models.ts:108–113` and server model-default overlay); absence of `isApiErrorMessage` after supported-history projection cannot prove a raw provider/native error flag was false. Thus the mixed annotations remain unresolved; they establish neither a provider wire-model switch nor a defect caused by #1410 or exhausted credentials. Preserve original diagnostic reports and let the parent addendum govern those interpretations.

## Historical scripts versus future runner changes

The current escrow already contains **post-run** opt-in/path/environment/preflight edits; the end-state receipt explicitly says they were not inference-rerun. No contemporaneous executed-source hash/diff is retained. Add this exact clarification to the parent text if needed: **“The escrowed #1410 live scripts are post-run handoff revisions, not byte-exact copies of the executed scripts.”** Do not label the present originals as exact execution bytes. Any future corrected copies need separate names/hashes and an explicit unrun status.

Concrete future-copy changes, not publication blockers while this gate is retained:

| File | Path/assertion gap |
|---|---|
| `guarded-actual-v2-live.mjs` | Lines 15–16 statically import the original worktree despite `E2E_MERIDIAN_ROOT`; resolve custody/scrub modules from the selected root. Lines 71/163 hardcode the scrub-consumer path; use the selected plugin path/version. Line 155 only checks `models.has(model)`; require the exact singleton and every forwarded response's model before another request. End binary identity is recorded but should fail a future gate if changed. |
| `qualified-e41-signed.mjs` | Lines 20–22, 41–44 and 53 statically import original-worktree libraries, SDK and source. Resolve all from the chosen root/its frozen installation. Retain the currently missing effective provider-baseURL witness and stronger per-round raw SDK model capture. |
| `read-only-usage-guard.mjs` | Lines 4–5 and 23 hardcode original source/output paths; parameterize root/evidence destination. |

Live binaries/plugins and repository libraries remain external pinned reproduction dependencies, rather than contents of the escrow. Entrypoint hashes do not cover all transitive built chunks or supply launch-time provenance. The current parent document explicitly retains portability, executed-byte, exact-model and transitive-build gates; implementing a future runner is not required to publish this truthful partial evidence, and no live rerun is authorized by this review.
