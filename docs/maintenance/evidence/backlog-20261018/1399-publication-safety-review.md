# PR #1399 correction evidence publication-safety review

Disposition: **no credential/private-content blocker detected in the inspected evidence. Recommend a selected durable receipt set, rather than copying the complete verbose log bundle.** This review covers disclosure, file integrity and reproduction portability only. It does not accept the product change, explain the local full-suite failure or authorize a merge/model rerun.

Read-only scope: `/tmp/meridian-1399-correction-evidence` and `/tmp/meridian-1399-correction-result.md`. No retained script/test/build, dependency install, model query, access diagnostic or source edit was performed. Metadata inspection used Python/file reads. A delegated reviewer independently inspected the full npm log, stage logs and credential-shaped matches; its report is `/tmp/meridian-1399-npm-log-sensitivity-review.md`.

## Disclosure and integrity

- Actual inspected bundle: 66 regular files, 1,531,861 bytes; no directories, symlinks, node_modules/dependency trees, private grant files or transcript files. All 65 entries in `sha256-manifest.json` match their file SHA-256; the manifest itself is the only unlisted file. `result.md` is byte-identical to the external correction report.
- Whole-file scans found no private-key material, Anthropic/OpenAI/GitHub token signature, JWT, bearer credential value or URL-embedded credential. Credential-shaped Basic matches in `npm-test.log:4079–4083` are ordinary “basic configuration surface” test names, not authorization headers. Email-like values at `npm-test.log:7597,7606,7613,7617` are the same reserved-domain fixture. No real access/refresh token or private customer transcript was identified by the restricted log subreview. Unrelated account-shaped output around lines 7597–7618 uses mock account/workspace identifiers and the reserved-domain fixture; omit it rather than treating arbitrary log strings as independently proven safe provenance.
- Commit/signature records retain author/committer email metadata and a public signing-key fingerprint (`original-authors.txt`, `correction-commits.txt`, `signatures.log`). These are identity/provenance metadata, not private-key bytes. They are unnecessary to the core regression receipt set; preserve required attribution through the existing public PR/commits or deliberately selected provenance files.
- Logs expose the original local worktree/temp paths and stage logs begin with an absolute cwd. These are portability/privacy metadata, not credentials. A publication excerpt can replace the original machine root with `<REPO>` while retaining original log line numbers and hash; keep sanitized derivatives explicitly distinguished from original bytes.
- The patch files contain only expected repository source/test paths. There is no dependency-source tree or third-party source snapshot licensing issue in this transfer. This is not an independent general license audit of the project.

## Full-suite first failure and retained red gate

The first failing test appears at `npm-test.log:65–81`, in `proxy-system-reminder-preservation.test.ts:111`: OpenCode system-reminder task-ID preservation expected a synthetic marker in the SDK prompt, but received `undefined`. `npm-test.log:67` contains the preceding `Claude auth-status process cleanup is unconfirmed` warning. This is an observed sequence; the log does not prove the underlying cause or establish that the correction caused it.

The original footer at lines 11350–11354 reports **6,396 pass / 36 skip / 89 fail**, 30,879 assertions, 6,521 tests across 384 files, 409.03 seconds. `npm-test.exit` is 1. All 89 entries of `full-suite-failures.json` point to real failing-instance lines in that original log. Main-stage failure remains an open local gate. The separate 23 commands' 464 passing tests, standalone typecheck/build, harmless process diagnostic and green final-head CI cannot reclassify that run as passing. **Runtime qualifier:** the full npm main log reports Bun 1.3.11 at line 9, while every stage 02–24 log reports Bun 1.3.14 at line 2. Preserve this difference in the publication addendum/per-stage receipts; the report's opening 1.3.11 tuple does not describe those supplementary runs.

The original full log is 1,271,949 bytes, SHA-256 `9a088aacd508d67dea5eccd2a3c5b09d333e733f85369487f5b0c68b72f5cb3e`. Publish a sanitized first-failure excerpt (original lines 65, 67–81, retaining warning + the first failing instance) and the final footer (11350–11354), accompanied by this hash, original byte count and line-range mapping. Retain the 89-failure inventory and exit receipt. This preserves the material red result without dumping every unrelated test line. If the full original is retained as a separately reviewed durable attachment, label it as the failed run rather than replacing it with an isolated green rerun.

## Recommended selected durable receipts

Thirty existing files total **90,203 bytes**, before the short full-log excerpt and a new selected-file manifest:

- Report/review: `result.md`, `review-record.md`.
- Exact regression input/source: `reproduce-offline.sh`, `regression-tests.patch`, `correction.patch`.
- Red/green/adjacency receipts: `original-head-regression.log`, `focused-green.log`, `lifecycle-adjacency.log`, `reproduced-original.log`, `reproduced-original.exit`, `reproduced-corrected.log`, `reproduced-corrected.exit`, `reproducer-validation.log`, `reproducer-validation.exit`.
- Honest final-gate records: `full-suite-failures.json`, `npm-test.exit`, `gate-counts.json`, `remaining-gates.json`, `run-remaining-gates.py`, `typecheck.log`, `build.log`, `pr-final.json`.
- No-model synthetic SDK proof: `offline-sdk-commands.sh`, `offline-sdk-normal.log`, `offline-sdk-normal.exit`, `offline-sdk-drain.log`, `offline-sdk-drain.exit`.
- Bounded harmless process diagnostic: `auth-owned-process-probe.ts`, `auth-owned-process-bun-complete.log`, `auth-source-identities.txt`.

The 23 verbose `npm-test-stage-*.log` files and full npm log need not be committed merely to prove the small shutdown regression. The structured argv/exits/timings/counts retain supplementary stage outcomes; add the observed Bun 1.3.14 runtime because the existing structured records omit it. Add the sanitized first-failure/footer excerpt so the failed original is conspicuous. Keep the original all-file manifest as a historical transfer record if desired, but create a separate manifest for the actual selected publication; an incomplete subset must not be represented as satisfying the original complete-directory manifest.

## Reproduction portability

`reproduce-offline.sh:6–10,17–29` takes a repository containing both recorded commits, final SHA and an absolute `BUN` path. Bun must report exactly 1.3.11; preserve source `a8fccdbdd9abe0f196168cf0a34a341caba1e1a5` and final `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`. It uses git archive, tar, mktemp and grep, plus the retained regression patch. Frozen install disables scripts but still needs package-registry access or an existing package cache. “Offline” here means no model/account access, not necessarily a disconnected dependency install. The Darwin arm64 receipt does not independently establish another platform.

The reproducer has no hardcoded original-worktree import. It writes `reproduced-*.log/.exit` beside itself (`reproduce-offline.sh:29–32`), so run a writable working copy rather than overwriting the historical published receipt directory. Keep original hashes intact.

`offline-sdk-commands.sh:3–9` must run from the exact final checkout with Bun 1.3.11 and installed frozen dependencies; its `scripts/e2e-session-gc-throughput.mjs` comes from that pinned repository. It is a supported-SDK synthetic deletion control, not actual-client acceptance. `auth-owned-process-probe.ts:29–31` parameterizes its repository module path but uses `/bin/sh`, so it is a POSIX/macOS diagnostic, not a Windows result. `run-remaining-gates.py:13–22` accepts repo/Bun paths, derives the exact 24-stage script and requires an existing nonzero `npm-test.exit`; it writes supplementary logs/receipts beside itself and explicitly does not turn the initial failed gate green.

No new publication-safety finding requires execution. Local full-suite failure and actual macOS affected-client throughput/admission/stop-time acceptance remain open independently of these publishable regression receipts.
