#!/bin/sh
# Synthetic disposable transcripts; supported SDK deleteSession only.
# No model requests or accounts. Run in the recorded final checkout.
set -eu
BUN=${BUN:-bun}
test "$("$BUN" --version)" = 1.3.11
for DRAIN_MODE in 0 1; do
  env -u ORPHANS -u REGISTERED -u MAX_PENDING -u MAX_DELETES -u E2E_MERIDIAN_ROOT \
    DRAINING="$DRAIN_MODE" "$BUN" scripts/e2e-session-gc-throughput.mjs
done
