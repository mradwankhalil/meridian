// Actual production page modules, safe synthetic responses, loopback only.
// Usage: bun provider-filter-fixture.ts /absolute/source-root 42241 baseline
const [root, port, label] = process.argv.slice(2)
if (!root || !port || !label) throw new Error('source root, port and label required')
const { landingHtml } = await import(root + '/src/telemetry/landing.ts')
const { profilePageHtml } = await import(root + '/src/telemetry/profilePage.ts')
const profiles = { profiles: [
  { id: 'c1', label: 'Synthetic Claude', type: 'claude-max', loggedIn: true, isActive: true },
  { id: 'g1', label: 'Synthetic ChatGPT', provider: 'chatgpt', type: 'chatgpt', seat: 'fixture-seat', loggedIn: true, isActive: true },
], routing: 'active' }
const health = { status: 'healthy', uptime: 0, auth: { loggedIn: true }, build: { version: '1.83.1', source: 'npm' } }
const server = Bun.serve({hostname: '127.0.0.1', port: Number(port), fetch(req) {
  const url = new URL(req.url)
  if (req.method !== 'GET') return new Response('Read-only fixture', { status: 405 })
  if (url.pathname === '/') return new Response(landingHtml, {headers: {'Content-Type':'text/html; charset=utf-8'}})
  if (url.pathname === '/profiles') return new Response(profilePageHtml, {headers: {'Content-Type':'text/html; charset=utf-8'}})
  if (url.pathname === '/profiles/list') return Response.json(profiles)
  if (url.pathname === '/health') return Response.json(health)
  if (url.pathname === '/telemetry/summary') return Response.json({totalRequests:0, tokenUsage:{}, totalDuration:{}})
  if (url.pathname === '/v1/usage/quota/all') return Response.json({profiles:[]})
  if (url.pathname === '/settings/api/routing') return Response.json({routing:'active', order:['c1','g1']})
  return Response.json({}, {status:404})
}})
console.log(JSON.stringify({label, port:server.port, root, synthetic:true, credentials:false, modelCalls:false}))
const stop = () => { server.stop(true); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
