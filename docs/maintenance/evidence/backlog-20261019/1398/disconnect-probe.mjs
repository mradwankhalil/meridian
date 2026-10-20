import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const out = process.argv[3];
if (!process.argv[2] || !out || !process.argv[4]) throw new Error('source-root output-root bun-path required');
mkdirSync(out, { recursive: true });
const serverFile = out + '/disconnect-server.mjs';
writeFileSync(serverFile, `import { createServer } from 'node:http';
import { serve } from ${JSON.stringify(process.argv[2] + '/node_modules/@hono/node-server/dist/index.mjs')};
const mode = process.argv[2];
const events = [];
let started, accepted = false, aborted = false;
let finishTimer;
const record = name => events.push({name, ms: Date.now() - started});
function finish() {
  console.log(JSON.stringify({ result: true, mode, accepted, aborted, events, runtime: process.versions.bun ? 'Bun '+process.versions.bun : 'Node '+process.versions.node }));
  server.closeAllConnections();
  server.close();
  setTimeout(() => process.exit(0), 50);
}
const server = mode === 'http' ? createServer((req, res) => {
  accepted = true; started = Date.now();
  req.on('close', () => record('req.close'));
  res.on('close', () => record('res.close'));
  req.socket.on('close', () => record('socket.close'));
  finishTimer = setTimeout(finish, 2300);
  // Deliberately do not send headers or body before the client disconnects.
}) : serve({ hostname: '127.0.0.1', port: 0, overrideGlobalObjects: false, fetch: async req => {
  accepted = true; started = Date.now();
  req.signal.addEventListener('abort', () => { aborted = true; record('request.signal.abort'); });
  finishTimer = setTimeout(finish, 2300);
  await new Promise(resolve => setTimeout(resolve, 5000));
  return new Response('late');
} }, info => console.log(JSON.stringify({port: info.port})));
if (mode === 'http') server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({port: server.address().port})));
setTimeout(() => { if (!accepted) { console.error('no request received'); process.exit(2); } }, 6000).unref();
`);
const results = [];
try {
  for (const runtime of [process.execPath, process.argv[4]]) {
    for (const mode of ['http', 'hono']) {
      const child = spawn(runtime, [serverFile, mode], { env: { PATH: '/usr/bin:/bin', HOME: out }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '', port;
      child.stdout.on('data', x => { stdout += x; const line = stdout.split('\n').find(line => line.startsWith('{"port":')); if (line) port = JSON.parse(line).port; });
      child.stderr.on('data', x => { stderr += x; });
      const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({code, signal})); });
      try {
        const deadline = Date.now() + 5000;
        while (!port && Date.now() < deadline && child.exitCode === null) await delay(20);
        assert(port, 'server must listen');
        const client = net.connect({host: '127.0.0.1', port});
        await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
        client.write('POST /probe HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}');
        let bytes = 0;
        client.on('data', x => { bytes += x.length; });
        await delay(300);
        client.destroy();
        const exit = await Promise.race([closed, delay(5000).then(() => null)]);
        assert(exit, 'probe bounded completion');
        assert.equal(exit.code, 0);
        assert.equal(stderr, '');
        assert.equal(bytes, 0, 'client left before response first byte');
        const result = stdout.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(x => x.result);
        assert(result?.accepted, 'actual HTTP request observed');
        const isBun = runtime.endsWith('/bun');
        if (mode === 'http') assert.deepEqual(result.events.map(x => x.name).sort(), isBun ? [] : ['req.close', 'res.close', 'socket.close']);
        else assert.equal(result.aborted, !isBun);
        results.push({...result, bytesReceivedByClient: bytes, exit, observedWindowMs: 2300});
        console.log(JSON.stringify(results.at(-1)));
      } finally {
        if (child.exitCode === null) { child.kill('SIGKILL'); await closed; }
        writeFileSync(out + '/' + (runtime.endsWith('/bun') ? 'bun' : 'node') + '-' + mode + '.log', stdout + stderr);
      }
    }
  }
  writeFileSync(out + '/disconnect-results.json', JSON.stringify({passed: true, results}, null, 2));
} catch (error) {
  writeFileSync(out + '/disconnect-results.json', JSON.stringify({passed: false, error: String(error), results}, null, 2));
  throw error;
}
