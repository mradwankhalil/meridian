# PR #1410 second-round test report

PR: https://github.com/rynfar/meridian/pull/1410

**Disposition: NOT ACCEPTANCE-COMPLETE.** Bounded real-SDK heap/catalog proof and actual OpenCode V2 read/result/continuation pass. E41 sequential JSON **fails exact-model qualification** because supported SDK history contains both `claude-opus-5-5` and `claude-opus-4-8`. All further inference stopped. The other three E41 modes and extended V2 gate remain open. Do not treat this report as merge authority. No source edits, commits, pushes, external comments, releases or merges were made by this task.

## Exact sources and environment

- Baseline/main: `095b4869b5fe386e2f3a273cc5b60ec3853c8659`, fetched and unchanged during this task.
- Published contributor correction: `423477f19812b08e15d332d4f7c9c91ebf4e8650`. The auto-created task checkout started at `446a0f1633be3a0cf36d8f1e9f222e914d2f7c83`; after fetching the contributor branch, this task detached at the exact published correction. It did not check out or modify the contributor's branch already owned by another worktree.
- Current task checkout: `/Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe` (user-facing alias `/Users/rynfar/.t3/worktrees/meridian/t3-8a106dbe`). Baseline is a separate detached worktree `/private/tmp/meridian-1410-live-baseline`.
- Frozen installs: `bun install --frozen-lockfile --ignore-scripts`, exit 0 in both worktrees. `npm run build`, exit 0 in both. Source/lockfiles stayed clean. Build/install logs are in the evidence bundle.
- Measured runtime: stock Node **22.22.3**, Darwin arm64, macOS **26.6.2** / Darwin **25.6.0**. TypeScript compilation/build uses Bun **1.3.14**; measurements do not run under Bun. Real Agent SDK **0.2.141**, Zod **4.4.3** in both arms.
- Frozen install deliberately skips native-Claude installation scripts. Native-model testing must explicitly select the independently installed native Claude executable; the frozen package's stub cannot establish inference.
- Fresh GitHub records: `pr-start.json`, `pr-final.json`. PR remains OPEN at the exact correction head and baseline above; all applicable final-head CI including required `test` is successful. These are read-only observations, not a merge decision.

Read the three supplied prior reports; fresh origin/main AGENTS, architecture dependency/adapter/session boundaries, E2E mandatory client-plugin preflight/E41/E42, upstream-review/evidence skills and verification/incorporation references, contribution workflow and handoff header. Prior correction-task `npm test` (6,948 pass/36 skip/0 fail), typecheck and focused checks are reported by that task's retained receipts; this task did not repeat the full suite without a source change. Both source builds were independently repeated here.

## Realistic bounded heap proof

Evidence directory: `/tmp/meridian-1410-live-evidence`.

Runnable proof:

```sh
node /tmp/meridian-1410-live-evidence/run-heap-proof.mjs \
  /private/tmp/meridian-1410-live-baseline \
  /Volumes/DevSSD/meridian/t3-worktrees/t3-8a106dbe
```

The runner verifies both exact commits, compiles their unchanged production `passthroughTools.ts` and `LRUMap` using Bun with `--target=node --packages=external`, and launches separate stock-Node workers with `--expose-gc --max-old-space-size=512`. Imports resolve each arm's actual installed SDK/Zod. There is no SDK `query()`, native CLI, provider/model call, credential access or network in these workers. `commands.json` retains the exact worker commands and four exit-0 receipts.

The baseline invokes its unchanged per-session `createPassthroughMcpServer`; the correction invokes `sharedPassthroughMcpServer`, exactly the builder selection changed in `server.ts`. The measured cache uses the real production LRU implementation and the same entry structure `{key: computeToolSetKey(tools), mcp}`. Both arms also retain independently cloned raw client-tool arrays in an equally bounded second cache, accounting for raw schema/key duplication that this optimization does not remove. This is an isolated builder/cache workload, not a whole-server or transcript-memory measurement.

### Fixture provenance and limits

