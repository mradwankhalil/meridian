# SDK-mocked HTTP native boundary

## Follow-up: worker isolation and failure diagnostics — 2026-10-19

The earlier results below describe head `8ffbe0c2`. Its CI passed, but the
independent parent `npm test` stopped at invocation 1 with 6,480 pass, 36 skip
and one cross-process worker timeout. The [original failed-run receipt](sdk-mock-followup-20261019/previous-parent-gate.json)
and the PR preserve its full-log hash and failure/footer excerpts. That failure
and the earlier benchmark failure are not retroactively reclassified as passing.

Follow-up controls reproduced two concrete fixture defects. An exception before
HTTP setup lost its cause behind a generic SDK-start timeout (new control red).
An inherited parent API key returned HTTP 401 before SDK admission (separate
control red). `bun -e` workers do not run the test preload. Workers now remove
the parent's Meridian/legacy environment namespace and use a fresh, shared
configuration directory inside their owned test root. They explicitly retain
the preload's existing SDK-double process-gate setting; no production setting,
guard or source changes. The shared session store and canonical SDK config paths
remain common across workers.

An intermediate experiment gave every worker a different config directory and
failed two non-streaming Pi continuations with HTTP 500. That receipt is retained
as rejected iteration evidence. Restoring one shared owned config directory
passed all 13 cross-process controls; final focused validation passed 22 tests
across the worker and store benchmark files, with zero failures. Do not add
overlapping focused counts together.

Startup exceptions now reach the owned event file, early completed responses
report their status/body, and timeout messages retain observed lifecycle facts
before cleanup deletes the fixture. The benchmark logs each sample's wall time,
synchronous work time and process CPU time. Existing five-second event waits,
overall test deadlines, sample counts and the 75% benchmark assertion remain
unchanged. These diagnostics do not prove why the earlier unexplained timing
observations occurred. [Selected red/green receipts and hashes](sdk-mock-followup-20261019/manifest.json)
preserve the controls. Full local and final-head CI validation must pass on the
follow-up before acceptance; no other contributor/client/release gate is cleared.

## Earlier implementation record

This is test infrastructure only. It does not fix a demonstrated production
resolver defect or establish the missing event that initiated the previous
#1399/#1411 full-suite cleanup cascades. Their original logs did not identify
which callback, exit, child-close or pipe-close witness was missing. No auth or
credential refusal was established. Production custody and resolver quarantine
remain unchanged.

## Reproduce the boundary defect offline

Baseline: `da8187ab4553e4fd2120aa0098b2a81b197502dc`. Runtime: Bun 1.3.11
(`af24e281e`), Darwin arm64; lockfile SDK metadata 0.2.141. No actual Claude,
auth, client, model or upstream request is needed or permitted by this proof.
Install the unchanged lockfile with lifecycle scripts disabled if needed.

```sh
BUN=/absolute/path/to/bun-1.3.11 \
  scripts/reproduce-sdk-mock-boundary.sh \
  da8187ab4553e4fd2120aa0098b2a81b197502dc /absolute/new/evidence-directory
```

The script archives the baseline into a disposable directory and shares the
installed dependencies. It applies exactly the same first-proxy assertions and
strict trap preload to both trees. The only baseline SDK-helper instrumentation
exports its existing query wrapper's identity and the expected synthetic path;
it does not install the fix. The script refuses a changed helper shape.

Observed baseline: **0 pass / 4 fail**, exit 1. Three HTTP requests returned
success but supplied a packaged executable to the mocked SDK instead of the
synthetic identity. The trap separately counted one native lookup and four
native auth/store attempts. Every attempt was refused before spawning or
network access. This distinguishes boundary failure even if production catches
the trap and falls back to a packaged candidate.

Observed candidate: **3 pass / 0 fail**, exit 0. HTTP 200, prompt preservation and
Droid sanitization still hold; every SDK call receives
`meridian-sdk-fixture-not-executable`. The native/network/credential-file trap
records no attempts. Its file-backend checks reject credential-path existence,
stat and reads before consulting the filesystem, so an absent Linux credential
file cannot silently conceal a leaked default-store call.

## Adjacent controls and review

