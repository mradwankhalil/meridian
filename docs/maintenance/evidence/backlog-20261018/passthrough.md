# Passthrough backlog review — 2026-10-18

Read-only review against current `origin/main` `095b4869b5fe386e2f3a273cc5b60ec3853c8659` in `/private/tmp/meridian-pr1409-20261018`. No repository changes, comments, merges or live model calls were made. The worktree remained clean. Read full diffs, both one-commit histories and bodies; both PRs and both issues have no comments/reviews. Read AGENTS.md, architecture and API boundaries, contribution/incorporation/verification/evidence instructions, current handoff header and applicable E2E requirements. Main handoff has no existing entry for these four numbers.

## PR #1410 — accept with maintainer correction, evidence gate open

- URL: https://github.com/rynfar/meridian/pull/1410
- Head: `d74048e4f9101abbdb269cac721f7e709470a6c2`; author `Nowaker <spam@nowaker.net>`; authored 2026-10-18T23:30:47Z; signed/verified. Current base equals main above. GitHub reports CLEAN, maintainer edits enabled; all applicable checks, including `test`, pass on this exact head.
- Product fit: valid bounded optimization. Identical client tool catalogs currently allocate a complete Zod definition tree for every session; sharing pure built definitions while constructing a new SDK MCP transport for each query addresses the described multi-GB memory growth without sharing tool execution, permissions, or sessions. The key includes namespace, resolved auto-defer/pinned behavior, core tool names when relevant, names, descriptions, explicit defer flags and schemas. It does not introduce session/server imports into a leaf. No public API contract changes.

### Confirmed P2: the sharing key merges different model-facing schema order

At `src/proxy/passthroughTools.ts:385` on the PR head, `stableStringify(tool.input_schema)` canonicalizes object property insertion order. The actual builder (`objectShapeFromJsonSchema` and declared-schema rendering) preserves it. A global cache hit can therefore substitute another session's differently ordered catalog, contrary to the claim that a shared set is exactly what a fresh build would produce.

Reproduced without modifying the checkout or calling a model: fetched the exact candidate file through the GitHub contents API, transpiled/evaluated it in memory, and used the real installed Agent SDK **0.2.141**, Zod and MCP Client/InMemoryTransport under **Bun 1.3.14, macOS arm64**. Build A with root properties `{a,b}`, then B with `{b,a}`; both schemas otherwise identical. Compare B's shared server with a fresh B build:

```json
{"sharedObject":true,"independentTransports":true,"sharedProperties":["a","b"],"freshProperties":["b","a"],"serializedCatalogEqual":false,"secondUnaffectedByClose":true}
```

The exact key-order collision can make B's prompt depend on which other session populated the process cache first. Restarting with B alone rebuilds a different model-facing catalog and may invalidate prompt-cache reuse that was stable for B before the optimization. This is an output/cache compatibility defect, not a tool permission bypass.

Small correction: hash schemas with insertion-order-preserving JSON serialization for this new shared cache, and add a regression comparing differently ordered property maps (including nested maps). Keep existing per-session `computeToolSetKey` behavior unchanged unless separately justified. Alternatively canonicalize the actual builder everywhere, but that changes established model-facing prompts and has a broader validation burden. Sharing repeated identical OpenCode requests still works with an insertion-sensitive key.

### What survived adversarial inspection

- Shared object retains only definitions/aliases, not request-specific hooks, auth, profile state, SDK session IDs or execution closures. Definitions' handler is the same passthrough no-op, so client permission decisions remain in each request's existing hooks/client.
- `createServer()` still makes a distinct SDK server per query. The real in-memory protocol probe connected both servers concurrently, listed equal catalogs, called the client tool, then closed A and successfully listed B again. No shared-transport regression was found.
- FinalizationRegistry cleanup checks the current weak reference before deleting, so an old finalizer cannot remove a replacement live set. Both the global index and cleanup held values retain digests rather than strong catalog references. Collection timing remains nondeterministic; the optimization does not require immediate collection.
- A pre-existing limitation remains: the per-session `computeToolSetKey` ignores descriptions, so changing only descriptions on an existing session bypasses this new digest entirely. That is not introduced by #1410, but the PR's full-content key does not fix it.
- New tests prove reference reuse at the mocked server boundary; they do not measure retained heap or exercise the new sharing function with real SDK transports. Existing real-SDK per-query tests support the unchanged factory, and the offline review probe additionally exercised the candidate sharing path.

