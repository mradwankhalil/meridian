# Live verification follow-up — 2026-10-19

Neither #1396 nor #1410 is acceptance-complete. The bounded live runs below
produced useful evidence and unresolved failures. No product PR merged, no
failure was replaced with another model's green run, and further inference
stopped. #1413's adopted credit route does not waive these gates.

## #1410 — bounded heap and actual client

Source `423477f19812b08e15d332d4f7c9c91ebf4e8650`, runtime baseline
`095b4869b5fe386e2f3a273cc5b60ec3853c8659`. The [full report](1410-live-heap/RESULT.md),
[artifact manifest](1410-live-heap/escrow-manifest.json),
[heap receipt](1410-live-heap/heap-comparison.json) and
[catalog comparison](1410-live-heap/catalog-comparison.json) are retained.

The isolated production builder/LRU workload used stock Node 22.22.3 with
`--expose-gc --max-old-space-size=512`, real SDK 0.2.141/Zod 4.4.3, equal raw
schema retention and a constructed 230-tool public-source fixture. At twelve
retained identical session owners, measured post-GC heap fell from **262.37 to
44.58 MiB**. Identical eviction churn plateaued at **262.52 versus 45.00 MiB**;
distinct-content churn retained four distinct sets in both arms, and release
returned near the fixture-only floor. Four serialized real SDK MCP catalogs
match across arms; independent transports, tool calls, survivor access and input
immutability pass. This is bounded builder/cache proof, not whole-server memory,
the reporter's private catalog or a 1,000-session baseline measurement.

The frozen measured fixture and a runnable offline harness are committed:

```sh
node docs/maintenance/evidence/backlog-20261018/1410-live-heap/run-heap-proof.mjs BASELINE_ROOT CANDIDATE_ROOT NEW_OUTPUT_DIRECTORY
```

Use clean checkouts at the exact commits above with frozen dependencies. Bun
compiles the unchanged TypeScript; separate stock Node workers measure it. Use
a new output directory to retain the recorded receipts. No model/credential
access is involved. Optional fixture regeneration needs pinned public downloads:
the transfer's general filter omitted GitHub MCP `.snap` source inputs. The
preserved measured JSON remains sufficient for offline reproduction, and public
source MIT notices are retained. Do not describe all generator inputs as escrowed.

Actual OpenCode **2.0.21**, its matching built V2 Meridian plugin, native Claude
**2.1.302**, SDK **0.2.141**, Node **22.22.3**, Darwin arm64 passed a real
read/result and same-session continuation. Tested setup/config, model discovery,
plugin-generated signed turns verified before forwarding and active server scrub
are recorded. Supported SDK history records only Opus 5.5 for this bounded arm;
prior cached-prefix reads were 100% on its two continuations. Auxiliary title
requests were blocked locally, so title/extended E42 acceptance is not implied.

The separate protocol-host E41 sequential JSON arm stopped after three tool
requests: supported SDK history contains both Opus 5.5 and 4.8 annotations.
The other three E41 modes and extended V2 restart/undo/fork/compaction/parallel
acceptance were not run. The first attempt's API-auth preflight fault happened
before inference and is preserved separately. No credential-exhaustion diagnosis
or provider wire-model switch is established by these records.

## #1396 — native reminder and continuation contrast

The [full report](1396-live/RESULT.md), [hash manifest](1396-live/MANIFEST.sha256),
candidate [report](1396-live/candidate/report.json) and
[analysis](1396-live/candidate/analysis.json), plus baseline
[report](1396-live/baseline/report.json) and
[analysis](1396-live/baseline/analysis.json), preserve both bounded runs.

Actual native Claude Code launched a foreground subagent configured for Fable
5.1, following three dependent owned files. Both baseline and corrected
`a40be1795a1b8dbcdeccfe8525b972c17609ff73` runs made six HTTP/SDK requests,
returned the receipt and witnessed the exact reminder disappearing twice while
the durable prefix stayed. Baseline replayed after those transitions; the
candidate retained three linked SDK continuation forks and three structured
Read/result pairs. This is real native-client traffic, beyond the earlier
scripted-provider controls.

