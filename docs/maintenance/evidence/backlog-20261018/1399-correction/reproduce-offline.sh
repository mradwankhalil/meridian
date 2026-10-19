#!/bin/sh
# No model calls, account changes, or private transcript reads. Creates only
# disposable source copies and synthetic session stores. Run from any checkout
# containing both recorded commits. The final SHA is supplied after correction.
set -eu
REPO=${1:?usage: reproduce-offline.sh REPOSITORY FINAL_SHA}
FINAL_SHA=${2:?usage: reproduce-offline.sh REPOSITORY FINAL_SHA}
BUN=${BUN:-bun}
test "$("$BUN" --version)" = 1.3.11
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/meridian-1399-repro.XXXXXX")
trap 'rm -rf "$SCRATCH"' EXIT HUP INT TERM
for MODE in original corrected; do
  TREE="$SCRATCH/$MODE"
  mkdir -p "$TREE"
  if test "$MODE" = original; then
    SHA=a8fccdbdd9abe0f196168cf0a34a341caba1e1a5
  else
    SHA=$FINAL_SHA
  fi
  git -C "$REPO" archive "$SHA" | tar -x -C "$TREE"
  (
    cd "$TREE"
    "$BUN" install --frozen-lockfile --ignore-scripts
    if test "$MODE" = original; then
      git apply "$SCRIPT_DIR/regression-tests.patch"
    fi
    set +e
    "$BUN" test src/__tests__/proxy-session-gc-capacity.test.ts > "$SCRIPT_DIR/reproduced-$MODE.log" 2>&1
    STATUS=$?
    set -e
    printf '%s\n' "$STATUS" > "$SCRIPT_DIR/reproduced-$MODE.exit"
    if test "$MODE" = original; then
      test "$STATUS" -eq 1
      # Exactly the two overlapping-close cases fail, with 64 attempts each.
      test "$(grep -c '^Received: 64$' "$SCRIPT_DIR/reproduced-$MODE.log")" -eq 2
      grep -q '^ 2 fail$' "$SCRIPT_DIR/reproduced-$MODE.log"
    else
      test "$STATUS" -eq 0
      grep -q '^ 0 fail$' "$SCRIPT_DIR/reproduced-$MODE.log"
    fi
  )
done
printf 'Reproduced original failure and corrected success; logs in %s\n' "$SCRIPT_DIR"