### Required completion gates

After correction: focused sharing/defer/alias/schema/per-query tests; `npm test`, standalone typecheck and build; all final-head CI. Escrow a reproducible before/after heap harness with the same realistic 230-tool fixture and bounded session-cache churn rather than retaining only the contributor's 3,117 MB → 108 MB prose measurement. Check heap plateaus after eviction and catalogs remain complete across concurrent sessions, different schemas, namespaces, descriptions and defer policies.

Behavior acceptance still requires real implicated OpenCode + Claude SDK/native CLI + actual served model, with matching Meridian client plugin preflight and runtime witnesses. Run E41's four chain/parallel × JSON/SSE modes through the documented qualified plugin host and actual-client qualification, and E42 extended V2 when applicable. Preserve catalogs/tool pairing, independent sessions, durable checkpoint/fork history and prompt-cache continuity. No such live success is established by this review; exact reporter platform/model were not supplied in the PR and must not be invented. Actual memory-source comparison and sanitized durable evidence belong in the separate maintainer evidence PR under the contribution rules, not an unrelated co-authorship-only commit on the contributor branch.

## PR #1406 / issue #1405 — accept with maintainer corrections, live gate open

- PR: https://github.com/rynfar/meridian/pull/1406; issue: https://github.com/rynfar/meridian/issues/1405
- Head: `2bc993579163ee81308e9c842c483b9b1a965b86`; author `Mohamed R. Khalil <m.radwan.khalil@gmail.com>`; authored 2026-10-17T20:25:53Z. Current base equals main above. All applicable CI including `test` passes on the exact head. GitHub reports BLOCKED and the commit is unsigned; maintainer edits are enabled. Verify unsigned commits are the *only* protection block before using the workflow's narrowly permitted `--admin` exception.
- Product fit: the client owns passthrough tools, so host filesystem hooks/plugins/native MCP tools are foreign to that environment. Forcing `settingSources: []` plus `strictMcpConfig: true` removes sources that `plugins: []` alone does not disable. Non-passthrough sources and explicit SDK hooks, system context, inline memory flags, preset selection and tool-search settings remain. No exported proxy/header/route contract is modified. This does not expand execution permissions.
- The fresh-session loopback gate is meaningfully stronger than a model choosing one tool: it examines every actual SDK/native CLI serialized request, requires client context and exactly the client tool, rejects hook guidance and foreign declarations, and owns/joins child processes and the listener. Baseline restores the former option expressions so it can establish a red control. It correctly disclaims real model/OpenCode acceptance. I inspected it but did **not** execute it; local full tests were also not run in this read-only checkout.

### Required maintainer correction: user-visible configuration truth

The behavior intentionally makes `claudeMd: project/full` and `MERIDIAN_LOAD_CONTEXT` ineffective for *every passthrough adapter*. Existing main tests explicitly documented this as a user opt-in, so this is a visible behavior change, not merely an implementation detail. E2E.md and PR prose disclose it, but the actual settings UI at `src/telemetry/settingsPage.ts:295` still promises Project/Full loading without mentioning passthrough, `AdapterFeatures.claudeMd` documents the unrestricted behavior, and `src/proxy/adapters/crush.ts:112` claims CLAUDE.md is loaded through these sources in passthrough.

Update the setting's helper text to explain the passthrough limitation/client-supplied instructions, plus relevant internal comments/types. Avoid an inert setting that still claims to work. This can be done without a new public interface or approval flow. Preserve the explicit caller opt-in for non-passthrough and prove it remains effective.

