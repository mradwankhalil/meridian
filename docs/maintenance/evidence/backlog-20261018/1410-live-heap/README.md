# PR #1410 second-round test evidence

Read `RESULT.md` in the assembled escrow, or `/tmp/meridian-1410-live-result.md` in this workspace. This is a temporary parent handoff, not a merge authorization or durable publication.

- Heap/catalog proof: PASS, baseline `095b4869` versus exact contributor correction `423477f1`. Stock Node 22.22.3, real SDK 0.2.141/Zod 4.4.3; 230-tool public-source-derived constructed fixture, twelve retained session owners. Heap 262.37→44.58 MiB; identical eviction churn 262.52→45.00 MiB. See `heap-comparison.json`, `catalog-comparison.json` and `heap-harness-review.md`.
- Actual OpenCode 2.0.21 + matching V2 plugin + native Claude 2.1.302 + served Opus 5.5 read/result and same-session continuation: PASS, with 100% prior-prefix cache reads. Auxiliary title requests were blocked locally in this bounded arm; no title/extended acceptance is implied.
- E41 chain JSON: FAIL exact-model qualification after three requests; supported SDK history has both 5.5 and 4.8 assistant annotations. Wire model on the failing response was not retained. Other three modes and V2 extended live work stopped; no provider refusal or credential diagnosis is claimed.
- E42 preparation: syntax/pure-helper/closed-gate checks only, explicitly UNRUN. It needs additional guarded integration before real extended execution.

Reproduce the offline proof with frozen dependency installs at both exact commits:

```sh
node run-heap-proof.mjs BASELINE_ROOT CURRENT_ROOT OUTPUT_DIR
```

The preserved fixture needs no generator dependencies/network. Public source snapshots/provenance/generator and MIT notices accompany it. Keep the original measured fixture hash; the separately qualified Effect beta83 variant is not the measured input. The runner compiles only with Bun and measures separate stock Node workers. Limits and exact commands are retained in the JSON records.

Live probes require explicit opt-in, tested matching plugin setup and pre-inference/runtime witnesses, a supported-API-created private access-only grant, and fresh confirmation that paid Extra Usage is disabled. Never copy a grant, attestation key or private SDK transcript into evidence. Resolve the mixed-model qualification failure before any inference rerun; do not switch models to obtain a green result.

`prepare-escrow.mjs` creates a regular-file-only transfer that excludes node_modules, compiled runtime directories, symlinks and raw client stdout/stderr. It preserves package manifests/locks for the optional isolated fixture-generator runtime. The parent must place sanitized reproducible artifacts and remaining gates in its separate maintainer evidence PR, preserving public-source MIT notices. No source/evidence commit belongs on the contributor branch.
