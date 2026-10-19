# Meridian PR review: #1407 and #1403

Reviewed 2026-10-18 in delegated read-only scope against fresh `origin/main` `095b4869b5fe386e2f3a273cc5b60ec3853c8659`. No user checkout changes, branches, comments, merges, or live model calls. PR refs fetched into `refs/review/1407` and `refs/review/1403` only. This review is preserved in this evidence directory; temporary paths below identify supplemental local artifacts, not acceptance evidence.

## Disposition

- **#1407 — accept as proposed in product/code scope; hold acceptance/merge for required local and affected-flow evidence.** Head `290ddf6d1903b91794d5e38c9617b7effb58ab26`, contributor Tristan Cartledge (@TristanSpeakEasy). URL https://github.com/rynfar/meridian/pull/1407 . Four changed files, +137/-1. No material code blocker found.
- **#1403 — accept as proposed in product/code scope; hold acceptance/merge for required local and affected-flow evidence.** Head `9fec9a337681732789a9475dee5f4b0fe15dd94e`, contributor Muzhen Gaming (@XInTheDark). URL https://github.com/rynfar/meridian/pull/1403 . Four changed files, +152/-18. No material code blocker found.

Both are based exactly on the reviewed current main (merge-base equals `095b4869...`), are GitHub `MERGEABLE`, and have all relevant published checks green, including `test`, authorship, Windows smoke, both desktop builds, Nix and Docker smoke/build. Both have `mergeStateStatus: BLOCKED`, one unsigned contributor commit, and maintainer edits enabled. Live branch protection is signatures enabled, no required review or required-status entries, no branch rulesets. This supports the documented unsigned-commit-only exception **only after all repository evidence gates are satisfied**; it does not override missing live E2E. Preserve authorship by merging each contributor's own PR; any necessary fix goes on that branch as a separate signed commit. Evidence/harness work belongs in a separate maintainer PR.

All pages of each PR's commits, issue comments, inline comments and reviews were read through `gh api --paginate`. Each has one commit and no discussion/reviews. No extra changed files hidden beyond the full published diffs. `git diff --check origin/main...refs/review/<N>` passes for both.

## #1407: mid-stream OpenAI chat errors

### Product fit and falsification

This fixes an established compatibility defect rather than adding another backend/contract surface: `/v1/chat/completions` currently strips the real Anthropic in-band failure and exposes only the synthetic `finish_reason: "length"`. A client with truncation recovery then repeats a refused turn. Forwarding the standard `{error:{...}}` data chunk is appropriate. There is no change to ProxyConfig, lifecycle, headers, health/profile routes, or the `/v1/messages` contract.

Read the complete patch and relevant callers in `openai.ts`, `/v1/chat/completions` orchestration, `terminateFailedStream`, the shared stateful SSE translator, usage terminal framing and cancellation. The new pure helper remains in the translator module; server code remains orchestration. It checks error type before the ordinary translator, preserving retry fields and filling sane type/message defaults. Existing translator return types and the independent Antigravity backend remain unchanged. The extra `code` intentionally mirrors Anthropic `type`; it is not an accidental loss of an existing OpenAI code in this internal Anthropic path.

