# PR 1410 live test sub-agent result

Exact candidate: `423477f19812b08e15d332d4f7c9c91ebf4e8650`; baseline main `095b4869b5fe386e2f3a273cc5b60ec3853c8659`. Read current main AGENTS/ARCHITECTURE/E2E, evidence/upstream-review skills and verification references, the current evidence branch E2E, and prior correction/review reports. No source edits, pushes, comments, merge or release.

## Disposition

Actual supported OpenCode stable **2.0.21 / macOS arm64 / Node 22.22.3 / Agent SDK 0.2.141 / native Claude Code 2.1.302 / served Claude Opus 5.5** read/result and same-session continuation: **PASS**.

E41 chain JSON: **FAIL**, stopped at the exact-model guard after the third tool request. Supported SDK history contained both `claude-opus-5-5` and `claude-opus-4-8`. Three other matrix modes were **not run** after this unexplained live qualification failure. No additional model diagnostics or inference followed. E42 extended was not run by this sub-agent. Merge acceptance remains open.

The reporter's client version, served model and platform for #1410 are unspecified. The supported installed host above qualifies this narrower test only. No actual baseline model run was performed, so the unexplained model annotation is not attributed to #1410.

## Credentialless prerequisites and controls

- Initially installed V1 executable: `/Users/rynfar/.opencode/bin/opencode`, version 1.18.34. This executable did not make a model call in this task.
- Isolated pinned stable install: `npm install --prefix /tmp/meridian-1410-opencode-2021 --no-audit --no-fund @opencode/cli@2.0.21`.
- Binary: `/tmp/meridian-1410-opencode-2021/node_modules/.bin/opencode`, reporting `opencode v2.0.21`. SHA-256 `0b2b68c1efaf20a29aaf636c2ffccc1abb56243a82f48cce45e257d232e03442`, unchanged after live execution.
- Native binary explicitly pinned to `/Users/rynfar/.local/bin/claude`; actual resolved file reports 2.1.302. Frozen install's package 2.1.296 entry is an intentional uninstalled-native stub because scripts were ignored; it was not used for inference.
- Independent registry consumer: `npm install --prefix /tmp/meridian-1410-scrub-consumer --ignore-scripts --no-audit --no-fund @rynfar/meridian-plugin-opencode-scrub@0.2.3`. Built entry `/tmp/meridian-1410-scrub-consumer/node_modules/@rynfar/meridian-plugin-opencode-scrub/dist/index.js`; SHA-256 `4ab89412e6a59fad812a3f6e5500c84f3bdfc41863320bc794f5274a251da656`. Credentialless load and real onRequest transform: PASS, 1 invocation, 0 errors. Installation locks are in the bundle.
- `node /tmp/meridian-1410-live-evidence/credentialless-v2-preflight.mjs`: PASS. Tested candidate CLI setup --v2 with exact client executable; canonical `plugins` field contained exactly the candidate `dist/meridian-v2`. Isolated HOME/XDG/config/project. Actual client fetched only GET /v1/models and /api/model adopted a uniquely named fixture Opus model/window **1,000,031** plus efforts. This is explicitly a local fixture, not live model evidence.
- Initial credentialless preflight's `debug config` command spawned a persistent OpenCode service. Initial joined=true covered direct children/pipes only. Confirmed service PID 85920 matched the pinned binary and fixture HOME; supported `opencode service stop` in that isolated environment exited 0, and PID was absent afterward. Reusable harness now omits that daemon-spawning command. See custody correction JSON.

The supported `createPlatformCredentialStore` and `readStoredCredentialSnapshot` APIs reported present, unexpired access credentials. A single read-only `fetchOAuthUsageResult` call returned HTTP 200 and **raw extra_usage.is_enabled=false**. Refresh implementation explicitly refused refresh; 0 refreshes and 0 credential writes occurred. No account settings were changed. This read-only usage guard is escrowed as `read-only-usage-guard.mjs/json`.

A private 0600 access-only profile grant was created via the supported store API outside the evidence bundle, with no refresh token. It was deleted after all live and supported-API metadata work. No credential values, attestation keys or SDK transcripts are in the bundle. Raw owned-fixture process output remains private outside it.

## Actual stable client facts

Runnable harness: `guarded-actual-v2-live.mjs`; tested invocation was `node /tmp/meridian-1410-live-evidence/guarded-actual-v2-live.mjs`. Explicit `E2E_ALLOW_LIVE_MODEL=1` and path parameters were added afterward without an inference rerun; final script passed `node --check`.