- `sdk-native-boundary.test.ts` runs the first HTTP file alone and on both sides
  of the custom subagent-model fixture, checking the actual runner order.
  It verifies lexical default token helpers use an empty store, rejected writes
  stay rejected, and default background refresh remains offline. A separate
  control reaches the actual resolver and requires exactly one trapped lookup.
- A filtered worker runs the real polytoken in-test SDK replacement and the
  pluginless HTTP test before a no-active-fixture control. SDK calls must then
  refuse an uninstalled implementation, and executable resolution must again
  reach the real implementation. This protects teardown rather than retaining a
  previous file's synthetic auth/store/resolver state.
- `models-auth-status.test.ts` retains the actual implementation and
  identity-checked synthetic children. Its independent five-witness matrix
  requires each callback/exit/child-close/stdout-close/stderr-close fact. Bounded
  rejection keeps `joined` pending; only the exact late witness joins it. The
  global regression rejects even a valid explicit path while the earlier
  lookup's stderr remains unjoined, then recovers without a cache/owner reset.
  No signal is sent after observed exit or child-close. **68 pass / 0 fail**.
- `claude-executable-settings.test.ts` retains actual resolver/settings behavior
  with owned fixed-output executable fixtures, including streaming turns.
  **12 pass / 0 fail**. Cross-process mocked HTTP coordination: **11 pass / 0 fail**.
- Independent adversarial review found lexical default-store access, loss of an
  owned login-persistence backend, and SDK replacement/teardown leaks. All were
  corrected and covered by discriminating controls. Query-builder tests now
  install their own SDK fixture instead of depending on a previous file. A
  retained initial full run reported five such missing-fixture failures and was
  stopped with exit 130 for those corrections; it is not a successful gate.
  An earlier standalone native-settings control preceded the store-isolation
  correction and had no credential-store trap; it cannot establish zero
  credential-store access. Its result is retained as qualified iteration
  evidence, not a zero-access acceptance claim. Corrected settings validation
  uses the synthetic store. Final review found no remaining material defect or
  production-scope change.
- A later full run passed its main stage and reached invocation 15, where three
  priority re-authentication controls failed because they intentionally need
  writable synthetic stores. The original **86 pass / 3 fail** log is retained.
  Those four controls now select the real emulated file backend only for an
  explicit child of their newly owned root; host defaults and outside paths are
  refused. Their exact-URL OAuth double is installed and identity-checked before
  the first HTTP turn, including proactive refresh. The strengthened focused
  control passes **4 / 0**. The earlier owned-store probe lacked that upfront
  network interception, so it is qualified iteration evidence only.

Required validation is `npm test` (pretypecheck plus all 24 invocations), explicit
`npm run typecheck`, and `npm run build`, with Bun 1.3.11 on every test command.
The PR records their final results and exact head. Raw sanitized iteration and
gate logs remain in the local evidence bundle; the committed harness, assertions
and this record are the durable proof. Final-head CI remains a merge gate owned
by the parent. No actual client/model E2E is claimed or required for this
infrastructure-only change, and no other contributor or release gate is cleared.


## Final local gate and retained limit

All **24 actual invocations** were executed using Bun **1.3.11+af24e281e**;
the launcher checked the full revision for each, and the 24 output version lines
all say `1.3.11 (af24e281)`. Combined result: **6,956 pass / 36 skip / 1 fail**.
`npm test` stopped at invocation 17; invocations 18–24 were then run independently
with the same pinned launcher and all passed. The corrected complete priority
suite passed **89 / 0**, and the real resolver/auth suite passed **68 / 0**.
Explicit typecheck and build passed.

The unresolved local failure is the untouched
`store-mutation-loop-lag.test.ts:136` timing ratio: measured median warm mutation
**25.493917 ms**, required less than **25.16318775 ms** (75% of its full-document
baseline). Neither that test nor `sessionStore.ts` changed. Their SHA-256 values
match the archived baseline, and the isolated file does not import the new SDK
fixture. One baseline control and one candidate control each passed **9 / 0**;
these controls do not establish the reason for the original failure and do not
replace its red gate. No threshold, retry, timeout, production behavior or
benchmark assertion was changed. Investigation of this timing gate remains a
separate follow-up before claiming the full local gate is green. Final-head CI
is still required before merge; this infrastructure PR does not clear it.
