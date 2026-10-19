# PR #1400 correction evidence publication-safety review

Disposition: **no credential/private-content blocker detected for publication of the inspected packet.** Retain the initial unguarded-control deviation prominently. Focused guarded results do not close full-suite, exact-head CI, real client/model or platform acceptance gates.

Read-only scope: `/tmp/meridian-1400-correction-evidence` and `/tmp/meridian-1400-correction-result.md`. No retained script/test/build, SDK/native auth/status process, network request, credential API, source edit, watch or CI operation was executed. Whole-file scans and hash/metadata checks used file reads/Python. A delegated reviewer independently inspected every line of `baseline-control.log`; its report is `/tmp/meridian-1400-baseline-log-safety-review.md`.

## File integrity and disclosure

- The packet contains 42 regular files, 335,152 bytes; no directories, symlinks, node_modules/dependency trees, credential-store files, private grants or transcript files. All 41 entries in `SHA256SUMS` exist and match SHA-256. Only `SHA256SUMS` itself is unlisted, as expected. `result.md` matches the external handoff byte-for-byte.
- Whole-file scanning found no Anthropic/OpenAI/GitHub token signature, JWT, bearer/basic credential value, private-key marker or URL-embedded username/password. Broader sensitive-field matching identified authorship/committer emails in commit/signature/GitHub provenance, not logged account credentials. Signature payloads are verification records, not private signing keys.
- The logs contain synthetic profile labels, owned request/session identifiers, test assertions and process/package paths. No customer document, private prompt/result body, real account payload or credential value was identified. In particular, the initial log contains an authentication status boolean and generic synthetic profile names; it contains no token, email, account/subscription record or customer text.
- Original-machine paths occur in stack frames, runtime/command records and fixture imports. Preserve them as historical reproduction metadata or explicitly sanitize derivative excerpts with a source-hash/line-range record; they are not credential outputs. The source patches concern only the two expected integration-test files and `src/proxy/server.ts`. No third-party source/dependency redistribution was found in this transfer.

## Initial-control deviation must survive publication

`baseline-control.log` is small (1,217 bytes, 17 lines; SHA-256 `bc250a842aa634076f421bcde1d987bc2be0750c3e52e38c46e64e038626c0ff`) and safe to retain in full. It reports Bun **1.3.11 (af24e281)** and **1 pass / 41 filtered / 0 fail**, 2.43 seconds. Lines **5 and 7** record actual native auth-status lookups for the synthetic work/personal profiles, exiting with `loggedIn:false`.

Caption this as an **unguarded SDK-mocked control**. Mocking SDK query did not isolate executable resolution/auth/credential boundaries. Possible credential-store access by that first fixture remains disclosed; neither absence of leaked values nor `loggedIn:false` proves zero credential access, zero native activity, owner-account sign-out or a fully offline run. This review performed no diagnostic to determine what stores were accessed. Later guarded passes cannot erase the deviation.

`commands.json` explicitly labels the command `unguarded-baseline-control`. `result.md`'s runtime/offline-boundary section and `adversarial-review.md` also preserve the limitation. Keep those labels and the original log together in the durable packet. Safe excerpt ranges, if needed, are lines 1, 3–11 and 13–17; retaining all 17 lines is simpler and preserves the exact record.

## Guarded receipts and runtime interpretation

Every retained test runner version line reports Bun 1.3.11. Guarded HTTP/unit logs also print `OFFLINE_FIXTURE_RUNTIME` with 1.3.11 and a resolved executable, followed by `SDK_BOUNDARY_TRAP` with `attempts:[]`, zero reported native children and zero reported network calls. The final focused counts are 54 active-file + 2 retained + 362 leaf-unit passes = **418**, not a full-suite run.

Static inspection of `offline-fixture.ts` shows executable/auth/credential-store stubs at lines 54–60, interception assertions at 44–47, rejecting child-process/network APIs at 10–29, and the empty-attempt assertion/report at 48–50. These records support the stated guarded fixture boundary. They do not retroactively apply to the baseline or establish actual provider/client/access behavior. `pool-source-probe.ts` is separately source-only: it extracts the helper text and uses the pure tracker rather than loading the server.

