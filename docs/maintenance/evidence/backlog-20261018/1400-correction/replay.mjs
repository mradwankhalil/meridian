// Offline replay only. Run from any checkout containing the reviewed tests.
// PR1400_BUN must identify Bun 1.3.11. The original fixture is retained byte-for-byte.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const evidence = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? process.cwd());
const output = resolve(process.argv[3] ?? `${evidence}/replay-output`);
const bun = process.env.PR1400_BUN ?? '/tmp/meridian-1400-tooling/bin/bun';
const version = spawnSync(bun, ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== '1.3.11') throw new Error('Bun 1.3.11 is required');
mkdirSync(output, { recursive: true });
const priorRoot = JSON.parse(readFileSync(`${evidence}/commands.json`, 'utf8')).root;
const fixture = `${output}/offline-fixture.ts`;
writeFileSync(fixture, readFileSync(`${evidence}/offline-fixture.ts`, 'utf8').replaceAll(priorRoot, root));
const checks = [
  ['source', [resolve(evidence, 'pool-source-probe.ts'), root]],
  ['active', ['test', '--preload', fixture, 'src/__tests__/active-priority-integration.test.ts']],
  ['retained', ['test', '--preload', fixture, 'src/__tests__/priority-routing-integration.test.ts', '--test-name-pattern', 'keeps the retained account']],
  ['units', ['test', '--preload', fixture, 'src/__tests__/routing.test.ts', 'src/__tests__/errors.test.ts', 'src/__tests__/limit-detection.test.ts', 'src/__tests__/retry-after-unit.test.ts']],
];
const results = [];
for (const [name, args] of checks) {
  const run = spawnSync(bun, args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(`${output}/${name}.log`, (run.stdout ?? '') + (run.stderr ?? ''));
  results.push({ name, command: [bun, ...args], exitCode: run.status, error: run.error?.message ?? null });
}
writeFileSync(`${output}/results.json`, JSON.stringify({ bun: version.stdout.trim(), root, results }, null, 2) + '\n');
console.log(JSON.stringify(results));
if (results.some(result => result.exitCode !== 0)) process.exitCode = 1;
