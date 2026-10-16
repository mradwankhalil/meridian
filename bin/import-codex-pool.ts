#!/usr/bin/env bun
/**
 * One-shot: move the plugin's ChatGPT accounts into Meridian's own store.
 *
 * Run by a human, once, during the ownership transfer, with the plugin
 * stopped. Everything that decides anything lives in
 * `src/proxy/chatgpt/importPool.ts`, which `npm run typecheck` covers and
 * `src/__tests__/import-codex-pool.test.ts` exercises; this file only turns
 * argv into those arguments and the result into words. `bin/` is outside the
 * tsconfig `include`, so logic placed here would be checked by nothing.
 *
 *   bun run bin/import-codex-pool.ts [--pool <path>] [--store <path>]
 *                                    [--force --backup <path>] [--wait <ms>]
 */

import { homedir } from "node:os"
import { join } from "node:path"
import {
  importCodexPool,
  PoolImportRefusedError,
  PoolSourceError,
  type PoolImportOptions,
} from "../src/proxy/chatgpt/importPool"
import { chatGptStorePath } from "../src/proxy/chatgpt/paths"

const USAGE = `Move the oc-codex-multi-auth pool into Meridian's own ChatGPT store, once.

  bun run bin/import-codex-pool.ts [options]

  --pool <path>    Source pool to READ. Never written.
                   Default: $MERIDIAN_CODEX_POOL_PATH, else
                   ~/.opencode/oc-codex-multi-auth-accounts.json
  --store <path>   Destination. Default: $MERIDIAN_CHATGPT_STORE_PATH, else
                   ~/.config/meridian/chatgpt-accounts.json
  --force          Permit replacing an existing store. Requires --backup.
  --backup <path>  Where the replaced store is preserved. Must not exist.
  --wait <ms>      How long to wait for the writer lease. Default 0.
  -h, --help       This text.

Refuses rather than approximating: an existing store, an unparsable pool, an
account with no seat id or no refresh token, or a lease held elsewhere all stop
the run before anything is written.`

function defaultPoolPath(): string {
  return process.env.MERIDIAN_CODEX_POOL_PATH
    || join(homedir(), ".opencode", "oc-codex-multi-auth-accounts.json")
}

function defaultStorePath(): string {
  return chatGptStorePath()
}

function parseArgs(argv: readonly string[]): PoolImportOptions | null {
  const options: PoolImportOptions = {
    poolPath: defaultPoolPath(),
    storePath: defaultStorePath(),
  }

  // A mistyped `--store` would otherwise write the default store instead of
  // the one that was meant, so an unknown flag stops the run.
  const value = (index: number, flag: string): string => {
    const next = argv[index + 1]
    if (next === undefined || next.startsWith("--")) {
      throw new Error(`${flag} needs a value`)
    }
    return next
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case "-h":
      case "--help":
        return null
      case "--pool":
        options.poolPath = value(i, arg); i++; break
      case "--store":
        options.storePath = value(i, arg); i++; break
      case "--backup":
        options.backupPath = value(i, arg); i++; break
      case "--force":
        options.force = true; break
      case "--wait": {
        const raw = value(i, arg); i++
        const parsed = Number.parseInt(raw, 10)
        if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`--wait needs a non-negative number of milliseconds`)
        options.leaseWaitMs = parsed
        break
      }
      default:
        throw new Error(`unknown argument "${arg}"`)
    }
  }
  return options
}

async function main(): Promise<number> {
  let options: PoolImportOptions | null
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[import-codex-pool] ${(error as Error).message}`)
    console.error(USAGE)
    return 2
  }
  if (!options) {
    console.log(USAGE)
    return 0
  }

  console.log(`[import-codex-pool] reading  ${options.poolPath}`)
  console.log(`[import-codex-pool] writing  ${options.storePath}`)

  try {
    const result = await importCodexPool(options)
    if (result.backupPath) {
      console.log(`[import-codex-pool] replaced store preserved at ${result.backupPath}`)
    }
    console.log(`[import-codex-pool] imported ${result.imported.length} account(s):`)
    for (const account of result.imported) {
      const label = account.email ?? account.accountUserId
      const disabled = account.disabledInPool ? "  (disabled in the pool)" : ""
      console.log(`  ${label}  ...${account.accountIdTail}${disabled}`)
    }
    return 0
  } catch (error) {
    if (error instanceof PoolSourceError || error instanceof PoolImportRefusedError) {
      console.error(`[import-codex-pool] ${error.message}`)
      return 1
    }
    console.error(`[import-codex-pool] ${(error as Error).name}: ${(error as Error).message}`)
    return 1
  }
}

if (import.meta.main) {
  process.exit(await main())
}
