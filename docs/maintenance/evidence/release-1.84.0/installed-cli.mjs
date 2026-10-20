import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.argv[2];
if (!root || !process.argv[3] || !process.argv[4]) throw new Error('candidate, baseline, output paths required');
const baseline = process.argv[3];
const out = process.argv[4];
mkdirSync(out, { recursive: true });
const bun = process.argv[5] || '/tmp/meridian-1399-tooling/node_modules/.bin/bun';
const bunVersion = spawnSync(bun, ['--version'], {encoding:'utf8'}).stdout.trim();
const node = process.execPath;
const sandbox = '(version 1)(allow default)(deny process-exec (literal "/usr/bin/security"))';
function environment(label) {
  const dir = mkdtempSync(join(out, label + '-'));
  for (const sub of ['home', 'claude', 'meridian', 'tmp', 'xdg']) mkdirSync(join(dir, sub));
  return { PATH: `${node.slice(0, node.lastIndexOf('/'))}:${bun.slice(0, bun.lastIndexOf('/'))}:/usr/bin:/bin`,
    HOME: join(dir, 'home'), CLAUDE_CONFIG_DIR: join(dir, 'claude'), MERIDIAN_CONFIG_DIR: join(dir, 'meridian'),
    TMPDIR: join(dir, 'tmp'), XDG_CONFIG_HOME: join(dir, 'xdg'),
    MERIDIAN_CLAUDE_PATH: '/usr/bin/false', MERIDIAN_CREDENTIALS_READONLY: '1',
    MERIDIAN_HOST: '127.0.0.1', MERIDIAN_PORT: '0', MERIDIAN_SHUTDOWN_GRACE_MS: '1000',
    NO_COLOR: '1', TERM: 'dumb', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1' };
}
const warning = 'Running under Bun';
const results = [];
async function serverCase(label, cwd, runtime, entry, expectWarning, silent = false) {
  const env = environment(label);
  if (silent) env.MERIDIAN_SILENT = '1';
  // Reserve a unique port because silent startup does not print the selected port.
  const reserve = net.createServer();
  await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  env.MERIDIAN_PORT = String(port);
  const command = ['/usr/bin/sandbox-exec', '-p', sandbox, runtime, entry];
  const child = spawn(command[0], command.slice(1), { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  let result;
  try {
    let live, lastConnectionError;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`${label}: exited before listening (${child.exitCode})`);
      try { live = await fetch(`http://127.0.0.1:${port}/livez`, { signal: AbortSignal.timeout(500) }); if (live.ok) break; } catch (error) { lastConnectionError = String(error); }
      await delay(50);
    }
    assert(live?.ok, `${label}: listening deadline (${lastConnectionError ?? 'no connection error'})`);
    const liveBody = await live.text();
    assert(!liveBody.includes(warning));
    const inflightResponse = await fetch(`http://127.0.0.1:${port}/inflight`, { signal: AbortSignal.timeout(1000) });
    assert.equal(inflightResponse.status, 200);
    const inflightBody = await inflightResponse.text();
    const inflight = JSON.parse(inflightBody);
    assert.equal(inflight.total, 0);
    assert.equal(inflight.scope, 'client-http');
    assert(!inflightBody.includes(warning));
    await delay(100);
    assert.equal(stdout.includes(warning), false, `${label}: warning contaminated stdout`);
    assert.equal((stderr.match(/Running under Bun/g) ?? []).length, expectWarning ? 1 : 0, `${label}: warning count`);
    if (expectWarning) {
      assert(stderr.includes('Bun ' + bunVersion));
      assert(stderr.includes('checked on Bun 1.2.20, 1.3.11, 1.3.14'));
      assert(stderr.includes('npm run build && npm run start'));
      assert(stderr.includes('start meridian with Node (not bunx --bun)'));
    }
    if (silent) assert(!stdout.includes('Meridian running at'));
    result = { label, cwd, command: [runtime, entry], warningCount: expectWarning ? 1 : 0,
      warningOnlyOnStderr: true, livez: { status: live.status, body: liveBody },
      inflight: { status: inflightResponse.status, total: inflight.total, scope: inflight.scope }, silent };
  } finally {
    child.kill('SIGINT');
    const exit = await Promise.race([closed, delay(6000).then(() => null)]);
    if (!exit) { child.kill('SIGKILL'); await closed; }
    writeFileSync(join(out, `${label}.stdout.log`), stdout);
    writeFileSync(join(out, `${label}.stderr.log`), stderr);
    if (result) { result.exit = exit; assert.equal(exit?.code, 0, `${label}: graceful shutdown`); }
  }
  results.push(result);
}
try {
  await serverCase('baseline-bun-dist', baseline, bun, 'dist/cli.js', false);
  await serverCase('candidate-bun-dist', root, bun, 'dist/cli.js', true);
  await serverCase('candidate-node-dist', root, node, 'dist/cli.js', false);
  await serverCase('candidate-bun-silent', root, bun, 'dist/cli.js', false, true);
  for (const runtime of [bun, node]) {
    for (const option of ['--version', '--help']) {
      const child=spawnSync('/usr/bin/sandbox-exec',['-p',sandbox,runtime,'dist/cli.js',option],{cwd:root,env:environment('command-control'),encoding:'utf8',timeout:10000});
      assert.equal(child.status,0);assert.equal(child.stderr,'');assert(!child.stdout.includes(warning));
      if(option==='--version')assert.equal(child.stdout,JSON.parse(readFileSync(join(root,'package.json'))).version+'\n');
      else assert(child.stdout.startsWith('meridian v'));
      results.push({runtime,entry:'dist/cli.js',option,exit:child.status,stdoutValid:true,stderrEmpty:true});
    }
  }
  writeFileSync(join(out, 'cli-results.json'), JSON.stringify({ passed: true, platform: process.platform, arch: process.arch, node: process.version, results }, null, 2));
  console.log(JSON.stringify({ passed: true, cases: results.length, resultsFile: join(out, 'cli-results.json') }));
} catch (error) {
  writeFileSync(join(out, 'cli-results.json'), JSON.stringify({ passed: false, error: String(error), results }, null, 2));
  throw error;
}
