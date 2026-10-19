# PR1410 constructed client-derived 230-tool fixture

The measured fixture is `client-derived-230-tools.json`, an Anthropic tools array of exactly 230 unique names. SHA-256: `df872b711b2cebae00326778b1649bb80e2e7271418f4878207caf629bb5e17f`. It was generated once, reproduced byte-for-byte, and then frozen for the parent's baseline/current heap run.

It combines 11 native OpenCode tool schemas derived from public v1.18.34 source at commit `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`, all 131 unique-named GitHub MCP tool snapshots from public commit `e3809fe91c7546633241006bf0b91f23b2595e28`, and 88 explicitly namespaced aliases representing a second server instance. Every GitHub inputSchema and description preserves its parsed source order and values; names become `mcp__github_primary__<name>` or `mcp__github_secondary__<name>`. Seven output-only snapshots were excluded; three duplicate-name variants were deduplicated, preferring canonical `<name>.snap`.

The fixture has 137 distinct input schemas, 194,619 compact input-schema bytes, 276 object schemas, 63 arrays, 212 enums, 11 anyOf and 12 oneOf nodes, 1,330 declared properties, and maximum object nesting depth 4. These counts include the explicitly duplicated second-instance schemas. Native `read` is available with public `filePath`, `offset`, and `limit` fields. No inference, accounts, tokens, user configuration, SDK transcripts, or actual client requests were used.

This is a realistic constructed client-consumable schema workload, not a captured reporter catalog. The GitHub snapshot set can include conditional/deprecated tools; it does not prove one default server advertises all 131 at once. Eleven selected native tools do not constitute the full installed OpenCode roster. Native descriptions are public source templates, without expanding installed agent or skill metadata. Existing Meridian committed OpenCode V1/V2 request fixtures omit tools; the 80-tool roster script uses intentionally empty synthetic schemas and was not used.

## Reproduction and source provenance

Per-tool public source URLs and source SHA-256 values are in `client-derived-230-tools.provenance.json`. Public source files are escrowed under `public-schema-sources/`. The source-only downloader is optional; generator operation is offline once those sources are present.

```sh
node download-public-schema-sources.mjs
node generate-client-derived-230-tools.mjs /Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe
```

The measured generator runtime was stock Node v22.22.3, TypeScript 5.9.3, and Effect 4.0.0-rc.111 from the existing repository installation. `generate-client-derived-230-tools.mjs` takes a module-root argument containing those dependencies. It extracts only public schema constant declarations, evaluates real Effect Schema objects, and applies the unmodified public OpenCode `ToolJsonSchema.fromSchema` converter. Native task uses default foreground `BaseParameters`, matching disabled experimental background mode. The `read` NonNegativeInt helper is copied exactly from the same pinned public shared schema source.

A later source-package check found OpenCode v1.18.34 pins Effect 4.0.0-beta.83. A separate isolated runtime was installed, without modifying repository dependencies:

```sh
npm install --prefix fixture-generator-runtime --ignore-scripts --no-audit --no-fund --save-exact effect@4.0.0-beta.83 typescript@5.9.3
node generate-client-derived-230-tools.mjs ./fixture-generator-runtime client-derived-230-tools-effect-beta83
```

The isolated runtime's package.json and package-lock.json are preserved. The exact-beta fixture is separate: `client-derived-230-tools-effect-beta83.json`, SHA-256 `0ce74a63b41e61bbab5b5c756fc39ad8226356e649137980906a688d114ea145`. The measured fixture was preserved byte-for-byte. All parsed values and field-map orders are identical. Only the JSON keyword-map insertion order of native `lsp`'s `line` and `character` schemas differs: rc.111 emits `[minimum,type,description,maximum]`, while beta.83 emits `[minimum,description,type,maximum]`. `fixture-effect-version-comparison.json` records both exact paths and hashes. Thus the measured workload retains the same structure and schema complexity, but its two keyword maps are source-derived using a newer converter runtime rather than a byte-exact installed-client capture. Neither fixture proves a reporter client/version/model/platform.

## Independent heap harness review

Reviewed `heap-worker.mjs` and `run-heap-proof.mjs` read-only. The baseline/current workers use production stock Node with external real SDK/Zod packages, the same fixture bytes, the same cloned raw tools retained in independent session caches, twelve strongly retained built-catalog owners, and twelve-entry LRU eviction. They admit 48 identical catalogs overall, then 36 distinct revisions under a separate four-owner limit. Event-loop turns separate explicit GC. The harness correctly makes no assertion about immediate weak-target/finalizer cleanup. A 512 MiB old-space limit and 480 MiB post-GC soft sample bound constrain the retained baseline workload; this is not a thousand-session or whole-proxy/process memory claim.

Two concrete findings were sent to the parent for correction/qualification:

1. The runner initially compared fixture SHA only, without asserting baseline/current serialized catalog hashes equal. Add cross-version equality per catalog index so changed emitted catalogs cannot pass solely because each version matches its own clone.
2. The catalog variant comment initially said root/nested insertion order changed, while code changed description only. Correct the comment or explicitly implement a separate order control. The current independent catalog/fork test is not native session/checkpoint/fork-history evidence, as its limits already state.

No harness edits were made by this reviewer. Parent owns subsequent corrections and actual execution results. Real affected-client live E2E, history/cache continuity, E41 four modes, and V2 extended flow remain separate gates from this offline schema/heap proof.

Both public source repositories use the MIT license. Exact pinned license texts are preserved in `public-schema-sources/LICENSE-opencode.txt` and `public-schema-sources/LICENSE-github-mcp-server.txt`; retain these notices when copying the source-derived fixture and source escrow.

Follow-up inspection confirmed both harness findings were corrected: the description-only comment is accurate, and the runner now compares all four serialized baseline/current catalogs. I independently rechecked the saved PASS receipts and all four hash equalities without rerunning heap or model work. The definitive final independent harness report is `heap-harness-review.md`.