### Remaining evidence/edge gates

1. Run the committed native SDK/CLI loopback gate on unchanged expressions and candidate with an explicit real executable; retain both failure and success, CLI/SDK versions and joined-cleanup witnesses. A source checkout's non-executable Claude fixture is not a valid native binary.
2. Add a resumed-session control. Current harness creates only a fresh SDK session. It does not establish whether SessionStart context already persisted under the baseline disappears when a contaminated session resumes with candidate options. If old guidance remains, record the need for a fresh session or implement a bounded safe transition; do not claim existing conversations are purified. Check allowed client-tool and memory/preset behavior during ordinary continuation too.
3. Run an actual unguided OpenCode native child through the implicated Claude family, with the generation-matching Meridian client plugin installed by the tested package's setup command. Retain effective config/plugin identity and load witness, API prefix/route, plugin-generated session/agent headers and signed turn witness where required. Assert its emitted tool name belongs to the client catalog and inspect supported SessionStart context. A scrub plugin alone, manual headers, direct SDK fixture, or one lucky model choice is insufficient.
4. Run the applicable E41 four-mode matrix and V2 E42 extended/control cases, including unrelated non-passthrough source loading, concurrent sessions, deferred ToolSearch and error/cancellation controls. Then full local and exact final-head CI gates. Do not close #1405 until affected-flow proof supports it.

## Issue #1404 — independent session/system-prompt bug, remains open

URL: https://github.com/rynfar/meridian/issues/1404. Reported: OpenCode **2.0.31**, generation-matching `meridian-v2`, Meridian **1.82.0 Arch / 1.83.0 Debian**, native Claude Code **2.1.301** on Debian, **claude-haiku-5-5**, OAuth/Max. Same primary client session switches from build to a custom `mode: all` reviewer with a randomized canary system prompt. With plugin/session resume the model retains the old prompt; fresh reviewer session works. Without plugin succeeds only because session continuity differs, so disabling the required plugin is not a valid supported fix.

Neither #1410 nor #1406 addresses this mechanism. OpenCode adapter intentionally keeps a primary agent's raw session key (`adapters/opencode.ts:145-153`), even when primary agent name changes. The plugin maps `mode: all` to primary. Session state/lineage hashes message content and fingerprint deliberately excludes top-level dynamic systemContext (`session/fingerprint.ts:39-46`); tests at `session-fingerprint-context.test.ts:151+` explicitly require resume as systemContext changes. `server.ts` extracts systemContext each request and passes it into buildQueryOptions next to resume. Static inspection therefore supports investigating actual SDK/native resume prompt handling; it cannot prove the exact dropping layer.

Do **not** fix this by hashing every system prompt into session identity or treating every changed primary agent as an unrelated subagent: routine dynamic environment changes must preserve resume/cache and hidden/title/compaction isolation. Establish the serialized resumed model request first, then design a stable agent-transition or supported prompt-update path at the adapter boundary while preserving single-conversation history and client permissions.

Required issue-specific proof: reproduce baseline on the actual reported OpenCode version/platform/native CLI/Haiku route with the matching Meridian V2 plugin and full preflight witnesses; preserve the random-canary before/switch/after request and model observation, a fresh-reviewer positive control, ordinary dynamic-context continuation, tool permission controls and switch-back. Current documented supported stable client list includes 2.0.16/2.0.21; qualify 2.0.31 rather than silently substituting a pinned older client or bypassing setup's support check. No actual #1404 runtime reproduction was performed in this review. Its shared interest with #1406 is that already-resumed session context may outlive source-option changes; that relationship is an extra gate, not evidence either PR fixes agent switching.

## Merge/communication boundary

Parent owns linking, corrections, live work and dispositions. Merge each contributor's **own PR** after corrections/checks with `--squash --match-head-commit`, preserving verified authorship on main. Re-read live head/base before any merge. No release is authorized. No external comment/review was posted. This record preserves the review-stage findings. See README.md for subsequent correction and validation status.
