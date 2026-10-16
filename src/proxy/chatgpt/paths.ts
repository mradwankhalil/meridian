/**
 * Where Meridian's own ChatGPT credentials live, and what guards them.
 *
 * One definition, shared by the importer and the server, because the two must
 * agree exactly. A lock derived one way in the importer and another way in the
 * server is not a lock at all: both processes would take one happily and each
 * would believe it held refresh authority for the same single-use tokens.
 *
 * The store is Meridian's, never the plugin's. Nothing here can name
 * `~/.opencode/oc-codex-multi-auth-accounts.json`.
 */

import { configPath } from "../../configDir"

/**
 * The owned store, beside settings.json in the Meridian config directory.
 * `MERIDIAN_CHATGPT_STORE_PATH` overrides it, which is what lets an instance
 * with an isolated `HOME` - and a test - name its own file rather than the
 * operator's.
 */
export function chatGptStorePath(): string {
  const override = process.env.MERIDIAN_CHATGPT_STORE_PATH
  if (override && override.length > 0) return override
  return configPath("chatgpt-accounts.json")
}

export function chatGptLockPath(storePath: string): string {
  return `${storePath}.lock`
}
