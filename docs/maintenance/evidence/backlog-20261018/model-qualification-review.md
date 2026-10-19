# PR #1410: bounded static review of E41 model qualification

## Result

**The E41 exact-model gate remains unresolved and failed. No new source defect or causal explanation has been established.** The saved supported-history message payloads contain Opus 5.5 for the first two calls and Opus 4.8 for the third round's thinking/tool-use fragments. This is stronger than a model name guessed from prose, but it does not independently identify the provider's raw response model or explain why it differs.

Three corrections qualify the earlier wording:

1. Meridian passes the alias `opus[1m]` **and** a per-request explicit environment pin `ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5-5`. Saying merely “alias rather than numeric pin” leaves out a meaningful part of the routing path.
2. Agent SDK 0.2.141's supported `getSessionMessages` projection drops the top-level `isApiErrorMessage` field (and other nonprojected fields). The supplied receipt's `isApiErrorMessage: false` values therefore cannot show that the original underlying flag was false. HTTP status/content and actual SDK error/result events are separate evidence.
3. Meridian's JSON `/v1/messages` response sets `model: body.model`, echoing the requested model. Capturing the omitted third **Meridian HTTP response** model would not establish which model served it. The missing relevant observation is the pre-Meridian SDK/native response identity, and ultimately the provider API response model if the SDK/native serialization itself is disputed.

No new inference, SDK query, access diagnostic, credential/account read/change, private transcript inspection, source edit, external mutation, or model rerun was performed. Only public installed source and the specified sanitized reports were read. The correction checkout remains clean.

## Evidence scope

- Runtime source inspected: `/private/tmp/meridian-pr1410-correction-20261018`, HEAD `423477f19812b08e15d332d4f7c9c91ebf4e8650`.
- Main comparison: `095b4869b5fe386e2f3a273cc5b60ec3853c8659`; later main `f81d9d8db` changes policy only (`git diff --name-only 095b4869..f81d9d8db -- src package.json bun.lock` is empty). This is not a new product/runtime test.
- Read `/tmp/meridian-1410-live-result.md`, escrowed `e41-model-annotation-supported-api.json`, `e41-chain-json-fail.json`, `e41-chain-json-fail.log`, `qualified-e41-signed.mjs`, `reproduction-commands.txt`, `live-subagent-end-state.json`, and the sanitized actual-V2 model/result fields. Also read parent-supplied `/tmp/meridian-1396-live-result.md` only; no underlying #1396 transcript/harness state was reopened.
- Installed `@anthropic-ai/claude-agent-sdk` is 0.2.141. The inspected correction's `sdk.mjs` and the actual E41 task checkout's installed `sdk.mjs` have identical SHA256 `48bde6aeabf7e71ad5528bf52c8feb1642c21f505ea2495c70f39db7df226d97`. Minified symbol/byte anchors below refer to those exact public package bytes, not an inferred native CLI implementation.
- The reporter's exact client/model/platform remain unspecified. The successful actual OpenCode 2.0.21 / native CLI 2.1.302 / SDK 0.2.141 / Opus 5.5 / Darwin arm64 arm is a qualified local result. The failed E41 arm is a V1-plugin protocol host, not an actual OpenCode executable. Neither should be generalized to the reporter's unknown installation.

## Routing and pin provenance

At `src/proxy/server.ts:2591–2615`, the string `body.model` is captured as `requestedModel`, mapped to a Claude alias, and separately processed by `explicitModelPin`. For `claude-opus-5-5`, `src/proxy/models.ts:108` deterministically returns `{ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5-5"}`. `mapModelToClaudeModel` at `models.ts:248` chooses `opus[1m]` for the eligible primary request; `stripExtendedContext` at `models.ts:498` only changes `opus[1m]` to `opus`, not 5.5 to 4.8.

`server.ts:2697–2700` builds the profile environment from canonical defaults, clean inherited environment and selected profile environment. `src/proxy/query.ts:655`, `:713` pass the alias as `Options.model`; `query.ts:874` spreads `ctx.envOverrides` **last**, so the explicit per-request numeric pin takes precedence over an inherited/profile default. The main nonstream attempt (`server.ts:4507`), resume replay and context-fallback attempts also pass the same `envOverrides`. The correction does not alter these paths. `query.ts:877–890` attaches resume/fork/checkpoint options independently from model pinning. Configured `fallbackModel` is passed only when truthy (`query.ts:897`); the default in `sdkFeatures.ts` is empty. The supplied E41 record does not retain effective per-attempt fallback settings, so the default alone is not a runtime witness that every optional setting was absent.

