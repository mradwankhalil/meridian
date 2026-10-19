#!/usr/bin/env python3
"""Run each skipped npm-test stage once after a failed first stage, then final gates.
Never reclassifies a failed npm test as green. No model calls.
"""
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import time

repo = Path(sys.argv[1]).resolve()
out = Path(__file__).resolve().parent
bun_bin = Path(sys.argv[2]).resolve().parent
env = {**os.environ, 'PATH': str(bun_bin) + os.pathsep + os.environ['PATH']}
commands = json.loads((repo / 'package.json').read_text())['scripts']['test'].split(' && ')
assert len(commands) == 24, len(commands)
assert (out / 'npm-test.exit').read_text().strip() != '0', 'npm test already ran all stages'
records = []
gates = [(f'npm-test-stage-{i:02}', shlex.split(cmd)) for i, cmd in enumerate(commands[1:], 2)]
gates += [('typecheck', ['npm', 'run', 'typecheck']), ('build', ['npm', 'run', 'build'])]
for name, argv in gates:
    started = time.time()
    with (out / f'{name}.log').open('w') as log:
        log.write(json.dumps({'argv': argv, 'cwd': str(repo)}) + '\n')
        log.flush()
        result = subprocess.run(argv, cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT)
    record = {'name': name, 'argv': argv, 'exit': result.returncode, 'seconds': round(time.time() - started, 3)}
    records.append(record)
    (out / 'remaining-gates.json').write_text(json.dumps(records, indent=2) + '\n')
    print(json.dumps(record), flush=True)
sys.exit(1 if any(r['exit'] for r in records) else 0)
