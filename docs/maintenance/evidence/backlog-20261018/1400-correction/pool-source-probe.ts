import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

const root = resolve(process.argv[2] ?? ".")
const { ProfileExhaustion } = await import(pathToFileURL(resolve(root, "src/proxy/routing.ts")).href)
const priorityExhaustion = new ProfileExhaustion(() => 0)
const source = readFileSync(resolve(root, "src/proxy/server.ts"), "utf8")
const helperSource = source.match(/  function poolEarliestReset\([\s\S]*?\n  }/)?.[0]
if (!helperSource) throw new Error("Exact source poolEarliestReset helper not found")
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(helperSource)
const helper = new Function("priorityExhaustion", `${js}\nreturn poolEarliestReset`)(priorityExhaustion)
priorityExhaustion.mark("active", 3 * 60 * 60_000, "rate_limit_error")
priorityExhaustion.mark("other", 4 * 60 * 60_000, "rate_limit_error")
const attemptedReset = 10 * 60_000
priorityExhaustion.mark("active", attemptedReset, "rate_limit_error", "fable")
const reportedMs = Reflect.apply(helper, undefined, [["active", "other"], "fable", attemptedReset])
const effectiveEarliestMs = Math.min(
  priorityExhaustion.benchedUntil("active", "fable"),
  priorityExhaustion.benchedUntil("other", "fable"),
)
console.log(JSON.stringify({ bun: Bun.version, pr: 1400, reportedMs, effectiveEarliestMs }))
if (reportedMs !== effectiveEarliestMs) throw new Error(`Retry-After contradicts effective benches: ${reportedMs} != ${effectiveEarliestMs}`)