Measured `client-derived-230-tools.json`: **230 tools**, **366,598 bytes**, SHA256 `df872b711b2cebae00326778b1649bb80e2e7271418f4878207caf629bb5e17f`.

- Eleven public native OpenCode 1.18.34 tool definitions, evaluated from pinned public source at `aec0b9a6d8898f68f923aaf08b7306d931fd9d76` using its public Effect-to-JSON-schema converter, plus 131 public GitHub MCP committed tool snapshots at `e3809fe91c7546633241006bf0b91f23b2595e28`, plus 88 explicit second-instance namespaced aliases.
- 137 unique serialized input schemas; 276 object nodes, 63 arrays, 212 enums, 1,330 declared properties, maximum object depth 4, 11 `anyOf` and 12 `oneOf` nodes. Compact input-schema JSON alone is 194,619 bytes. The real builder retains its existing fallback handling for schema features outside its supported subset.
- This is a constructed client-consumable multi-server workload, **not** the reporter's captured private catalog, an assertion that a default server exposes all conditional/deprecated snapshot tools, or the actual 2.0.21 live-client roster. Neither the reporter's exact client version/model/platform nor its schema fixture was supplied.
- The measured native seed conversion used installed Effect `4.0.0-rc.111`. A separately saved conversion using source-pinned `4.0.0-beta.83` has the same values and complexity; only JSON keyword-map order differs in native `lsp`'s `line` and `character` schemas. Parameter-property map order is unchanged. `fixture-effect-version-comparison.json` preserves that qualification; the original measured fixture was not overwritten and measurements were not silently rerun.
- `generate-client-derived-230-tools.mjs`, per-tool provenance, generation receipts, exact source snapshots and the separate beta.83 fixture are escrowed in the bundle. The existing frozen Meridian install supplies TypeScript/Effect for original generation; the source-pinned generator runtime was installed separately. Reproduction can use the preserved JSON directly without generator dependencies or network.

### Measured results

All values below are `process.memoryUsage().heapUsed` after explicit GC across multiple event-loop turns, MiB (1,048,576 bytes).

| Phase | Baseline | Correction | Strong built sets baseline/current |
| --- | ---: | ---: | ---: |
| Fixture loaded, no session owners | 13.77 | 13.77 | 0 / 0 |
| 1 retained session | 35.07 | 35.08 | 1 / 1 |
| 2 retained sessions | 55.81 | 35.95 | 2 / 1 |
| 4 retained sessions | 97.29 | 37.67 | 4 / 1 |
| 8 retained sessions | 180.35 | 41.13 | 8 / 1 |
| 12 retained sessions | **262.37** | **44.58** | **12 / 1** |
| 36 more identical admissions, capacity still 12 | **262.52** | **45.00** | **12 / 1** |
| All session owners released | 14.58 | 14.41 | 0 / 0 |
| 36 distinct-content admissions, capacity 4 | 97.43 | 98.01 | 4 / 4 |
| Distinct owners released | 15.15 | 15.73 | 0 / 0 |

The correction uses about **83.0% less total measured heap at twelve identical retained sessions**. Identical-content churn plateau samples are 44.9965/44.9973/44.9977 MiB; baseline stays 262.5068/262.5156/262.5202 MiB. Distinct-content churn intentionally cannot share and stays near four retained built sets; correction samples are 97.9004/98.0013/98.0117 MiB.

The largest recorded post-GC heap sample is 262.52 MiB; largest recorded RSS sample is 401.36 MiB. Node reports a 560 MiB total heap limit for the 512 MiB old-space cap. These are sampled values and the V8 heap cap, not an assertion of a continuously sampled hard RSS ceiling. No 1,000-session baseline was attempted and no linear extrapolation is offered. The contributor's 3,117 MB →108 MB prose measurement remains independently unverified at that scale.

The release phase observes zero surviving WeakRef targets after eight event-loop/GC rounds in both arms. This is an observation from this run, not a guarantee about immediate collection or finalizer latency. No assertion depends on instant FinalizationRegistry cleanup; the private weak-index size is not introspected. Heap release also does not require RSS to immediately return pages to the OS.

