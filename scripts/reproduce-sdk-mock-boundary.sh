#!/bin/sh
# Offline before/after proof. Native APIs are refused inside each Bun worker.
set -eu
baseline_ref=${1:-da8187ab4553e4fd2120aa0098b2a81b197502dc}
evidence_dir=${2:-$(mktemp -d /tmp/meridian-sdk-boundary-proof.XXXXXX)}
: "${BUN:?Set BUN to the absolute Bun 1.3.11 executable}"
[ "$("$BUN" --revision)" = '1.3.11+af24e281e' ] || { echo 'Bun 1.3.11 af24e281e required' >&2; exit 2; }
source_root=$(git rev-parse --show-toplevel)
mkdir -p "$evidence_dir"
evidence_dir=$(cd "$evidence_dir" && pwd)
baseline_dir="$evidence_dir/baseline-source"
[ ! -e "$baseline_dir" ] || { echo 'Use a new evidence directory' >&2; exit 2; }
mkdir "$baseline_dir"
git archive "$baseline_ref" | tar -x -C "$baseline_dir"
ln -s "$source_root/node_modules" "$baseline_dir/node_modules"
cp "$source_root/src/__tests__/fixtures/sdk-native-trap.ts" "$baseline_dir/src/__tests__/fixtures/"
cp "$source_root/src/__tests__/proxy-system-reminder-preservation.test.ts" "$baseline_dir/src/__tests__/"
# Add only the query identity and sentinel exports needed by the exact same
# assertions. This instruments the old helper without adding the boundary fix.
python3 - "$baseline_dir/src/__tests__/sdkMock.ts" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text()
old = '''mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: never[]) => resolve("query")(...args),'''
new = '''export const MOCK_CLAUDE_EXECUTABLE = "meridian-sdk-fixture-not-executable"
export const sdkMockQuery = (...args: never[]) => resolve("query")(...args)

mock.module("@anthropic-ai/claude-agent-sdk", () => ({
  query: sdkMockQuery,'''
if text.count(old) != 1:
    raise SystemExit("Baseline SDK helper shape changed; inspect before adapting proof")
path.write_text(text.replace(old, new))
PY
baseline_exit=0
(cd "$baseline_dir" && SDK_BOUNDARY_CONTROL=0 "$BUN" test --preload ./src/__tests__/fixtures/sdk-native-trap.ts src/__tests__/proxy-system-reminder-preservation.test.ts) > "$evidence_dir/baseline.log" 2>&1 || baseline_exit=$?
[ "$baseline_exit" -ne 0 ]
rg -q 'Expected: "meridian-sdk-fixture-not-executable"' "$evidence_dir/baseline.log"
rg -q 'SDK_BOUNDARY_TRAP .*"attempts":\["exec"' "$evidence_dir/baseline.log"
rg -q '"actualNativeChildren":0,"actualNetworkCalls":0' "$evidence_dir/baseline.log"
(cd "$source_root" && SDK_BOUNDARY_CONTROL=0 "$BUN" test --preload ./src/__tests__/fixtures/sdk-native-trap.ts src/__tests__/proxy-system-reminder-preservation.test.ts) > "$evidence_dir/candidate.log" 2>&1
rg -q 'SDK_BOUNDARY_TRAP .*"attempts":\[\]' "$evidence_dir/candidate.log"
printf 'PASS: baseline exit %s with trapped resolver/auth attempts; candidate exit 0 with no native/network attempts.\n' "$baseline_exit"