The public SDK `ProcessTransport.initialize` at `sdk.mjs` byte ~300300 destructures the requested model/environment, emits `--model <alias>` at byte ~301412, and adds `--fallback-model` only for a supplied fallback at byte ~302838. It does not resolve `ANTHROPIC_DEFAULT_OPUS_MODEL` itself in this transport; the native CLI receives the environment. Meridian's `src/proxy/session/sdkProcessGate.ts:58–66` serializes the exact SDK `SpawnOptions` environment/command into its owned gated launch, and `server.ts:1157` installs that spawn callback before calling `query(params)`. No alternate 4.8 assignment was found in the inspected Meridian request/query/session path.

**Limit:** these are code-path expectations, not recovered E41 runtime spawn arguments/environment. The failed E41 receipt records child closure but not a sanitized effective model/selected env-key witness for each spawn. The system native CLI is 2.1.302 per retained reports; the correction's dependency package metadata for `@anthropic-ai/claude-code` is 2.1.296 and must not be treated as the running native implementation.

## What the supported history reader does

The SDK's documented `getSessionMessages` (`sdk.d.ts:670–708`) reads a saved conversation chain, not a model endpoint. `SessionMessage.message` is `unknown` (`sdk.d.ts:3730`) and is not documented as independently verified provider identity.

At the exact installed `sdk.mjs` bytes:

- Export `GA$` / `getSessionMessages` at byte **855715** dispatches to `MZ` for the filesystem path, or `d6$` for a supplied SessionStore.
- `MZ` at **344005** resolves the requested session/project, reads it, parses it through `Ng`, then calls `ZZ`. This inspected reader has no model-name memoization or default-model substitution.
- `wg` at **340543** reconstructs the parent chain, handles preserved compaction segments and chooses the most recently appended eligible main-conversation leaf. `Dg` at approximately **342326** restores split assistant fragments sharing `message.id` and related result rows outside the selected parent chain.
- `Fg` at **343212** filters meta/sidechain/team rows. `CH` at **343394** returns this projection, preserving the stored `message` object unchanged:

  ```js
  { type: row.type, uuid: row.uuid, session_id: row.sessionId,
    message: row.message, parent_tool_use_id: null, timestamp: row.timestamp }
  ```

Consequently **the reader does not manufacture `claude-opus-4-8` from the currently requested alias or a local model-default cache**. The value originates in a persisted `message` payload that the reader selected. This does not tell us whether the native writer originally obtained it from the provider, copied it from earlier metadata, or used a reconstruction/default path.

It also explains the API-error caveat: `CH` does not project `isApiErrorMessage`, `error`, `parentUuid`, `forkedFrom`, `isSidechain`, or other original top-level fields. The supplied receipt's listed keys exactly match `CH`. A test of the missing projected field defaulted to `false` provides no evidence about its source value. Runtime `SDKAssistantMessage` has a supported optional `error` (`sdk.d.ts:2461`) and result messages expose `is_error`, subtype and `modelUsage` (`sdk.d.ts:3290–3330`); none of these raw E41 per-attempt observations is present in the supplied model-metadata receipt.

### Could it be fork or stale metadata?

Inherited model annotations in forked histories are possible in principle: a new request's pin cannot retroactively change an earlier assistant response's identity. The public SDK `forkSession` helper `yZ` at approximately byte **353050** copies each source entry with `{...entry, ...new identity fields}`, preserving `entry.message`. This helper is **not** claimed to be the native `query(... forkSession: true)` implementation; Meridian passes that flag to the separate CLI. It simply demonstrates why historical fields are not equivalent to the current query's model setting.

SDK reader reconstruction can also return multiple fragments for one assistant API message. The separate third-round thinking/tool-use rows therefore do not by themselves imply two model requests. Their shared `message.id` was not included in the sanitized receipt, so fragment grouping cannot be verified from it. Likewise the supplied receipt omits timestamps and per-fork source→target mapping/ownership metadata, so stale/copied-ancestor versus newly appended-row provenance cannot be fully reconstructed offline from this summary.

However, the owned session was new, prior captures passed the all-5.5 check, and the later active history introduces 4.8 next to the third delivered call. That makes the mismatch meaningful; it must not be dismissed as “just normal old history” without an actual UUID/message-id/source-snapshot comparison. No such comparison proving that explanation is available in the supplied records. SDK reader-level caching/default substitution is not a supported explanation from the inspected source.

## What the wire fields can establish