### Catalog and transport controls

`baseline-catalogs.json` and `current-catalogs.json` each use four simultaneously connected **real SDK MCP servers**, public MCP `Client`/`InMemoryTransport`, and the same 230-tool fixture: original A, independently cloned A, changed-description B, fresh-built B.

All deterministic assertions pass in both arms: each wire `tools/list` has 230 entries; clone catalogs serialize identically; B serializes identically to fresh B and differently from A; all four server instances/transports are independent; the survivor still returns the complete catalog after A and B close; a real validated native `read` MCP call succeeds; source input serialization is unchanged. Correction clones reuse the built set while baseline clones remain separate. The production passthrough handler is a no-op; this protocol call does not read a user's file or call a model.

The four corresponding **serialized wire catalog SHA256s match across baseline/current**, asserted by `verify-catalog-records.mjs` and retained in `catalog-comparison.json`. This additional comparison was made against the already saved wire records, with no measurement rerun. An independent harness audit requested that explicit cross-version assertion and corrected a misleading comment that had described the B fixture as an order change; B actually changes only description. Both were corrected without changing the measured worker behavior. Prior root/nested schema-order red/green regressions remain the separate supplied correction evidence.

This catalog-fork control establishes independent definition sets/transports. It does **not** establish native session checkpoint/fork history, tool-call/result settlement or E41 prompt-cache continuity.

## Actual client and model acceptance

Credentialless qualification has passed for **OpenCode 2.0.21**, matching exact correction's bundled `dist/meridian-v2` plugin, and Darwin arm64. Tested `node dist/cli.js setup --v2 --opencode-bin <pinned-client>` installs exactly one canonical `plugins` entry in isolated HOME/XDG/config/project state. The client plugin itself issues `/v1/models`; the actual client's supported model API adopts the local fixture's unique display name, context window `1,000,031` and effort variants with no hardcoded window. All POST inference requests are blocked in that preflight. `v2-preflight/report.json`, sanitized config/adoption receipts and `credentialless-v2-preflight.mjs` preserve this evidence.

The first preflight's direct child/pipes joined, but a client service escaped as an owned daemon. The test sub-agent identified it by its pinned binary plus isolated HOME/cwd, used that client's supported `service stop` in the exact environment, and verified PID absence. The reusable harness removes the unnecessary debug-config step that spawned it. Preserve this custody correction; the original direct-child `joined=true` must not be misread as covering that escaped service before correction.

Independent registry server scrub `@rynfar/meridian-plugin-opencode-scrub` **0.2.3** is installed in `/tmp/meridian-1410-scrub-consumer`. Its credentialless load and onRequest invocation preflight pass. This is separate from the required Meridian client plugin.

Supported credential-store APIs reported an unexpired access token. A single supported read-only OAuth usage request returned HTTP 200 and raw `extra_usage.is_enabled=false`; no refresh, credential write, login, account switch or paid-usage setting change occurred. `read-only-usage-guard.json` retains sanitized facts. These facts establish prerequisites, not inference entitlement.

### Actual V2 read/result/continuation — PASS

`guarded-actual-v2-live.mjs` and `actual-v2-live-report.json` preserve the runnable sanitized gate and receipt. Tested tuple: **OpenCode 2.0.21**, exact correction built **Meridian V2 plugin**, stock **Node 22.22.3**, **Agent SDK 0.2.141**, system native **Claude Code 2.1.302**, **served `claude-opus-5-5`**, Darwin arm64. The SDK response and supported public SDK history record only the required served model. The client binary SHA256 is `0b2b68c1efaf20a29aaf636c2ffccc1abb56243a82f48cce45e257d232e03442`; native CLI SHA256 is `5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37`. Both hashes remain unchanged at cleanup.