Acceptance remains open: SDK assistant events/history annotate queries 1–4 as
Opus 4.8 and final queries 5–6 as Fable 5.1 in both arms. Candidate subagent
cache reads were **6,112/12,154**, **6,428/12,786**, **0/13,448**; parent
continuation **0/22,200**, below the required 95%. Separate unchanged-tail and
edited-durable-tail live controls, reminder-only shape, immutable source snapshots,
saved-session follow-up and all four E41 modes remain missing. These observations
do not diagnose a regression caused by the candidate.

The candidate's original failed verdict misclassified expected tool checkpoint
`error_max_turns` as a provider refusal. That report is retained unchanged and
the shared offline analyzer explains the narrower observed facts. Candidate and
baseline harness revisions differ in instrumentation; they are not byte-identical
executions. Candidate telemetry and admission-time config/build witnesses are
missing. Its post-run mapping check and entrypoint hash cannot supply them.

## Publication and future reproduction qualifications

These directories preserve the sanitized transfers and their original hashes.
Runtime credentials, grant/attestation keys, private configurations/stores, raw
client output and private transcript files are excluded. Parent verified every
selected artifact hash and the copied fixture/catalog hashes without new model
calls. The transfer READMEs describe their historical temporary handoff; this
maintainer evidence PR is the publication destination.

The [independent #1410 publication review](1410-live-publication-review.md)
validates all 105 manifest entries, bounded heap arithmetic and all four
cross-version catalog hashes. It found no secret/private-transcript or license
notice blocker, conditional on the partial-evidence qualifications here.

Exact archived bytes retain original whitespace: five handoff scripts, the
command receipt and a public upstream prompt have extra final blank lines or
trailing spaces. A whole-diff whitespace check reports those archive lines;
authored summaries pass separately. They were preserved to keep the reviewed
artifact hashes valid. Ignored `.log` receipts are explicitly included so the
published manifests resolve without local temporary files.

The #1410 live harnesses are post-run handoff revisions, not byte-exact executed
scripts; no executed-source hash/diff was retained for them. They retain
environment-specific imports/paths, and some opt-in guards were added after
execution with syntax checks only. They are preserved evidence, not portable,
fully accepted future runners. Before further live use,
parameterize all source/SDK/plugin paths, retain exact executed harness hashes,
complete preflight/provider-route witnesses and require exact model identity on
every round. The V2 script's future model-set guard currently tests membership,
not an exact singleton; the saved successful arm itself has only the intended
model. The unrun extended E42 preparation is explicitly preparation only.

Native build hashes cover `dist/server.js`, a small entrypoint, not all shared
chunks it imports. Candidate provenance was supplemented after execution.
Full transitive build and launch-time provenance remain open.

The [independent #1396 publication review](1396-live-publication-review.md)
validates all selected hashes and finds no sensitive-content blocker. It also
limits the cleanup witness to observed handles/handlers; handler return is not
proof of upstream response-body settlement. The analyzer's captured public-history
summaries used supported APIs against owned private run state. That state is
intentionally absent from the shareable bundle, so those summaries are retained
observations and cannot be regenerated from sanitized JSON alone.

The [independent static review](model-qualification-review.md) corrects three
interpretations in the preserved reports. Meridian supplies the alias
`opus[1m]` **and** the explicit per-request environment pin
`ANTHROPIC_DEFAULT_OPUS_MODEL=claude-opus-5-5`. SDK 0.2.141's supported history
projection omits the top-level API-error flag; the receipt's `false` values cannot
establish its original value. Meridian's JSON and synthesized SSE response model
echo the request, so retaining that outer field would not establish served model
identity. These current qualifications supersede the earlier interpretations.

The supported reader preserves stored `message.model`, without a reader-level
model substitution found in static inspection. Missing earlier SDK event/message
IDs, effective per-attempt pins/fallback witnesses and source-fork snapshots
prevent a causal explanation of the live mismatch. Capture pre-Meridian SDK
event identities before attributing it to the provider, credentials, either PR
or stale history. No additional model request was made for this investigation.
