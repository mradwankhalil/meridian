# Auth cleanup cascade — bounded production analysis

Source: `/Volumes/DevSSD/meridian/t3-worktrees/t3-b7f6ebd1`, head `1372390cb8f36eb6ebc29d36e6a5ff0bd90b7811`. No source changes, full suite, real Claude/auth/access/version command, SDK query, credential read, private transcript read or process cleanup. The successful executable fixture uses only unspawned EventEmitter/PassThrough children. Its initial mock-transport setup failure is preserved separately and qualified below.

## Conclusion and confidence

**The production code explains a persistent shared cascade once one resolver subprocess lacks a required completion witness.** A successful callback is insufficient. Failed lookup custody is intentionally retained and blocks every later executable resolution, even a changed preference or valid explicit env path. Parent's fully mocked actual-models fixture reproduces the first rejection after ~5,018 ms, no replacement spawn, and recovery only after the exact late missing pipe witness. My leaf fixture independently proves the five witness gates and late recovery.

**Neither fixture identifies the initiating event missing from the original full-suite run.** Parent reports identical failure ordering on #1399 and #1411: 34 ChatGPT pure tests, three lineage pure tests and 11 priority pure tests, then the first system-reminder HTTP case fails at 5,201/5,307 ms. That timing fits the 2-second PATH lookup plus 3-second stop/join grace. It is evidence for this causal chain, not proof that stderr-close, a mock, a runtime defect or a genuine retained process caused the original missing witness.

## Exact production chain

1. `server.ts:4460` resolves the executable inside the request-owned `createClaudeProbeOwner` before constructing/invoking the SDK query. Streaming takes the same path at `:5841`.
2. `models.ts:1447–1454` wraps PATH lookup in `startOwnedClaudeProcess` with default `timeoutMs=2000`. Version probing at `:1455–1464` owns its child through the same leaf, with the remaining aggregate PATH budget. The error class/message says **auth-status** even for lookup/version; that wording does not prove an auth command executed.
3. `authStatusProcess.ts:65–77` considers a child joined only after **callback, child close, stdout close, stderr close, and exit** (or an explicit no-PID spawn failure) all arrive. Callback success, exit alone, child close alone, and a single closed pipe do not settle `result` or `joined`.
4. After the process deadline, `stop('timeout')` (`:88–108`) requests TERM, then KILL after 1 second where it still owns an unexited handle, then rejects result/cancel with `AuthStatusProcessFailure('join')` after another 2 seconds. The live `joined` promise remains pending. No signal is sent after observed exit or child-close (`:80–85`); a missing pipe can therefore time out while producing zero signals.
5. `tryPathLookup()` catches the rejection and treats it as a miss (`models.ts:1138–1156`), but `resolveClaudeExecutableWithSource()` calls `deps.checkActive()` immediately afterwards. `createClaudeResolution.scope.active()` (`claudeResolverOwnership.ts:18–20`) detects the unjoined owned child and rethrows `join`. This prevents fallback to a packaged candidate while previous custody is uncertain.
6. The resolution marks `failed=true` and waits for all owned `process.joined` promises before resolving its own `joined` (`claudeResolverOwnership.ts:29–39`). Consequently `hasUnconfirmedFailure()` is true.
7. The failed resolution remains in process-global `activeClaudeResolutions`; removal happens only in `resolution.joined.then(...)` (`models.ts:1509–1515`). `acquireClaudeResolution()` checks that set at `:1480` **before** inspecting cached executable info, env override or a changed preference. Every later caller rejects immediately with the same error and does not spawn a replacement. Cache/auth resets in unrelated tests do not necessarily clear this set; the special test-only `resetCachedClaudePath()` does, but using that reset to conceal an actual uncertain owner would defeat the safety invariant.
8. A late missing witness re-enters `complete()`, marks the child joined and clears its timers. The previously rejected result stays rejected, but the resolver joined continuation removes the quarantined global entry. New legitimate resolution is then allowed without a reset. Parent's actual-models synthetic fixture and my leaf-resolution fixture both establish this recovery.

## Why existing main test mocks do not prevent it