Before inference, tested setup installs exactly one `dist/meridian-v2` entry (plugin SHA256 `d8fd970f561a05a1d2716f7a118ec7e59e44d1942b25a1edca263a00cc779b56`), provider base URL targets the isolated relay's `/v1`, and actual client discovery adopts the live Meridian model's 1,000,000-token window and low/medium/high/xhigh/max efforts with no hardcoded client model window. On **every forwarded primary request**, the relay cryptographically verifies the plugin-generated signed turn against its owned ephemeral attestation key and checks session/build/primary identity plus exact `/v1/messages` route **before forwarding**.

Three primary Opus requests were admitted: initial real `read` call, the matching actual client-owned file receipt result, and a same-OpenCode-session continuation using that receipt. Both client invocations exit 0; responses are HTTP 200 with terminal `message_stop`, and no provider refusal/error. Two distinct SDK continuation forks are observed. First continuation cache read is **10,103/10,103** prior cached tokens; next is **10,332/10,332**, both 100%. Independent server scrub 0.2.3 is active and invoked three times with zero hook errors.

Four auxiliary title requests were **intentionally blocked locally** to bound this initial gate, including a client-default Haiku title selection; they were never sent to the SDK/provider. Therefore this arm is not E42 title-agent acceptance and is not evidence of Haiku access. No paid extra usage, warmer, refresh, login or account change occurred. Direct original child/stdout/stderr closure witnesses all join; the explicit API host is stopped with its original handles, and final process inventory has no owned pinned-client service. The actual read/continuation arm is complete; broader E41/E42 claims require their own results.

### E41 sequential JSON — FAIL; matrix stopped

The external `qualified-e41-signed.mjs` preserves the production E41 assertions and adds tested isolated V1 setup, real installed Meridian V1 hook loading, timestamped plugin-generated signed turns with cryptographic verification, explicit read-only access-only profile selection, scrub preflight, source-model checks before further requests and original child/pipe closure. This is a **protocol host using the real client plugin**, not an actual OpenCode executable. The actual 2.0.21 client control is separately established above.

The first attempt stopped **before inference** at server-plugin inventory: inherited `MERIDIAN_API_KEY` enabled proxy authentication while the wrapper's local inventory request omitted it. The failed receipt shows `runtimeRequests=[]`, plugin runtime invocations 0 and native children `[]`. This was a determined local harness-environment fault. The external copy isolates the ambient key before server import and records the corrected inventory HTTP 200/active scrub. The failed-before-inference receipt is preserved; no model completion or account refusal occurred in that attempt.

After that explained correction, sequential JSON admitted three real signed requests through `/v1/messages`, returning one read call each for the three owned files. The second and third requests carried the exact preceding result IDs. The real V1 hook's three invocations succeeded with no hook errors, and setup resolved exactly one expected `dist/meridian` entry before load. However, the protocol-host setup record does not include an effective provider baseURL witness; the owned host fetch uses a literal isolated `/v1/messages` route. This is a further qualification limit, not silently supplied by manual headers.

After the third request, supported `getSessionMessages()` source inspection returned assistant model annotations **`claude-opus-5-5` and `claude-opus-4-8`**, so the harness failed `Supported SDK source history does not match the required model; stop before another model request`. Exit **1**, `joined=true` for all observed original child/stdout/stderr handles. The raw provider did not report a credential/billing/rate-limit refusal. This is an unresolved **model-identity qualification failure**, not evidence of exhausted credentials and not evidence that #1410 caused model routing drift. There was no unexplained green rerun or alternate-model success substituted for it.

Bounded **read-only** diagnosis through the same supported SDK API preserves metadata only in `e41-model-annotation-supported-api.json`: the first two assistant `tool_use` rows are annotated 5.5; the third round has separate `thinking` and `tool_use` rows annotated 4.8 with `stopReason=tool_use`, and none has an API-error-message flag. The E41 wrapper did not retain that response's wire model, so this proves saved SDK annotations and does **not** independently prove a provider wire-model switch. Static source maps the requested Opus family to native alias `opus[1m]`, rather than a numeric model pin. The cause of the mixed annotations remains unresolved; no model-generation diagnostic or rerun followed.

