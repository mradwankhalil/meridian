// Credential-free: real SDK/MCP tools/list only, no query() or model calls.
// Usage: bun /absolute/path/to/this.mjs /absolute/path/to/meridian-checkout
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? process.cwd());
const require = createRequire(join(root, "package.json"));
const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")));
const { InMemoryTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/inMemory.js")));
const { createPassthroughMcpServer, sharedPassthroughMcpServer } = await import(pathToFileURL(join(root, "src/proxy/passthroughTools.ts")));
const sdk = JSON.parse(readFileSync(join(dirname(require.resolve("@anthropic-ai/claude-agent-sdk")), "package.json"), "utf8")).version;
const rows = [];
for (const nested of [false, true]) {
  for (const order of [["a", "b"], ["b", "a"]]) {
    function tools(names) {
      const properties = Object.fromEntries(names.map(name => [name, { type: "string" }]));
      return [{ name: "order_probe", input_schema: {
        type: "object", properties: nested ? { options: { type: "object", properties } } : properties,
      } }];
    }
    const reverse = [...order].reverse();
    const aTools = tools(order), bTools = tools(reverse);
    const original = JSON.stringify([aTools, bTools]);
    const namespace = `probe_${nested ? "nested" : "root"}_${order.join("")}`;
    const a = sharedPassthroughMcpServer(aTools, undefined, namespace);
    const b = sharedPassthroughMcpServer(bTools, undefined, namespace);
    const fresh = createPassthroughMcpServer(bTools, undefined, namespace);
    const servers = [a.createServer(), b.createServer(), b.createServer(), fresh.createServer()];
    const clients = [];
    try {
      for (const server of servers) {
        const client = new Client({ name: "order-probe", version: "1" });
        clients.push(client);
        const [transportA, transportB] = InMemoryTransport.createLinkedPair();
        await server.instance.connect(transportB);
        await client.connect(transportA);
      }
      const catalogs = await Promise.all(clients.map(async client => (await client.listTools()).tools));
      const properties = catalog => nested ? catalog[0].inputSchema.properties.options.properties : catalog[0].inputSchema.properties;
      await clients[0].close();
      await clients[1].close();
      const retained = (await clients[2].listTools()).tools;
      const called = await clients[2].callTool({ name: "order_probe", arguments: nested ? { options: { a: "a", b: "b" } } : { a: "a", b: "b" } });
      rows.push({
        nested, firstDeclaredOrder: order, secondDeclaredOrder: reverse,
        sharedObject: a === b,
        identicalCloneReused: sharedPassthroughMcpServer(structuredClone(bTools), undefined, namespace) === b,
        independentTransports: new Set(servers.map(server => server.instance)).size === servers.length,
        firstAdvertisedOrder: Object.keys(properties(catalogs[0])),
        secondAdvertisedOrder: Object.keys(properties(catalogs[1])),
        freshSecondOrder: Object.keys(properties(catalogs[3])),
        serializedCatalogEqual: JSON.stringify(catalogs[1]) === JSON.stringify(catalogs[3]),
        secondUnaffectedByClose: JSON.stringify(retained) === JSON.stringify(catalogs[1]),
        callSucceeded: !called.isError,
        inputUnchanged: JSON.stringify([aTools, bTools]) === original,
      });
    } finally {
      for (const client of clients) await client.close();
      for (const server of servers) await server.instance.close();
    }
  }
}
console.log(JSON.stringify({ sdk, runtime: { bun: Bun.version, node: process.versions.node, platform: process.platform, arch: process.arch }, modelCalls: 0, rows }, null, 2));
for (const row of rows) {
  assert.equal(row.sharedObject, false, "differently ordered schemas must not share a built set");
  assert.deepEqual(row.firstAdvertisedOrder, row.firstDeclaredOrder);
  assert.deepEqual(row.secondAdvertisedOrder, row.secondDeclaredOrder);
  assert.deepEqual(row.freshSecondOrder, row.secondDeclaredOrder);
  for (const name of ["identicalCloneReused", "independentTransports", "serializedCatalogEqual", "secondUnaffectedByClose", "callSucceeded", "inputUnchanged"]) assert.equal(row[name], true, name);
}