One adversarial question was whether emitting the error *after* the length finish would still be dropped by the reported client. Inspected the actual [`reefbarman/agentlink` stream parser](https://github.com/reefbarman/agentlink/blob/e9d96f335cb3fcaa7577f0648f041534ef6b7e39/packages/core/src/openAiCompatible/streamParser.ts) and [error classifier](https://github.com/reefbarman/agentlink/blob/e9d96f335cb3fcaa7577f0648f041534ef6b7e39/packages/core/src/openAiCompatible/errors.ts), current main `e9d96f335cb3fcaa7577f0648f041534ef6b7e39`, through its GitHub contents API. `packages/core/src/openAiCompatible/streamParser.ts` checks `chunk.error !== undefined` before choices and throws its typed in-band request error; a finish reason is retained until the chunk iterator finishes, rather than breaking the stream. `errors.ts` classifies rate-limit/overload/auth from the mirrored code/type. Thus this ordering reaches AgentLink's error path. This is source inspection, **not** an executed AgentLink E2E or evidence about the reporter's unspecified installed AgentLink version.

The existing synthetic `length` finish remains intentional; the patch does not change other clients that ignore errors. `[DONE]` and optional usage are still emitted after the error, as existing framing does. Clients correctly honoring in-band errors stop with that error. Already-broken raw reader/transport exceptions remain a separate pre-existing issue: the outer loop catches them and closes without a new in-band error. This patch neither introduces nor claims to fix that path.

### Regression coverage and limitations

New helper tests cover non-errors, typed error, retry hints, and absent/string malformed errors. The HTTP test replaces only the internal `/v1/messages` response with the actual failure frame sequence (`message_start`, partial content, `max_tokens`, `error`, `message_stop`) and asserts the error reaches the outer client after the length chunk. It would fail without the server change, unlike a unit-only translator assertion. Existing suite covers success, usage, thinking and per-block tool argument routing. No new process-global state or concurrency changes.

The contributor reports 180 focused tests plus typecheck, explicitly no local full `npm test` and no live E2E. Published CI test check is green, but the reviewer has not independently executed local tests/build in this read-only task. Parent must run `npm test`, `npm run typecheck`, `npm run build` on the final accepted head and refresh CI/head before merge.

### Exact next verification

- E26 ordinary streaming control using **the implicated Opus model** and actual AgentLink OpenAI-compatible backend/parser version (record version/SHA), not merely Haiku/curl. Verify partial content and final clean stop/DONE remain ordinary on success.
- Reproduce a real mid-stream failure on unchanged main with real SDK/CLI and same Opus/client path, then on the PR. Assert baseline is observed as truncated/length and final raises the real typed error without automatic continuation/resending. Save chunk/event order and request count, sanitized.
- A real safeguard refusal cannot be deterministically demanded. A useful reproducible headless stand can run an isolated real Opus request through AgentLink's backend/parser, wait for actual partial text, and terminate **only the harness-owned Claude child PID** before completion, forcing the real SDK failure/`terminateFailedStream` path. This is a candidate way to establish real mid-stream failure forwarding; record that it does not reproduce the classifier/safeguard itself. It is not implemented or run here. Do not kill any shared/user process.
- A local upstream API fixture modeled on `scripts/e2e-unstreamed-fallback.mjs` can deterministically emit a partial message plus error through the real SDK/CLI and actual AgentLink parser. Useful before/after framing proof and no-token regression escrow, but it remains a fixture stand, not the required real affected-model failure proof by itself.
- Include a rate-limit/retry-hint case and ordinary truncation control: a real `max_tokens` stop without error must still remain `length`, preventing a broad change from labeling legitimate truncation as an upstream failure.
- Persist the harness and before/after record in the separate maintainer evidence PR (or exact sanitized script as a durable PR/CI artifact with the missing repository test gate). No evidence should rely solely on a temporary directory.

## #1403: Responses PDF input_file

### Product fit and falsification

The adapter currently drops PDF message attachments and turns the same tool output into an unsupported-part note, despite the server already supporting Anthropic documents. Mapping data-URL PDF input to a document is a narrow restoration of expected document delivery. Other file types and URL/file-ID references become explicit omission notes, consistent with existing unsupported-image behavior. No stable API configuration/lifecycle/header/health/profile contract is changed and no remote-fetch behavior is introduced.

Read the complete translation/type/test diff, `partsToBlocks`, `partsToText`, `toolOutputToContent`, `translateResponsesToAnthropic`, downstream server multimodal detection, structured replay and result-wrapper normalization, existing image handling, history hashing and independent Antigravity media adaptation.

The downstream claim is supported by current source: `hasMultimodalContent` in server recursively recognizes documents nested inside `tool_result`; `normalizeStructuredUserContent` flattens recorded results on fresh replay while preserving their media, and keeps true native result wrappers at verified checkpoints; structured replay frames historical media before the current-turn boundary. Document content/source/title participate in history hashing. The PDF's exact payload and optional filename title survive translation. Text and image behavior are retained by the shared helper. Antigravity has its separate placeholder/restoration path and is untouched.

No material source correction is required from this review. Runtime malformed-array acceptance, all-base64 validation and general Responses payload validation are pre-existing broader concerns; the parser's permissive payload match also mirrors existing `parseDataUrlImage`, and expanding validation is not required just to land this targeted delivery fix.

### Regression coverage and limitations

New unit tests cover PDF in a message, PDF in `function_call_output`, and explicit non-PDF omission. The HTTP integration test verifies that `/v1/responses` reaches the SDK prompt as an actual document, which would fail on baseline and is stronger than translation-only proof. Existing image tests retain nonstreaming and streaming controls.

**Important evidence limitation:** the new PDF fixture is just base64 for `%PDF-1.4\n`, not a complete PDF. It is valid for mapping tests but cannot establish that a real model successfully reads a PDF. The added HTTP test covers only nonstreaming message PDF; nested tool-output PDF and streaming PDF need real-flow evidence. This is not a claim that the unit fixture must be replaced before merge.

Contributor reports typecheck and a full suite with three supposed baseline failures, but current head CI `test` is green. Reviewer did not independently execute local suites/build. Parent should run the final local gates and compare any failure on the exact unchanged base before calling it unrelated.

### Exact next verification

- Identify/record the actual reported client and its wire shape/version. The PR names a generic view-PDF tool but does **not** identify the specific client/model/platform; do not label a synthetic HTTP probe as verified Codex client behavior without that evidence.
- Use an actual complete small PDF containing a random receipt that appears nowhere in prompt/tool text/filename. Run the **same** message and tool-output flows on unchanged main and candidate through `/v1/responses` with real SDK/CLI and the implicated model/client/platform. Confirm captured request contains `input_file`, inspect supported SDK `getSessionMessages` for exact document block/source/title, and require the receipt from actual model processing. Baseline should omit the document and fail the same meaningful receipt assertion.
- Cover initial PDF message and a real returned tool result, both streaming and nonstreaming, with the next full-history continuation preserving correct tool-call/result association and document bytes. Include ordinary text/image plus unsupported file/remote reference omission controls. Use isolated config/session directories and ports.
- Existing `scripts/e2e-codex-namespace-tools.mjs` (E46) is a useful starting point for the tool result round-trip; **it currently drives captured Codex HTTP shapes rather than running the actual Codex binary**. Extend with a complete PDF and receipt rather than treating its current text-only passing result as PDF evidence. E65 replay-media harness shows supported SDK input inspection/provenance assertions.
- Save exact client/model/SDK/CLI/platform versions, baseline/final SHA, harness command, request/response assertions and exit result to a durable record. If the actual affected client cannot be run, preserve that specific open acceptance gate and continue independent backlog work.

## Operational notes for the parent

No comments are authorized by the user's general backlog request under the current contribution workflow; use a durable handoff/evidence PR for findings unless explicit comment authority exists elsewhere. Both contributor commits are unsigned, so the special signatures-only merge path is available after evidence/local checks/final-head CI, not before. No release is authorized.

Read fresh `AGENTS.md`, architecture boundaries, relevant E2E cases (E26/E46/E65), API contract, contribution workflow, upstream review incorporation/verification, evidence skill and current handoff attribution warning. The withdrawn cherry-pick maintainer integration procedure is not used.
