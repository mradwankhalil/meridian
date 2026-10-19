import { afterAll, beforeAll, mock } from "bun:test"
import * as models from "../proxy/models"
import * as tokenRefresh from "../proxy/tokenRefresh"
import { isAbsolute, relative, resolve, sep } from "node:path"

// Snapshot values: retaining the live namespace would recurse once Bun replaces
// its exports. Only this module registers the mock; files select implementations
// when their tests run, just like sdkMock (#917).
const original = { ...models }
type ModelExport = (...args: never[]) => unknown
export type ModelsMockModule = Partial<{
  [K in keyof typeof models]: typeof models[K] extends ModelExport ? ModelExport : typeof models[K]
}>
let active: ModelsMockModule | null = null
let activeOwner: object | undefined
let sdkBoundary: ModelsMockModule | null = null
let sdkInstalled = false
const realTokens = { ...tokenRefresh }
const createRealStore = realTokens.createPlatformCredentialStore
const emptyStore: tokenRefresh.CredentialStore = {
  read: async () => null,
  write: async () => { throw new Error("SDK mock must not write credentials") },
}
// An ordinary mocked query must not read the host's Keychain or credential file
// in its proactive refresh before query(). Explicit store spies still override
// this stable wrapper; native resolver/auth fixtures keep their own doubles.
const fixtureStore = (store?: tokenRefresh.CredentialStore) =>
  store ?? (active || sdkInstalled ? emptyStore : undefined)
const tokenMock = { ...realTokens,
  createPlatformCredentialStore: (...args: Parameters<typeof createRealStore>) =>
    active || sdkInstalled ? emptyStore : createRealStore(...args),
  // Pass the fixture explicitly: the real functions' default-store calls are
  // lexical and do not go through the mocked exported factory above.
  ensureFreshToken: (store?: tokenRefresh.CredentialStore, ...args: [number?]) =>
    realTokens.ensureFreshToken(fixtureStore(store), ...args),
  refreshOAuthToken: (store?: tokenRefresh.CredentialStore) => realTokens.refreshOAuthToken(fixtureStore(store)),
  startBackgroundRefresh: (store?: tokenRefresh.CredentialStore, ...args: [number?, number?]) =>
    realTokens.startBackgroundRefresh(fixtureStore(store), ...args),
  getStoredPlanFields: (store?: tokenRefresh.CredentialStore) => realTokens.getStoredPlanFields(fixtureStore(store)),
  getAuthRenewalStatus: (store?: tokenRefresh.CredentialStore, ...args: [number?]) =>
    realTokens.getAuthRenewalStatus(fixtureStore(store), ...args),
}
mock.module("../proxy/tokenRefresh", () => tokenMock)

export const MOCK_CLAUDE_EXECUTABLE = "meridian-sdk-fixture-not-executable"
export const syntheticClaudeBoundary = {
  resolveClaudeExecutableAsync: async () => MOCK_CLAUDE_EXECUTABLE,
  getClaudeAuthStatusAsync: async () => ({ loggedIn: true, subscriptionType: "max" }),
} satisfies ModelsMockModule

const modelMock = Object.fromEntries(
  Object.entries(original).map(([name, value]) => [name, typeof value !== "function" ? value : (...args: unknown[]) => {
    const key = name as keyof typeof models
    const implementation = active?.[key] ?? sdkBoundary?.[key] ?? value
    if (typeof implementation !== "function") throw new Error(`Invalid models fixture export: ${name}`)
    return Reflect.apply(implementation, undefined, args)
  }]),
)
mock.module("../proxy/models", () => modelMock)

/** File-scoped overrides; unmentioned exports use the real implementation. */
export function installModelsMock(factory: () => ModelsMockModule): void {
  const owner = {}
  beforeAll(() => { active = factory(); activeOwner = owner })
  afterAll(() => { if (activeOwner === owner) { active = null; activeOwner = undefined } })
}

/** For a running test that changes its answer, without registering new hooks. */
export function setModelsMock(factory: () => ModelsMockModule): void {
  active = factory()
}

export function setSdkModelsBoundary(native = false): ModelsMockModule | null {
  sdkInstalled = true
  return sdkBoundary = native ? null : syntheticClaudeBoundary
}

export function clearSdkModelsBoundary(): void {
  sdkBoundary = null; sdkInstalled = false
}

/** Dedicated persistence tests may retain their owned backend, never a host default.
 * The caller selects the emulated file platform with the existing token helper. */
export function createOwnedCredentialStore(root: string, directory: string | undefined): tokenRefresh.CredentialStore {
  if (!directory) throw new Error("Owned credential fixture requires an explicit directory")
  const path = resolve(directory)
  const within = relative(resolve(root), path)
  if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    throw new Error("Credential fixture escaped its owned root")
  }
  return createRealStore({ claudeConfigDir: path })
}

/** For non-test-runner workers: verify interception before any HTTP/native call. */
export async function assertSyntheticClaudeBoundary(): Promise<void> {
  const currentModels = await import("../proxy/models")
  const currentTokens = await import("../proxy/tokenRefresh")
  if (!sdkInstalled || sdkBoundary !== syntheticClaudeBoundary
    || currentModels.resolveClaudeExecutableAsync !== modelMock.resolveClaudeExecutableAsync
    || currentModels.getClaudeAuthStatusAsync !== modelMock.getClaudeAuthStatusAsync
    || currentTokens.createPlatformCredentialStore !== tokenMock.createPlatformCredentialStore) {
    throw new Error("Synthetic Claude boundary mock identity was not installed")
  }
}
