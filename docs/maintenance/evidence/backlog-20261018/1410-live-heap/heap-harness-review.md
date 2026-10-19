# Independent PR1410 heap/catalog harness review

Verdict: PASS for the bounded offline catalog-builder comparison, with the explicitly scoped limitations below. Reviewed `heap-worker.mjs` and `run-heap-proof.mjs` independently and made no edits to either harness. No inference, native Claude CLI, account changes, repository source edits, or client configuration reads were performed by this reviewer.

## Workload and fair comparison

Both source revisions use the same frozen 230-tool fixture bytes, SHA-256 `df872b711b2cebae00326778b1649bb80e2e7271418f4878207caf629bb5e17f`, real Agent SDK 0.2.141, Zod 4.4.3, and production stock Node. Bun is used for source compilation only. The fixture contains 11 selected public native OpenCode schemas, including `read`, plus 131 unique public GitHub MCP schemas and 88 explicit second-instance aliases. There are 137 distinct input schemas with arrays, nested objects, enums and unions; it is a constructed client-consumable workload rather than a reporter-captured roster. See the per-tool provenance and `fixture-provenance-and-harness-review.md`.

The source-mode switch correctly selects uncached per-session construction for baseline and process-wide weak sharing for current. Both modes clone and retain raw tool arrays per strong session owner; the baseline does not get an artificially cheaper raw-input retention path. The harness keeps twelve strong built-catalog owners via an actual LRUMap and validates twelve unique baseline catalogs versus one current shared catalog. It admits 48 identical catalogs overall, then independently churns 36 distinct description revisions under a four-owner limit. Owner/eviction counts are asserted. The distinct revisions prevent accidental identical-content sharing in that phase.

Explicit GC is separated by event-loop turns. Releasing all owners uses only weak handles; the number of still-observed weak targets is reported without a pass/fail assumption about immediate collection or finalizer timing. Node is launched with 512 MiB old-space, plus a 480 MiB post-GC heapUsed sample assertion. This bounds the tested retained heap rather than extrapolating a thousand-session baseline or an absolute whole-machine RSS cap. The fixture and raw arrays remain intentionally represented in both processes.

## Catalog/protocol controls and resolved findings

Real SDK MCP servers and independent InMemoryTransports list four 230-tool catalogs: original, equal clone, changed-description catalog, and a fresh independently built changed-description control. Assertions check clone/fresh equality, changed-catalog inequality, distinct server instances, clone-definition reuse in current only, survivor listing and a successful real `read` tool invocation after other transports close, and input immutability. The successful call validates and routes an MCP tool invocation; it does not execute a filesystem read in a live OpenCode session.

Two review findings were corrected by the parent:

1. The runner now compares the fixture SHA and all four serialized catalog hashes between baseline and current. I independently rechecked the saved baseline/current PASS receipts and all four hash equalities; `catalog-comparison.json` is PASS. This comparison is based on the already saved deterministic catalog artifacts and did not rerun the heap experiment.
2. The variant comment now accurately states that a changed description represents an independently built catalog. It no longer claims that this harness changes root/nested property insertion order.

Baseline/current catalog hashes match byte-for-byte for all four indices. Original/clone: `b7b58375a3d0128d5a9da64de51a7dc6a0b6d188abe5438b039fc894c7e56130`; changed/fresh: `09a584df412ec54682ceb20991e7c619b2d865287c0d927b1fa05950765b6b2e`.

## Fixture conversion qualifier and remaining limits

The measured fixture was initially generated from pinned OpenCode 1.18.34 public schema expressions and its unmodified public JSON-schema converter using installed Effect 4.0.0-rc.111. Source package verification subsequently identified the actual OpenCode pin as Effect 4.0.0-beta.83. Exact-beta conversion was generated separately under an isolated npm prefix, without changing measured bytes or repository dependencies. It has the same JSON values, nested field-map orders, schema structures and complexity. Only JSON keyword-map order on two native `lsp` integer parameter schemas differs. Both fixtures and the exact comparison are preserved; no supplementary heap rerun was performed. Thus the workload is transparently source-derived, not a byte-exact reporter or installed-client request capture.

The experiment does not establish 1,000 simultaneously retained baseline sessions, full server/session/transcript memory, exact weak-index/finalizer latency, native tool-result pairing, checkpoint/fork history, cache-prefix continuity, E41 modes, V2 extended flow, or actual OpenCode/Claude/plugin/model routing. Those remain separate live acceptance gates. The independently built MCP catalog variant should not be described as native session history proof.

Both public schema sources use MIT licenses. Preserve `public-schema-sources/LICENSE-opencode.txt` and `public-schema-sources/LICENSE-github-mcp-server.txt` with copied source-derived artifacts. Source URLs, pinned commits and hashes are in the provenance JSON and source manifest.