Cache observations before the stop were 2,966 created, then 2,966 read, then 5,395 read; no cache-floor assertion failed before model qualification stopped the flow. This does **not** establish the complete E41 chain: the third result was not delivered, final answer/follow-up were not run, saved-fork continuation, final exact-one-answer histories and immutable-source checks did not finish. No complete E41 pass is claimed.

Sequential SSE, parallel JSON and parallel SSE were **NOT RUN** after the first unresolved live failure. Account inference also stopped for the prepared extended V2 gate. A bounded supported-history/static assessment may explain more of the observed model metadata, but no new SDK query/native generation, model-access diagnostic, refresh or account change is authorized by that investigation.

## Remaining acceptance and durable escrow gates

- Actual OpenCode/Claude model completion and real read/result/same-session continuation: PASS for the qualified local tuple above; reporter's unspecified tuple remains untested.
- E41 sequential JSON: FAIL exact-model qualification as above. Sequential SSE, parallel JSON and parallel SSE: NOT RUN following that stop. Each remains an acceptance gate. Retain exact call/result pairings, independent sessions, checkpoint/fork advancement, immutable source histories, saved-fork continuation and ≥95% prior cached-prefix reuse. SDK MCP protocol controls do not replace these.
- Relevant E42 actual V2 extended restart/undo/fork/compaction/parallel children and separate client/proxy CWD flows: OPEN/UNRUN after the E41 model-identity failure. `e42-preparation/extended-stable-flow.mjs` is prepared and syntax-checked only; it is not a complete tested runner or a passing receipt. It needs a genuine owned proxy subprocess/restart plus narrowly validated role/model, telemetry/history and stable API adapters. Existing beta package gates reject stable 2.0.21 and use a different wait API; the stable companion lacks the full extended contract. No broad auxiliary-request bypass was used to manufacture acceptance.
- Reporter exact version/model/platform: unspecified and untested; any local success is qualified to the explicit installed tuple.
- Durable escrow: this task writes only temporary transfer artifacts. The parent must put sanitized runnable harnesses, frozen fixture/provenance, before/after records, review and open gates in its **separate maintainer evidence PR**. Do not copy runtime dependency trees, node_modules symlinks, credentials, private raw fixture output or private SDK history. No evidence changes belong on the contributor branch.

PR #1410 was linked to this delegated thread. Parent owns final acceptance and any independently authorized merge; this task has no merge or release authority.

## Final handoff and cleanup

**Safe merge assessment: retain the acceptance gate.** This round independently supports the bounded memory optimization and the stated actual-client control, but it does not satisfy the mandatory E41 matrix or full V2 extended contract. Resolve the SDK model-annotation qualification and capture the corresponding response model before claiming exact served-model E41 acceptance. Do not attribute the observed mismatch to credentials, #1410 or a provider wire switch without additional evidence.

`live-subagent-result.md` and `reproduction-commands.txt` retain complete actual-client/E41 commands, versions, plugin identities and controls. `create-access-only-grant.mjs` uses only the supported credential-store API with explicit opt-in, a fresh disabled-Extra-Usage guard, private permissions and no refresh token; the grant itself is never part of evidence. The live guard opt-in/path parameters and a stricter E41 environment allow-list were added after the measured runs, passed syntax checks and were **not** used for a further inference rerun. Assertions were not weakened to pass the failed model gate.

The private access-only grant and owned fixture attestation keys were removed after supported-history diagnosis. All captured original client/native child/stdout/stderr handles joined; final process inventory has no owned pinned OpenCode serve/run service. End client/native versions remain 2.0.21/2.1.302 with unchanged binary hashes. Both detached source worktrees are clean, and `git diff --check` passes. PR remains open at the exact correction head; no watch or external communication was started.

`prepare-escrow.mjs` assembles `/tmp/meridian-1410-live-evidence-escrow` and a hash manifest for the parent, excluding dependency trees, generated compile directories, symlinks, raw client stdout/stderr and credential/key files. This assembly is still temporary transfer; the separate maintainer evidence PR remains the durable-publication gate.