`src/proxy/server.ts:5417–5420` returns nonstream JSON with `model: body.model`. The same request echo is used in the streaming synthesis path at `server.ts:6620`. `scripts/lib/e41-assistant-response.ts:21` intentionally extracts only blocks/usage; the E41 wrapper discards the other parsed JSON fields, and its failure catch does not persist the raw response. Thus merely retaining the missing outer HTTP `model` would confirm the request label, not the native/provider model.

The installed SDK's native `ProcessTransport.readMessages` at byte **306834** parses native stdout JSON and yields it; `Query.readMessages` at **314217** enqueues ordinary messages without rewriting their model payload. The SDK itself therefore provides a useful earlier boundary: native `stream_event.event.message.model` at message_start, `assistant.message.model`, `system/init.model`, `result.modelUsage`, and model/fallback lifecycle events, correlated by request/session/assistant/message/tool IDs. An SDK init model is the chosen native configuration; it is not necessarily each generated response's identity. A native SDK assistant model is stronger than Meridian's request echo, but if the native writer itself misannotates/reconstructs responses it still does not independently prove the provider's raw model.

Parent-supplied #1396 sanitized report already records **live SDK assistant events and supported histories**, not just saved-history fields: both baseline and candidate receive literal `claude-fable-5-1` requests and Fable SDK init, but queries 1–4 carry Opus 4.8 assistant labels while answer queries 5–6 carry Fable 5.1. This is useful evidence that the broader mismatch is present on unchanged main and outside #1410's cache change. The correlation with tool/checkpoint versus answer queries is an observation, **not** proof of a native serialization bug, provider fallback, account state, or a cause for cache ratios. The exact Opus E41 failure still lacks the earlier event/response boundary; the Fable evidence does not supply it retrospectively.

## Relation to #1410

The source diff changes sharing of built MCP tool definitions in `src/proxy/passthroughTools.ts:347–401` and the server's builder selection at `server.ts:4120`. Each query still calls `createServer()` for its own real SDK server (`passthroughTools.ts:336`). The shared object contains definitions, aliases, deferral flags and a server factory, not model IDs, conversation messages, session transcript payloads or query options. Its content hash has no request model because the definitions are not model state. No direct path from this new shared-definition cache to `assistant.message.model` or the environment pin was found.

That static result plus the #1396 baseline observation prevents attributing model drift to #1410 on current evidence. It is not causal proof that #1410 cannot influence any runtime behavior, and it does not close its E41/E42 acceptance gates. The three successful E41 read-call deliveries and cache-floor checks before the stop remain partial facts, not a full chain pass.

## Minimal checks without another inference

Already completed in this task: source/SDK hash identity, explicit pin/precedence tracing, response echo tracing, supported-reader projection/reconstruction tracing, #1410 changed-path separation, and comparison to the supplied #1396 sanitized report.

Useful remaining **offline/non-inference** checks, if the already retained sanitized event records exist:

1. Match the third E41 tool id and assistant UUID against any saved native SDK `assistant` / `stream_event` metadata; compare `message.id`, model, request sequence, served session and timestamps. Do not reopen private transcript files or silently read full conversation payloads. The supplied E41 wrapper/report does not retain these raw observations, so absence must remain explicit unless another sanitized receipt is found.
2. Compare the previous saved fork snapshots and the final active fork by UUID/message-id/model only, distinguishing copied ancestors from newly appended third-round rows. The wrapper's `sourceSnapshots` map was in memory; its failure report did not escrow that map. The single supplied final metadata snapshot cannot substitute for it.
3. A synthetic in-memory `SessionStore` test of public `getSessionMessages` could confirm unchanged model payloads and dropped flags without private filesystem access or `query()`. This would validate API interpretation only; it cannot explain the live 4.8 observation. No such test was executed here because the source establishes the projection directly.
4. Pure/mock checks of `explicitModelPin`/`buildQueryOptions` for the exact Opus request, resume/fork flags and context fallback can protect the intended pin and verify last-spread precedence without spawning the native CLI. They establish configuration semantics, not served-model identity. Do not create a model-access diagnostic to perform them.

**Missing evidence that cannot be recreated statically:** actual third Opus native SDK response model/message-id metadata, effective per-attempt model/fallback/safe model-env values, source/target fragment provenance, and independent provider API response identity if native annotations are in dispute. A later authorized bounded live gate would need to retain those observations at the correct boundary before interpreting another mismatch; this report does not authorize that run or a source fix. Keep the current failure, unrun matrix modes, cache qualifications and extended V2 gates open. No credential/account diagnosis is justified.