- The first failing system-reminder file installs the shared SDK, logger and MCP factories. It does not mock child_process or executable resolution. SDK dispatch wrappers only substitute `query/createSdkMcpServer/tool` when called; they do not short-circuit prerequisite resolver work.
- `preload.ts:27–29` deletes all inherited `MERIDIAN_*` and `CLAUDE_PROXY_*`, including a shell-provided executable override, and isolates Meridian config/session directories. It does not replace native lookup/version/auth APIs.
- `preload.ts:96–97` sets `MERIDIAN_TEST_DISABLE_SDK_PROCESS_GATE=1`. This bypasses only the gate construction around `query()` (`server.ts:1206–1223`), which occurs after executable resolution. It is not a complete native-process/credential boundary for mocked SDK tests.
- The main-stage `child_process` mock registrations in profile-expiry/login-deadline files execute in isolated worker branches. The auth-status mock file is excluded from the main invocation. Parent's early test ordering contains no preceding executed child-process mock. A later mock leak is therefore not needed to explain the full block; the first HTTP case itself can initiate real resolver work.
- Pure `claude-executable-resolver.test.ts` dependency doubles (`deps.exec` etc.) do not exercise default owned-process globals. They can pass while the default request resolver becomes quarantined.
- In the isolated `models-auth-status.test.ts`, `resolverFixture():71–81` deliberately separates callback from process/pipe witnesses. Its `witnesses()` emits exit, stdout-close, stderr-close and child-close, and happy-path helpers explicitly send the callback. Missing-witness tests at `:1134–1158` intentionally assert permanent admission refusal until late join and refusal of preference-change bypass. Those expectations match production custody, not a surprising new global effect.
- `session/sdkProcessGate.ts` has separate exact-process ownership and waits on its wrapper close; its failures do not populate `activeClaudeResolutions` or construct this auth-status error. The suite's gate-disable flag therefore cannot heal resolver quarantine.

## Executed credentialless leaf fixture

Source: `/tmp/meridian-auth-cleanup-leaf-fixture.test.ts`.

Command, from `/tmp` (so repository preload does not run):

```sh
/tmp/meridian-1399-tooling/node_modules/.bin/bun test /tmp/meridian-auth-cleanup-leaf-fixture.test.ts
```

Pinned runtime: Bun **1.3.11** (`af24e281`), macOS arm64. Result: **1 pass / 0 fail**, seven fake starts, exit 0, 520 ms total. Successful output explicitly records zero actual child starts, network calls, SDK imports and credential reads. Artifacts: `/tmp/meridian-auth-cleanup-leaf-fixture.stdout.log` and `.stderr.log`. A prior safe `.test.ts` execution on Bun 1.3.14 showed the same outcomes.

The fixture replaces exec with one string-checked fake and all other child/native/network functions with refusal traps, then verifies `mockedChild.exec === fakeExec` **before production import or any leaf call**. It imports only `authStatusProcess.ts` and `claudeResolverOwnership.ts`; there is no models/server/SDK/credential import. Each process is an unspawned EventEmitter with two PassThrough instances. Synthetic timers reduce explicit cancel grace to 5+10 ms; timer shortening does not alter witness assertions.

| Control | Before final witness | After bounded cancel | After exact late witness |
| --- | --- | --- | --- |
| Complete delayed sequence: callback → stdout-close → exit → child-close → stderr-close | Pending/unjoined at each of first four transitions | No cancel needed | Result fulfills and joins at stderr-close, zero signals |
| Omit callback; provide exit/child-close/both pipes | Pending/unjoined | Result and cancel reject join; joined pending | Joined true; already-rejected result remains join |
| Omit exit; provide callback/child-close/both pipes | Pending/unjoined | Same | Same |
| Omit stdout-close | Pending/unjoined | Same | Same |
| Omit stderr-close | Pending/unjoined | Same | Same |
| Omit child-close | Pending/unjoined | Same | Same |
| Shared resolution with missing stderr-close | Leaf/result become failed+unjoined | `hasUnconfirmedFailure=true` | `hasUnconfirmedFailure=false`; leaf+resolution joined |

All omitted cases already had either exit or child-close, so each correctly records zero TERM/KILL signals. This distinguishes missing join witnesses from a still-running actor requiring termination.

