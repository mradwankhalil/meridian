# Meridian 1.84.0 release verification

The owner requested publication on 2026-10-19. Release Please [#1418](https://github.com/rynfar/meridian/pull/1418)
advances 1.83.1 to 1.84.0. Exact candidate
`fae06f874116ed7ec2eafe58f89c6dc1813fe347`, tree
`3f17587f2e68b192b408ae80b9b6469e72728e65`, includes reviewed main
`d7d9ad02720adffc1c8e42e2d229c0b45cbed6f3`. Only four release metadata
files differ from that main. The bot's version/manifest/lock changes were
retained; the maintainer added the omitted Bun startup advisory to the changelog
and PR body. No contributor history was rewritten. The candidate commits are
GitHub-verified signed.

This is the candidate validation checkpoint. The final publication and registry
receipt is maintained in the linked [release PR review](https://github.com/rynfar/meridian/pull/1418).
Until that review explicitly records successful publication and fresh installed
validation, those gates remain pending. A merged release PR alone is not
publication proof.

## Adversarial review

The [complete range](previous-release-range.txt) and [metadata diff](candidate-metadata.diff)
were inspected against `meridian-v1.83.1`. Product changes are provider-chip URL
views, the Bun cancellation advisory and typed OpenAI stream errors. Tests and
maintenance evidence account for the remaining changes. Dependencies, public
plugin contracts, source CLI commands, native execution defaults and desktop
product code are unchanged. Held storage, quota, settings and native
fallback/cache investigations are not included. The Bun entry is an advisory,
not a cancellation repair. The stream failure proof is a real connection reset,
not a safeguard-classifier reproduction.

Existing before/after and negative controls remain in [the merged backlog proof](../backlog-20261019/README.md).
This release does not claim to clear its native refusal/fallback or historical
E41 model/cache holds. The refused load warm-up was not retried, restated or
switched to another model.

## Independently installed candidate

The clean candidate passed standalone typecheck and a certified build, then
`npm pack --ignore-scripts`. Its tarball integrity is
`sha512-XZsDwibCgcFdVlSso/xVlOvjSLqryDpTwPvtf2t5wo6yD6oW6rXxzAYpRCjC57zv20cp1L3wkes8Q+BFfHCHzw==`.
The tarball was installed with npm into a fresh prefix, with independently
resolved dependencies and no source symlinks.

- [Live installed comparison](pack-live-summary.json): native Node 22.22.3,
  Darwin arm64, real AgentLink 1.44.5 production transport at
  `ab98566573e893fc4667971a86573fb56beec677`, SDK 0.2.141, native Claude Code
  2.1.302 SHA256 `5262ce9de86243fed0d21edc39b271555d56780d0112e2b194439fe1c6662d37`,
  real Opus 5.5. Healthy completion passed. Published 1.83.1 incorrectly completed
  an interrupted partial stream; packed 1.84.0 raised a typed client error and
  retained text, with no successful model stop or client resend. Each case
  admitted one actual provider generation; provider/native IDs matched 5.5.
  Original native children and both output pipes closed. Local relay denials
  bounded native retries after the deliberate connection cut.
- [Eight CLI controls](pack-cli.json): installed Bun warning, unchanged Node
  startup, silent suppression, clean health-related response bodies, both
  runtimes' help/version output and graceful shutdown. This credentialless
  probe denies Keychain execution and never queries a model.
- [Eight browser assertions](pack-browser.json): actual installed production
  `/` and `/profiles` pages, synthetic profile API fixture, T3 collaborative
  browser 1280 × 800. URL selection, last-off, empty reload and Show all passed
  on both pages while saved preferences remained unchanged. This verifies
  filtering, not account login or provider entitlement. A final screenshot was
  visually inspected; synthetic account metadata is deliberately incomplete.

## Runnable probes

`installed-host.mjs` imports the installed `dist/server.js` under native Node.
It keeps Meridian's original process gate and the actual SDK/native parser.
An owned Node `execve` trampoline enters the pinned native executable with the
same PID and stdio, changing only its base URL to a fixed-provider loopback
relay. The relay admits one exact-model generation, blocks further attempts,
and latches on refusals or unexpected models. It never logs credentials or
provider prompts. All filesystem/config/session paths belong to the probe.

Prepare an untouched AgentLink checkout at the commit above with its dependencies
installed. Build the actual transport with pinned Bun; no model starts here:

```sh
bun prepare-agentlink.mjs /absolute/agentlink /new/output/client
```

Use the repository's existing [read-only usage guard](../backlog-20261019/1399/read-only-load-usage-guard.mjs)
and [access-only grant helper](../backlog-20261019/1399/create-access-only-grant.mjs).
Their explicit live opt-in and private path requirements apply. Never refresh
owner credentials, enable paid usage, retry a refusal or change accounts to
obtain a passing result. Keep the grant private and delete it after owned
children have joined.

```sh
E2E_NATIVE_BIN=/absolute/pinned/claude \
E2E_AGENTLINK_CLIENT=/new/output/client/agentlink-client.mjs \
node installed-flow.mjs /absolute/installed/meridian /new/output/live \
  /private/access-only-grant.json /absolute/installed/1.83.1
node installed-cli.mjs /absolute/installed/meridian \
  /absolute/installed/1.83.1 /new/output/cli /absolute/pinned/bun
node installed-host.mjs /absolute/installed/meridian /new/output/ui ui /usr/bin/false
```

The UI host prints its origin in `ready.json`. Use the browser controls in
[the original browser harness](../backlog-20261019/1411/browser-control.js),
substituting that origin. API fixtures are synthetic; page HTML/JavaScript is
served by the actual installed package. Stop the owned host after checking.

Probe preparation retained failures: the older source driver assumed nested
SDK dependencies and failed before starting a model; the first controller had
a variable-shadowing error and started none; the first healthy Node run missed
the relay because the production shell gate reconstructs the native environment.
That run had a correct healthy native 5.5 response and clean shutdown, but zero
observed relay generations. The execve correction established the missing
relay boundary and the three-case matrix passed. No refused task was rerun.
The portable client build differs from the initial build only in a generated
source-path comment. The interrupted local full suite was not counted as a
completed gate; the unchanged candidate was restarted for a complete result.

## Final receipts

The [candidate CI summary](candidate-ci-summary.json) records the exact-head
24-invocation Linux full suite: 7,017 pass, one skip, zero failures. All 14
final contexts passed or legitimately skipped, including Windows, desktop,
Nix Linux/macOS, Docker, availability and attribution. [Candidate review](candidate-review.json)
checks the complete metadata diff and exclusion of held PR heads. The final
local full-suite result and log hashes are retained alongside this record.
Publication commit/tag, npm integrity/provenance, fresh registry validation,
Docker architectures and desktop artifacts are recorded in the release PR
review when verified. The [original checkout receipt](original-checkout-preserved.json)
verifies all 12 saved hashes.

[The complete local gate](local-validation.json) passed on the exact candidate:
6,982 pass / 36 skip / zero failures across all 24 isolated invocations, Bun
1.3.11, Node 22.22.3, Darwin arm64. Standalone typecheck and certified build
also passed. The interrupted attempt is retained by hash and not counted.