Keep original-source red runs (`red-active`, `red-refinement`, `red-retained`, `red-source-probe`) distinct from the later initial-correction expiry red run (`red-expired`). The final log is `green-active-file.log` with **54** tests; `green-active-file-before-expired.log` has **52** and is an intermediate receipt. Earlier `green-active.log` has **10**. Do not add these overlapping/intermediate counts to the final 418.

`pr-final.json` retains exact source/head/authorship information; it contains no status-check rollup. It is not a final-head CI-pass receipt. The handoff explicitly leaves that gate pending. No live GitHub status was refreshed by this review.

## Reproduction portability

- Original contributor source: `9451a72aa48127ddd6106bedb48ecdb98e03f04d`; published final: `cf399a7db7db59aa6d8f4596c3eb30d610a60a74`. Reproduction needs an isolated checkout of the intended exact revision, frozen dependencies, actual Bun 1.3.11, and the retained fixture/test/probe inputs. `bun install --frozen-lockfile --ignore-scripts` may require registry access or a prepopulated package cache; “offline” describes model/account isolation rather than disconnected package installation.
- `offline-fixture.ts:8,32,36,40,54–55` contains original-machine absolute module paths. Directly invoking that original preload elsewhere is not portable. `replay.mjs:14–16` reads the recorded original root from `commands.json`, writes a separate fixture copy with that root replaced, and runs in the supplied checkout. Preserve the original fixture bytes and command ledger together.
- `replay.mjs:10–12` defaults to a temporary original Bun path, so set `PR1400_BUN` to an available absolute Bun 1.3.11 executable. The supplied root should be an isolated checkout with dependencies installed; specify a separate writable output directory. The wrapper writes output logs and `results.json` there rather than changing the original fixture.
- The replay wrapper was syntax-checked only, as `result.md` and `commands.json` disclose. Its final bytes were not an additional executed acceptance run. It checks Bun's version but does not itself verify the source commit SHA; pin/record the intended checkout independently. Its successful syntax check is not proof of portable execution on another machine/platform or a full-suite/client pass.
- `pool-source-probe.ts:5–8` takes a repository root and reads/imports source relative to that root. `red-tests.patch` supplies the original-source regressions; `correction-before-expired.patch` and `red-expired.log` preserve the intermediate correction finding. The convenience replay covers final checks; it does not automatically recreate every historical red state.

## Selected durable packet recommendation

A coherent 28-file selection is **254,219 bytes**, removing duplicated/intermediate green/build receipts while retaining the deviation and before/after chain:

- Handoff/runtime/commands: `result.md`, `adversarial-review.md`, `commands.json`, `runtime.json`.
- Boundary deviation/guard: `baseline-control.log`, `offline-control.log`, `offline-fixture.ts`.
- Reproduction inputs: `pool-source-probe.ts`, `replay.mjs`, `red-tests.patch`, `correction-before-expired.patch`, `final-correction.patch`.
- Original/intermediate red records: `red-active.log`, `red-retained.log`, `red-refinement.log`, `red-source-probe.log`, `red-expired.log`.
- Final guarded records: `green-active-file.log`, `green-retained-final.log`, `green-units.log`, `green-source-probe-final.log`, `typecheck-final.log`, `build-final.log`.
- Exact identity/attribution: `ancestry.json`, `original-commit-manifest.jsonl`, `signature-github.json`, `pr-final.json`, `remote-final.txt`.

The other green/build/typecheck copies, install stdout, commit/push console messages and duplicate text provenance may remain in historical transfer storage without being copied blindly. Create a publication-specific manifest for the actual selection. If retaining the original 41-entry `SHA256SUMS` too, label it as the original complete-transfer manifest rather than implying that an intentionally reduced directory satisfies it.

Safe publication does not establish full local validation, exact-head required CI, attempt-bound diagnosis, real spent-allowance/other-account capacity behavior, post-heartbeat refusal handling, implicated Claude/main-subagent flows or Linux acceptance. Those remain independent gates owned by the parent.