Parent's complementary fixture `/tmp/meridian-auth-cleanup-probe/global-quarantine.test.ts` exercises actual `models.resolveClaudeExecutableAsync()` with child_process fully mocked and settings/tokenRefresh/logger mocked before import. Its positive control emits full lookup+version witnesses; omitted lookup stderr-close reproduces first failure at 5,018 ms and blocks subsequent calls including valid env override without another fake spawn. Explicit late stderr-close restores env resolution with no reset. Parent reported **1 pass / 9 assertions**, zero actual native/auth/SDK calls. Its logs are `global-quarantine.stdout.txt` and `.stderr.txt` in that directory.

## Product defect versus fixture deficiency

The demonstrated global refusal after unknown custody is **intentional fail-closed behavior**, backed by explicit existing tests. Do not fix the full-suite cascade by ignoring missing pipe/process evidence, accepting callback alone, clearing the active set in production, or bypassing it when env/preference changes.

The initiating cause remains unproven. Distinguishing candidates:

1. **Incomplete test process boundary.** Main mocked SDK tests currently allow native resolver work first, making the suite depend on installed CLI/PATH, cold executable state, runtime child events and potentially native auth. This is directly supported by source and first-test ordering. A deterministic fixture should close that boundary while separate isolated tests continue exercising real resolver ownership with complete fake events.
2. **Incomplete child-process double.** A mock returning a valid ChildProcess-shaped object and callback but omitting an event will produce exactly this quarantine. A double emitting events synchronously before `startOwnedClaudeProcess` installs listeners can also lose them. A double throwing synchronously before returning a child takes `:137–139` and joins immediately; it does not by itself produce persistent quarantine. No such executed early mock was established for the original run.
3. **Real host/runtime child or pipe behavior.** A wrapper/descendant retaining a captured descriptor, delayed/missing runtime event, or a legitimate stuck process can withhold join evidence. The original aggregate logs do not record exact witnesses, so none is established. A full suite green rerun would not resolve which one occurred.
4. **Possible overcoupling of data callback to custody.** `complete()` requires callbackDone even after child exit+child-close+both pipes are proved. My omitted-callback control therefore quarantines an otherwise fully joined synthetic OS lifecycle. That is a potential false-quarantine surface if a real supported runtime loses/delays the callback; the contract of native exec may guarantee that callback, so this alone is not a proven product bug. Preserve process/pipe safety when investigating whether result delivery and custody completion should be distinct.

## Next discriminating work (proposal, not executed here)

For the main integration suite, add a file-scoped executable/auth dispatcher established before the first proxy call, with native command, credential and network traps; retain SDK query assertions. It should give a stable synthetic executable identity without resetting unknown resolver ownership and must not leak into the dedicated ownership tests. Assert zero native resolver/auth calls in ordinary mocked SDK suites.

For the initiating event source, use a separate narrowly authorized no-model runtime fixture invoking only an owned harmless synthetic executable through the leaf. Record command kind, callback completion/error class, spawn/error/exit/child-close, stdout/stderr close/destroyed state and exact monotonic times, with bounded parent/child custody. Include (a) normal exit/full close, (b) exited parent with synthetic descendant holding one pipe, and (c) controlled delayed events. The synthetic executable should refuse every auth/access/generation argument and never resolve the actual Claude installation. Run the same script under pinned Bun 1.3.11 and supported Node to separate native event semantics from production ownership. This actual-child fixture was **not run** in this read-only/no-real-process lane.

If first-proxy instrumentation is repeated, record only the five booleans, timeout reason, command category and actor identity; preserve failed evidence and do not log output/env/credentials. Until then, record this as **explained propagation and unresolved initiating witness**, not a proven #1399 GC regression or a resolved host/runtime failure.

## Preserved initial fixture setup failure

`/tmp/meridian-auth-cleanup-leaf-fixture.initial-setup-error.txt` records the initial `bun run` transport failure. `mock.module` did not intercept dynamic child_process there; before a mandatory identity guard was added, the leaf was passed only the inert placeholder `FAKE_LOOKUP_DO_NOT_RUN`. Native exec may have accepted that placeholder; do not include this attempt in the later successful fixture's zero-native-process claim. It contained no actual Claude/auth/version/access command or credential/model path. The corrected `.test.ts` invocation verifies interception first and is the sole basis for the successful zero-native fixture results.