Before any forwarding:
1. Candidate setup --v2 installed exactly one expected V2 package, with Anthropic baseURL pointing to the owned relay's /v1 prefix; no hardcoded client window.
2. Actual plugin GET /v1/models completed; actual OpenCode /api/model exposed Opus 5.5, 1M context and low/medium/high/xhigh/max before inference admissions.
3. Independent scrub was active with zero hook errors.
4. Every forwarded request was exactly POST /v1/messages, build/primary, owned session, no secondary source, model claude-opus-5-5. The relay checked the plugin-generated `x-meridian-opencode-turn` HMAC, generation, session and agent before forwarding. Headers were not manufactured.

There were exactly **3 forwarded primary** requests: actual file read, actual client tool result, and ordinary same-session continuation. Each completed HTTP 200 with response model claude-opus-5-5 and message_stop. Actual completed read returned the owned receipt; it returned in the next request under its original tool-use ID; the following user turn retained it. Supported SDK history confirmed only Opus 5.5 for this control. The two continuation forks read 10,103/10,103 and 10,332/10,332 prior cached tokens. Scrub invocations=3, errors=0.

Four detached title requests were observed and deliberately refused locally to bound this first arm; they made no account inference. This control therefore **does not prove hidden-title completion or full E42**. Process/pipe joins passed; end native and client hashes matched; process inventory showed no remaining pinned client service.

Receipts: `actual-v2-live-report.json`, `live-pre-inference-preflight.json`, `live-first-outcome.json`.

## E41 first failure and stopping point

External source-preserving copy: `qualified-e41-signed.mjs`, based on the committed qualified E41 wrapper with exact candidate source imports. It runs tested setup --v1 in per-run config, asserts exactly one candidate dist/meridian entry, loads the real bundled hook, supplies owned human timestamps, and cryptographically verifies the resulting signed turn/session/build/primary headers before the explicit /v1/messages request. It uses one access-only profile, pinned native CLI, independent scrub and the original SDK history/fork/cache assertions. It is a **V1 protocol host**, not an OpenCode executable matrix.

The first attempt stopped before inference at server inventory preflight. Cause: inherited MERIDIAN_API_KEY enabled proxy auth but the old wrapper inventory fetch omitted auth. Client live invocations=0, runtimeRequests=[], native children=[]. Preserved `e41-chain-json-initial-preflight-fail.json`. Removing that ambient key before server import corrected this determined harness error. The only other ambient key was CLAUDE_AGENT_SDK_VERSION; SDK sets its own 0.2.141 version before native query. Final escrowed script adds a complete routing-environment allow-list after testing; no further inference ran.

Corrected chain JSON produced sequential read(a), read(b), read(c) across **3 signed requests**; first two delivered tool IDs were retained in subsequent histories. Initial cache_creation=2,966; next cache_read=2,966; third cache_read=5,395. No cache threshold failure had occurred. At the third source capture, exact-model guard failed. All captured child/pipe lifecycles joined.

Bounded supported-API diagnosis after stop:
- Active saved fork's first two assistant tool_use rows annotate claude-opus-5-5.
- Third round has separate thinking and tool_use rows annotating claude-opus-4-8, stop_reason=tool_use, with no isApiErrorMessage flags.
- Metadata only was saved through getSessionMessages; no private SDK files or transcripts were read.
- The E41 wrapper did not save that third HTTP response's model field. Thus the durable fact is **SDK history model annotation mismatch**, not an independently captured upstream wire-model switch.
- Static models.ts maps the requested Opus family to the native alias opus[1m], rather than pinning the numeric ID. This is a possible investigation lead, not an established cause or PR regression.

See `e41-chain-json-fail.json/log` and `e41-model-annotation-supported-api.json`. The run did not reach final answer, last result delivery, source immutability comparison, saved-fork follow-up or full cache verdict. Chain SSE, parallel JSON, parallel SSE and relevant V2 extended flows remain open. E41 protocol-host config also did not record an Anthropic baseURL entry despite asserting the explicit runtime fetch prefix; keep this qualification gap visible.

All artifacts here are temporary transfer. Parent must escrow sanitized scripts, failed/success receipts and remaining gates in the separate maintainer evidence PR. This sub-agent performed no merge or publication.


Reproduction commands are in `reproduction-commands.txt`; supported-store grant preparation is `create-access-only-grant.mjs` (explicit live opt-in, fresh disabled-extra-usage guard, mode0700 private directory/mode0600 access-only grant, no refresh/owner writes). Final versions remained OpenCode2.0.21 and Claude2.1.302; pinned client serve/run process inventory was empty; exact candidate checkout remained clean. End receipt: `live-subagent-end-state.json`.
