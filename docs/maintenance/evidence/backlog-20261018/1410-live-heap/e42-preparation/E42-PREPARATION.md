# PR1410 E42 stable extension — PREPARED, UNRUN

No E42 inference, account probe, model diagnostic, or rerun was performed during this preparation. All account inference is paused by the coordinator: its E41 chain/JSON third request reportedly exposed both `claude-opus-5-5` and `claude-opus-4-8` through the supported SDK history API despite requesting Opus 5.5. This record does not attribute that mismatch to credentials, fallback, Meridian, or client behavior. The exact-model acceptance gate is open. Do not run this extension until the coordinator explicitly clears the pause and qualifies the served model.

`extended-stable-flow.mjs` is a concrete external integration module, with no top-level I/O or inference. Only `node --check` was run. The exported live flow refuses to start unless `E2E_ALLOW_LIVE_MODEL=1`, `ctx.inferencePaused === false`, and `ctx.modelIdentityQualified === true`. It is intentionally not advertised as a standalone completed runner: the existing guarded actual arm must supply the safety adapters below. This avoids weakening its auxiliary/model restrictions just to obtain an apparent extended pass.

## Findings from current committed harnesses

At published correction `423477f19812b08e15d332d4f7c9c91ebf4e8650`, `scripts/e2e-opencode-v2-package.mjs --live --extended` explicitly accepts only the three exact beta hosts. Its `--v1` control is 1.18.11. It cannot honestly be pointed at stable 2.0.21 by changing the version assertion alone: its wait endpoint differs, and the released plugin domain API has different fork/compaction classification.

The committed `e2e-opencode-v2-stable-live.mjs` accepts 2.0.16/2.0.21 and covers first/resumed primary requests, discovery effort, real read result, fork, detached generate and attached compaction. It omits actual proxy restart, undo, parallel children, cache95 assertions and separate-CWD assertions, and predates the full mandatory current pre-inference/usage guard. Its local compaction wait route is correctly `/api/experimental/session/:id/wait`.

The parent's successful `guarded-actual-v2-live.mjs` establishes actual 2.0.21 setup/config/catalog adoption, signed build turns, actual read/result and continuation with the exact built client plugin. It deliberately refuses all auxiliary inference locally and hosts Meridian in-process. Therefore it does not independently establish E42 title/summary, compaction, task children or a true process restart. A locally refused title row is not a successful title acceptance witness.

## Concrete extension and adapter contract

The prepared module exports `runExtendedStableFlow(ctx)`, `requestBodyWitness(body, markers)`, and `assertToolPairing(messages)`. The flow adds, sequentially:

1. An ordinary exact receipt continuation with correlated telemetry `isResume=true`, `lineageType=continuation`, a distinct published SDK fork, byte-identical client system hash, and at least 95% of the previous input cache prefix.
2. A true joined proxy **process** restart, preserving exact config/store/profile/workdir, then the same cache95 continuation assertion. Recreating an in-process listener is rejected.
3. A real disposable read, supported revert/stage + revert/commit, confirmed absence from supported context, and `lineageType=undo` on the next answered original-receipt turn.
4. A native CLI fork with a different client session and no human-root attestation; the original supported client context hash remains unchanged before its next turn, and the fork-only marker is absent from original traffic.
5. A hidden summary in a disposable fork, exact detached role/source/no-affinity assertions, and no summary marker in root history.
6. One actual parent task-tool instruction to launch exactly two general subagents. Distinct child sessions, correct subagent identity, overlapping observed request lifetimes and both returned tokens are asserted.
7. Supported compaction + stable experimental wait, a durable context summary, attached same-root compaction identity, and a successful exact receipt continuation.
8. Actual client CWD must equal the isolated project for every root request and differ from the configured SDK/proxy workdir. Every observed request must carry sanitized immutable history and tool-pairing witnesses.

