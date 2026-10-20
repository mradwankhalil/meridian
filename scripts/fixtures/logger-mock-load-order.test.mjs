// Reproduce the process-global logger registration order behind #933's fast
// failure-observer assertion: shared mock first, telemetry routes second.
// The original suites supply every assertion; do not substitute a dummy logger
// assertion. Register SDK/MCP dispatchers before loading server.ts so this
// controlled import-order fixture remains entirely offline.
await import(new URL('../../src/__tests__/loggerMock.ts', import.meta.url).href)
await import(new URL('../../src/__tests__/sdkMock.ts', import.meta.url).href)
await import(new URL('../../src/__tests__/mcpToolsMock.ts', import.meta.url).href)
await import(new URL('../../src/__tests__/telemetry-settings-routes.test.ts', import.meta.url).href)
await import(new URL('../../src/__tests__/passthrough-early-stop-integration.test.ts', import.meta.url).href)
