# PR #1410 independent correction review

Reviewed head `423477f19812b08e15d332d4f7c9c91ebf4e8650` against contributor source `d74048e4f9101abbdb269cac721f7e709470a6c2` and main `095b4869b5fe386e2f3a273cc5b60ec3853c8659` in `/private/tmp/meridian-pr1410-correction-20261018`. The live GitHub PR reports this exact head and unchanged base. Read-only review; checkout remained clean. No tests, model calls, external comments or repository mutations were performed in this round. `git diff --check` on the correction passed.

## Disposition

**The prior P2 schema-order finding is resolved. No new material code or test finding survives this correction review. Accept the minimal correction at code-review level; PR acceptance/merge remains gated on the parent's outstanding verification and exact-head CI.**

The correction changes only `src/proxy/passthroughTools.ts` plus the existing real-SDK per-query test file. It leaves contributor commits intact and does not broaden scope into session identity, execution permissions, schema construction, SDK query hooks or the older per-session cache key.

## Why the correction fixes the finding

`passthroughTools.ts:387` now uses `JSON.stringify(tool.input_schema ?? null)` for the global shared-definition digest. For actual JSON request objects, this preserves the property iteration order that `objectShapeFromJsonSchema` and declared-schema rendering preserve, including nested property maps. Two requests whose serialized schemas differ in insertion order therefore no longer select the same shared set. Repeated byte-equivalent schema objects still share definitions, including independently cloned objects. Numeric property names follow JavaScript's normal enumeration order both in serialization and the builder, so no new discrepancy is introduced there.

The rest of the key is unchanged: namespace, resolved auto-defer decision, effective core names, tool names, descriptions, explicit defer flags and tool-list order remain separated. The replacement avoids canonical sorting in this one cache; it does not weaken any content distinction the builder reads. It may retain separate sets for semantically equivalent schema serializations, which is the deliberate compatibility tradeoff required to preserve exact model-facing catalogs. The originally reported repeated OpenCode tool-list case retains sharing.

The global WeakRef/FinalizationRegistry ownership and replacement-safe cleanup remain unchanged. Each query still calls the original factory to allocate its own MCP server/transport. Request-specific permissions, profiles, session IDs, cancellation state and hooks are not introduced into the shared definitions. No public API or module boundary changes were added.

## Regression tests are discriminating

The new cases at `src/__tests__/passthrough-mcp-per-query.test.ts:32-78` inspect the real SDK MCP `tools/list` wire output in child processes isolated from global SDK mocks:

- Separate root-property and nested-property fixtures cover both places the builder retains insertion order.
- Each fixture starts with `[a,b]` and then `[b,a]`, and repeats the converse under a separate namespace. The first loop cannot seed the second loop's cache, so both population orders are genuinely exercised.
- They verify that the fresh builder retains the declared reverse order, then compare **serialized catalogs**, rather than relying on deep object equality that ignores key order. They also assert the shared result's explicit property key sequence.
- Under the old `stableStringify` implementation, the first and second calls in either namespace collide; the second shared catalog retains the first caller's order and fails the serialized shared-versus-fresh comparison at line 64 and the explicit key order check at line 65. These assertions therefore fail when the original defect remains. Both root and nested cases discriminate independently.
- Structured clones of each schema must return their own cached object, so the tests also detect disabling sharing as a supposed fix.
- Four created server instances must be distinct. All are concurrently connected; closing the A server and one B server must leave a second B server's complete catalog unchanged. That exercises both distinct-content sets and same-content shared definitions without sharing transports.
- The source tool arrays must remain serialized identically after registration. All created clients and servers close in `finally`.

Existing tests in the same file still cover options-builder transport isolation, alias collisions, required validation/handler behavior and shared-set concurrent connection. The original PR's server-level sharing/defer/content-sensitivity tests are unchanged. This review establishes that their assertions target the reported defect; it does not claim a fresh test execution.

## Gates still open

At the live status read during this review, `test`, Docker smoke and Windows smoke were still running for head `423477f1`; attribution, Nix and desktop builds had succeeded. Earlier-head green results do not validate this head. Parent owns waiting/rechecking these gates and any applicable remaining local checks.

The original live OpenCode/Claude acceptance, generation-matching Meridian client-plugin preflight/runtime witnesses, reproducible heap comparison and E41 four-mode coverage remain explicitly open. This source correction and the real-SDK protocol unit tests do not replace them. No merge or release is authorized by this review report, and no claim about memory improvement or affected-client live completion is added here.
