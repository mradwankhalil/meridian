# Independent #1400 correction/publication review

**PASS for safe publication and the scoped correction review; product acceptance is still pending.** No surviving material correction issue, private credential/account payload or customer-content blocker was found. Read-only review of exact final `cf399a7db7db59aa6d8f4596c3eb30d610a60a74` versus source `9451a72aa48127ddd6106bedb48ecdb98e03f04d`, the packet and original/guarded logs. No retained scripts, tests, builds, native auth, SDK/network diagnostics or source edits were performed. No PR watch or CI state was changed.

The delegated full-packet sensitivity/reproduction review is `/tmp/meridian-1400-publication-safety-review.md` (including a proposed 28-file selection). This review independently checked final code/test deltas, callers, source-probe/replay behavior, runtime/counts and all packet hashes. `git diff --check` on the correction passes; source worktree is clean.

## Final code and regression scope

Both terminal JSON and SSE paths now derive retry time from the **current effective exclusions** over `options.poolIds`, without mixing in newly attempted shorter timestamps. The existing tracker supplies max(account exclusion, requested-model exclusion) per account; the helper selects the earliest effective account opening. Retained work supplies only its retained candidate, so another account's earlier availability cannot shorten that wait.

The additional expiry finding is correctly fixed: if any relevant pool member is now unbenched, the helper returns null and existing quota fallback logic supplies 60 seconds. Skipping that member would wrongly advertise another account's hours-long wait. Historical/refinement observations cannot overrule the final effective state. This remains a response-construction snapshot, not a promise to await unfinished background refinements.

Only `server.ts` and two necessary HTTP integration files change. Existing monotone marks, model scoping, candidate order, retained routing, exposure/cancellation/no-retry barriers, ordinary status behavior and public proxy interfaces are preserved. Account-global diagnosis concurrency remains an explicit unresolved limitation, not a new attempt-bound-evidence claim.

The fourteen JSON/SSE cases meaningfully discriminate repeated shorter marks when either retried or skipped account opens first, opposite account/model overlaps, a completed asynchronous extension, expiry during later attempts, retained-only scope and ordinary first marks. Unrelated-model serving controls remain. The rewritten retained test strengthens its prior restriction check and additionally verifies the actual long exclusion remains. No material test assertion was weakened to conceal a failure.

## Original, intermediate and final proof remain distinct

Original-source red records show 2 pass / 6 fail for repeated/overlap active cases, 0 pass / 2 fail refinement and 0 pass / 2 fail retained cases. The source-only helper probe reports 600,000 ms against an effective 10,800,000 ms. The separate expiry red record is correctly identified as an **initial-correction** failure, not attributed to the original source:10,681/10,680seconds versus60. Red patches and the intermediate correction are retained.

Final active file 54 pass, retained 2 pass and unchanged leaf files 362 pass sum to **418 passing focused tests**. Those logs and in-process fixture records consistently identify **Bun 1.3.11**, with empty forbidden native/network attempt lists. Typecheck/build success is recorded for the final source; the unchanged leaf checks predate only the final server expiry guard, while affected server cases were rerun afterward. No full-suite pass is inferred. The convenience replay is explicitly syntax-checked only, not represented as another execution.

## Safety and the initial boundary deviation

All **41 SHA256SUMS entries match**, with 42 regular files totaling 335,152 bytes. No missing/unlisted files, directories, symlinks or dependency trees exist. `result.md` matches the external handoff. Public commit identities/signature fingerprints are provenance, not private account payloads.

The entire 1,217-byte initial `baseline-control.log` is safe to retain. Its native auth-status events name synthetic profile directories and report `loggedIn:false`; no token, private account identity or customer content is present. It must remain captioned as **unguarded**: SDK mocking did not stop native auth-status and may not have stopped credential-store reads. No zero-native/zero-credential-access claim is justified for that first control. Later guarded runs do not erase it.

`offline-fixture.ts` subsequently fixes auth/executable/store boundaries, preserves real model mapping, and traps known native/network APIs. Guarded receipts show no trap attempts. These establish bounded mocked HTTP/source behavior, not actual model/account/client acceptance or a repository-wide infrastructure fix. No provider/OpenAI/GitHub token, JWT/bearer credential, private key, private customer document or raw transcript was found anywhere in the packet.

## Durable selection and reproduction qualifications

A selected 28-file packet (~254 KB, detailed in the safety report) is sufficient: retain original and final result/review records, all original/intermediate red receipts and their patches, final active/retained/leaf/source receipts, baseline deviation plus guarded-control evidence, fixture/probe/replay source, command/runtime records, final type/build and source/signature/ancestry/remote snapshot receipts. Duplicate earlier green logs, identical typecheck logs and stale intermediate bundles need not all be copied. Preserve the original SHA list as the **source inventory**, and create a separate selected manifest with exclusions if publishing a subset; do not imply it is the full original directory.

The historical fixture uses recorded absolute source imports. `replay.mjs` creates a new rewritten copy for a caller-selected root/output and pins Bun 1.3.11, preserving the original fixture. It is syntax-only and does not assert exact Git SHA/cleanliness: require a clean isolated checkout at the recorded final commit with frozen dependencies and a fresh output directory. Original red reproduction additionally requires the retained test patch on the original source; expiry red requires its separately preserved intermediate patch. Do not run the unguarded baseline control as a reproduction shortcut. No rerun is authorized by this review.

The saved PR snapshot confirms the final head and retained original commit list but does not contain completed check results. Full local npm remains intentionally pending the shared infrastructure work, and final-head CI/live gates remain pending as stated. Naturally spent Fable/account capacity, whole-pool behavior, delayed post-heartbeat refusal, actual Claude Code main/subagent and Linux/E78 acceptance are still OPEN. Focused green, signatures and approved commit-preserving credit do not waive these gates or establish source Author credit on main before a future verified merge.