The module uses the supported APIs; it never opens SDK transcript files or client databases. Public source confirmation is escrowed at `stable-session-api-group.ts` and `stable-session-handler.ts`, pinned OpenCode tag 2.0.21 commit `8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72`. In that protocol source: context is GET `/api/session/:id/context`; revert stage and commit are POST under `/api/session/:id/revert/`; compact is POST `/api/session/:id/compact`; wait is POST `/api/experimental/session/:id/wait`.

Required context adapter fields:

```js
await runExtendedStableFlow({
  inferencePaused: false, modelIdentityQualified: true, // only after coordinator clearance
  expectedClientVersion: '2.0.21', clientURL, project, proxyWorkdir,
  model, session, receipt: marker, rows: report.requests, report,
  api, // authenticated owned-client supported API; timeout, assert 2xx, parse or null for204
  run, // invoke pinned binary with provided args; private output files; joined custody; stop on refusal
  latestTelemetry, // correlate exact x-request-id inserted by relay; select primary session row
  restartProxy, // see true-process contract below
  observeRequestPhase, // bounded role admission phase; never account access
  registerMarker, // make newly generated marker available to requestBodyWitness
})
```

Root must add a random nonsecret `x-request-id` per forwarded request and retain it in the sanitized relay row. Store `startedAt` before forward and `completedAt` after EOF; retain exactly parsed status/error/message_stop and request identity. `requestBodyWitness` returns hashes, actual CWD, tool IDs/names/input/result hashes and exact marker booleans; it stores no body/system text. Its pairing validator rejects duplicate use IDs or unpaired/duplicate result IDs. Whole client histories stay in owned supported client state; only their hashes are exported.

`restartProxy()` must stop/join a separate owned Node proxy host, preserve its distinct report, restart a new PID with the identical isolated durable store/config/profile/workdir, rerun scrub preflight, then retarget the same relay URL without touching the client config. Return `{previousPid,currentPid,previousJoined,sameConfig,sameStore,sameProfile,sameWorkdir}`. The qualified proxy subprocess script already in the repository provides custody/report patterns, but is Bun-specific; do not silently change production Node qualification if adapting it. Retain both pre/post-restart host reports and actual SDK-child closures. Combine request-correlated telemetry across the two process lifetimes.

The relay must keep the existing generation-matching setup, effective-config and actual catalog-adoption preflight. Signed root build turns remain mandatory. Extend its role matrix narrowly: detached title/summary require exact `subagent-<name>`, subagent mode, no session/affinity/attestation; compaction requires root session, agent compaction, source subagent-compaction, stable primary mode, no root-turn attestation; general children require distinct real child sessions, subagent mode, no root attestation, and supported session-API parentage back to the owned root; a build fork without attestation is admitted only in the explicit fork phase after supported API parentage confirms the owned root. Never broadly bypass the signature check for arbitrary build traffic. Preserve all incoming route/session/agent witnesses; no manually fabricated Meridian identity headers.

Allow only the explicitly coordinated model list for each native client role and qualify actual served models with the supported SDK API. Title/compaction may select a lower tier; that model must be explicitly allowed and proven, rather than replaced with Opus or silently refused while reporting E42 PASS. A refusal, missing completion or model mismatch closes the entire gate with its sanitized exact facts; no retries or extra-usage changes. Keep a fixed total request ceiling (suggested 48 admissions), a 180-second per-turn deadline, bounded captured output and joined cleanup. Inference remains globally paused now.

## Remaining acceptance gates

Every extended flow above is UNRUN. The current actual successful basic arm remains narrower than E42. This preparation provides neither an actual history/cache95/undo/fork/children/compaction PASS nor reporter-version/model/platform proof. The reporter's exact client/model/platform is unspecified. Any future run must pin the supported 2.0.21 installation, exact correction plugin, SDK/native CLI and actual served model, maintain separate client/proxy directories, and preserve source/package qualifications. Stop at the first material failure and explain any later rerun from a concrete correction.
