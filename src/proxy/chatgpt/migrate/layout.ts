/**
 * Where oc-codex-multi-auth and opencode keep the things a ChatGPT migration
 * touches, for one HOME.
 *
 * Every path is derived from an explicit `MigrationEnvironment` rather than
 * from `os.homedir()` or `process.env`, so a test - or an operator inspecting
 * another profile - names the home it means and cannot reach the real one by
 * accident.
 *
 * The file names mirror oc-codex-multi-auth `lib/constants.ts` and
 * `lib/storage/{paths,keychain,transaction-lock}.ts`, and opencode's
 * `Global.Path` (xdg-basedir) and `config/config.ts` load order. They are
 * copied rather than imported: neither project is a dependency of Meridian.
 */

import { join } from "node:path"

export interface MigrationEnvironment {
  home: string
  xdgConfigHome?: string
  xdgDataHome?: string
  /** `OPENCODE_CONFIG`: one extra config file merged after the global ones. */
  opencodeConfig?: string
  /** `OPENCODE_CONFIG_DIR`: one extra config directory. */
  opencodeConfigDir?: string
  /** `OPENCODE_CONFIG_CONTENT`: inline config. Read for its plugin list only. */
  opencodeConfigContent?: string
  /** `OPENCODE_TUI_CONFIG`: one extra TUI config file. */
  opencodeTuiConfig?: string
  disableProjectConfig?: boolean
  /** `CODEX_KEYCHAIN=1`: the plugin keeps its stores in the OS keychain. */
  codexKeychain?: boolean
  /** Directory of opencode's managed (MDM) config. */
  managedConfigDir?: string
}

export const PLUGIN_PACKAGE_NAME = "oc-codex-multi-auth"

export const ACCOUNTS_FILE_NAME = "oc-codex-multi-auth-accounts.json"
export const LEGACY_ACCOUNTS_FILE_NAME = "openai-codex-accounts.json"
export const FLAGGED_ACCOUNTS_FILE_NAME = "oc-codex-multi-auth-flagged-accounts.json"
export const LEGACY_FLAGGED_ACCOUNTS_FILE_NAME = "openai-codex-flagged-accounts.json"
export const LEGACY_BLOCKED_ACCOUNTS_FILE_NAME = "openai-codex-blocked-accounts.json"

export const KEYCHAIN_SERVICE_NAME = "oc-codex-multi-auth"

/** The suffix every original this migration replaces is preserved under. */
export const MERIDIAN_BACKUP_SUFFIX = ".meridian-backup"

/** Opencode loads these three from its global directory, in this order. */
export const GLOBAL_CONFIG_FILE_NAMES = ["config.json", "opencode.json", "opencode.jsonc"] as const

/** The TUI's own config (`config/tui.ts`), which lists the plugin's quota status bar. */
export const TUI_CONFIG_FILE_NAMES = ["tui.json", "tui.jsonc"] as const

export function environmentFromProcess(
  env: NodeJS.ProcessEnv,
  home: string,
): MigrationEnvironment {
  return {
    home,
    xdgConfigHome: env.XDG_CONFIG_HOME || undefined,
    xdgDataHome: env.XDG_DATA_HOME || undefined,
    opencodeConfig: env.OPENCODE_CONFIG || undefined,
    opencodeConfigDir: env.OPENCODE_CONFIG_DIR || undefined,
    opencodeConfigContent: env.OPENCODE_CONFIG_CONTENT || undefined,
    opencodeTuiConfig: env.OPENCODE_TUI_CONFIG || undefined,
    disableProjectConfig: isTruthyFlag(env.OPENCODE_DISABLE_PROJECT_CONFIG),
    codexKeychain: env.CODEX_KEYCHAIN === "1",
  }
}

/** Opencode's own flag parser treats "true" and "1" as set. */
export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.toLowerCase()
  return normalized === "true" || normalized === "1"
}

export function pluginConfigDir(env: MigrationEnvironment): string {
  return join(env.home, ".opencode")
}

export function pluginProjectsDir(env: MigrationEnvironment): string {
  return join(pluginConfigDir(env), "projects")
}

export function opencodeGlobalConfigDir(env: MigrationEnvironment): string {
  return join(env.xdgConfigHome ?? join(env.home, ".config"), "opencode")
}

export function opencodeAuthPath(env: MigrationEnvironment): string {
  return join(env.xdgDataHome ?? join(env.home, ".local", "share"), "opencode", "auth.json")
}

export function defaultManagedConfigDir(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case "darwin":
      return "/Library/Application Support/opencode"
    case "win32":
      return join(process.env.ProgramData || "C:\\ProgramData", "opencode")
    default:
      return "/etc/opencode"
  }
}

export function storeTransactionLockPath(storePath: string): string {
  return `${storePath}.transaction.lock`
}

export function storeRefreshLockPath(storePath: string): string {
  return `${storePath}.refresh.lock`
}

/** `projectKey` null is the global store: `accounts:global`. */
export function keychainAccountKey(projectKey: string | null): string {
  return projectKey ? `accounts:${projectKey}` : "accounts:global"
}

export function keychainFlaggedKey(projectKey: string | null): string {
  return projectKey ? `flagged:${projectKey}` : "accounts:global:flagged"
}
