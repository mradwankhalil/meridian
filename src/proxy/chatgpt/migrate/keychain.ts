/**
 * Access to the OS keychain entries oc-codex-multi-auth writes when it runs
 * with `CODEX_KEYCHAIN=1`.
 *
 * The plugin talks to the keychain through `@napi-rs/keyring`. Meridian does
 * not depend on that package, so it is loaded only if it happens to be
 * installed, and only when the operator opted in - probing the keychain can
 * raise an OS permission prompt, which a migration that has nothing to find
 * there should never cause. Tests inject an in-memory backend.
 */

export interface KeychainBackend {
  get(service: string, account: string): Promise<string | null>
  set(service: string, account: string, secret: string): Promise<void>
}

interface KeyringEntry {
  getPassword(): string | null
  setPassword(secret: string): void
}

interface KeyringModule {
  Entry: new (service: string, account: string) => KeyringEntry
}

function isKeyringModule(value: unknown): value is KeyringModule {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "Entry") === "function"
}

/** Null when the native module is not installed. */
export async function loadNativeKeychainBackend(): Promise<KeychainBackend | null> {
  let module: unknown
  try {
    // The specifier is a variable so the bundler leaves an optional,
    // uninstalled package alone instead of failing the build on it.
    const specifier = "@napi-rs/keyring"
    module = await import(specifier)
  } catch {
    return null
  }
  if (!isKeyringModule(module)) return null
  const keyring = module
  return {
    async get(service, account) {
      return new keyring.Entry(service, account).getPassword() ?? null
    },
    async set(service, account, secret) {
      new keyring.Entry(service, account).setPassword(secret)
    },
  }
}
