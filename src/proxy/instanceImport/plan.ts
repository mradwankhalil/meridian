/**
 * What `meridian instance-import` does, decided from both instances' state.
 *
 * Pure: the importer reads the files, hands their contents here, and writes
 * only what comes back. Anything that would make the destination show a
 * seat, a name or a request differently from the source is a conflict, and a
 * plan with conflicts is never applied.
 *
 * NAMES ARE DECIDED BY SIMULATING THE DESTINATION. A seat's profile id is not
 * stored with the seat: the server derives it from the seat, the saved names
 * and the ids its Claude profiles reserve (chatgpt/profiles.ts), and quietly
 * gives a seat another id, or drops a former name, when one is taken. So the
 * plan builds the destination's view with that same function and requires
 * every seat to come out with the id and the former names it had on the
 * source. Telemetry is filed under those ids, which is what keeps a seat's
 * history on its card.
 */

import { isDeepStrictEqual } from "node:util"
import type { ChatGptAccount } from "../chatgpt/credentials"
import { chatGptNameProblem, chatGptProfiles, type ChatGptProfile } from "../chatgpt/profiles"
import type { ChatGptSeatView } from "../chatgpt/source"

/** One Meridian instance's persisted state, as its files hold it. */
export interface InstanceState {
  /** The ChatGPT store's accounts, in store order. */
  accounts: ChatGptAccount[]
  /** settings.json, whole, so that keys this build does not know survive. */
  settings: Record<string, unknown>
  /** profiles.json: the Claude profiles. */
  claudeProfiles: Array<{ id: string; aliases?: unknown }>
  /** model-pricing.json: price overrides by model. */
  pricing: Record<string, unknown>
}

export interface SeatImport {
  /** `accountUserId`. */
  seat: string
  label: string
  /** The seat's profile id on the source. */
  sourceId: string
  /** Its profile id on the destination: the same, unless `--rename` names another. */
  id: string
  /** Its former names on the destination. */
  aliases: string[]
  /** `present`: the destination already holds this seat's credentials, unchanged. */
  action: "import" | "present"
}

export interface InstanceImportPlan {
  seats: SeatImport[]
  /** Source profile ids filed under another id on the destination: `--rename`, as applied. */
  renamed: ReadonlyMap<string, string>
  /** Top-level settings.json keys to set on the destination. Empty when it already holds them. */
  settings: Record<string, unknown>
  /** model-pricing.json overrides to add to the destination. */
  pricing: Record<string, unknown>
  /** Why the plan cannot be applied. Empty means it can. */
  conflicts: string[]
  /** What stays behind on purpose, or stays the destination's. */
  notes: string[]
}

/** Settings this command carries over; every other key is an instance's own. */
const IMPORTED_SETTINGS = new Set([
  "chatGptActiveSeat",
  "chatGptProfileNames",
  "chatGptProfileAliases",
  "chatgpt",
  "integrations",
  "profileOrder",
])

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

/** The ids a seat may not take on an instance: its Claude profiles' and their former names, and `default`. */
export function reservedProfileIds(claudeProfiles: InstanceState["claudeProfiles"]): Set<string> {
  return new Set(["default", ...claudeProfiles.flatMap(profile => [profile.id, ...stringList(profile.aliases)])])
}

function seatViews(accounts: readonly ChatGptAccount[]): ChatGptSeatView[] {
  return accounts.map((account, index) => ({
    id: account.accountUserId,
    email: account.email,
    planType: null,
    eligible: true,
    expiresAt: account.expiresAt,
    storeIndex: index,
  }))
}

/** The seats as an instance's pages and router name them. */
export function instanceProfiles(
  accounts: readonly ChatGptAccount[],
  settings: Record<string, unknown>,
  claudeProfiles: InstanceState["claudeProfiles"],
): ChatGptProfile[] {
  return chatGptProfiles(seatViews(accounts), {
    reserved: reservedProfileIds(claudeProfiles),
    names: objectValue(settings.chatGptProfileNames),
    aliases: objectValue(settings.chatGptProfileAliases),
  })
}

export function planInstanceImport(input: {
  source: InstanceState
  destination: InstanceState
  /** `--rename`: source profile id -> destination profile id. */
  renames: ReadonlyMap<string, string>
  /** Every profile id the source's telemetry rows are filed under, with how many rows each. */
  telemetryProfileIds: ReadonlyMap<string, number>
}): InstanceImportPlan {
  const { source, destination } = input
  const conflicts: string[] = []
  const notes: string[] = []

  if (source.accounts.length === 0) conflicts.push("the source's ChatGPT store holds no seats")
  if (source.claudeProfiles.length > 0) {
    conflicts.push(
      `the source also has Claude profiles (${source.claudeProfiles.map(profile => profile.id).join(", ")}), `
      + "and this command moves ChatGPT seats and their history only",
    )
  }

  const sourceProfiles = instanceProfiles(source.accounts, source.settings, source.claudeProfiles)
  const sourceBySeat = new Map(sourceProfiles.map(profile => [profile.seat, profile]))
  const known = new Set([...sourceProfiles.flatMap(profile => [profile.id, ...profile.aliases]), ...input.telemetryProfileIds.keys()])
  for (const [from, to] of input.renames) {
    if (!known.has(from)) conflicts.push(`--rename ${from}=${to}: no seat, former name or telemetry of the source is called "${from}"`)
    const problem = chatGptNameProblem(to, new Set())
    if (problem) conflicts.push(`--rename ${from}=${to}: ${problem}`)
  }
  const rename = (id: string): string => input.renames.get(id) ?? id

  const destinationBySeat = new Map(destination.accounts.map(account => [account.accountUserId, account]))
  const seats: SeatImport[] = []
  for (const account of source.accounts) {
    const profile = sourceBySeat.get(account.accountUserId)
    if (!profile) continue
    const held = destinationBySeat.get(account.accountUserId)
    if (held && !isDeepStrictEqual(held, account)) {
      conflicts.push(`${profile.label} (${profile.id}) is in both stores with different credentials, and the destination's may be the newer`)
    }
    if (destination.accounts.some(other => other.accountUserId !== account.accountUserId && other.refreshToken === account.refreshToken)) {
      conflicts.push(`${profile.label} (${profile.id}) has a refresh token the destination holds for another seat`)
    }
    const id = rename(profile.id)
    seats.push({
      seat: account.accountUserId,
      label: profile.label,
      sourceId: profile.id,
      id,
      aliases: [...new Set(profile.aliases.map(rename))].filter(alias => alias !== id),
      action: held ? "present" : "import",
    })
  }
  const importedSeats = new Set(seats.map(seat => seat.seat))
  const labelOf = (seat: string): string => sourceBySeat.get(seat)?.label ?? seat

  const settings: Record<string, unknown> = {}
  const destinationNames = objectValue(destination.settings.chatGptProfileNames)
  const names: Record<string, unknown> = { ...destinationNames }
  for (const seat of seats) {
    const current = destinationNames[seat.seat]
    if (typeof current === "string" && current !== seat.id) {
      conflicts.push(`the destination already calls ${seat.label} "${current}", and the source "${seat.id}"`)
    }
    names[seat.seat] = seat.id
  }
  if (!isDeepStrictEqual(names, destinationNames)) settings.chatGptProfileNames = names

  const destinationAliases = objectValue(destination.settings.chatGptProfileAliases)
  const aliases: Record<string, unknown> = { ...destinationAliases }
  for (const seat of seats) {
    const merged = [...new Set([...stringList(destinationAliases[seat.seat]), ...seat.aliases])]
    if (merged.length > 0) aliases[seat.seat] = merged
  }
  if (!isDeepStrictEqual(aliases, destinationAliases)) settings.chatGptProfileAliases = aliases

  // Who answers to each name on the destination other than the imported
  // seats, so a conflict can say whose name it is.
  const owners = new Map<string, string>([["default", "the destination's unattributed traffic"]])
  for (const profile of destination.claudeProfiles) {
    owners.set(profile.id, `the destination's Claude profile ${profile.id}`)
    for (const alias of stringList(profile.aliases)) owners.set(alias, `a former name of the destination's Claude profile ${profile.id}`)
  }
  const sourceAccounts = new Map(source.accounts.map(account => [account.accountUserId, account]))
  const combinedAccounts = [
    ...destination.accounts,
    ...seats.filter(seat => seat.action === "import").flatMap(seat => sourceAccounts.get(seat.seat) ?? []),
  ]
  const combined = instanceProfiles(combinedAccounts, { chatGptProfileNames: names, chatGptProfileAliases: aliases }, destination.claudeProfiles)
  for (const profile of combined.filter(profile => !importedSeats.has(profile.seat))) {
    owners.set(profile.id, `the destination's seat ${profile.id}`)
    for (const alias of profile.aliases) owners.set(alias, `a former name of the destination's seat ${profile.id}`)
  }
  for (const profile of combined.filter(profile => importedSeats.has(profile.seat))) {
    for (const name of [profile.id, ...profile.aliases]) {
      if (!owners.has(name)) owners.set(name, `taken by ${labelOf(profile.seat)}, also being imported`)
    }
  }
  const ownerOf = (name: string): string => owners.get(name) ?? "taken"

  const combinedBySeat = new Map(combined.map(profile => [profile.seat, profile]))
  for (const seat of seats) {
    const shown = combinedBySeat.get(seat.seat)
    if (!shown) continue
    if (shown.id !== seat.id) {
      conflicts.push(`${seat.label} would be "${shown.id}" on the destination instead of "${seat.id}", which is ${ownerOf(seat.id)}`)
    }
    // A former name that became the seat's own id still counts for it.
    for (const alias of seat.aliases.filter(alias => !shown.aliases.includes(alias) && alias !== shown.id)) {
      conflicts.push(`${seat.label}'s former name "${alias}" is ${ownerOf(alias)} on the destination, so its history would not count for this seat`)
    }
  }

  const seatNames = new Set(seats.flatMap(seat => [seat.id, ...seat.aliases]))
  for (const [filed, rows] of input.telemetryProfileIds) {
    const id = rename(filed)
    if (id === "default" || seatNames.has(id)) continue
    const owner = owners.get(id)
    if (owner) conflicts.push(`${rows} source request(s) are filed under "${filed}", which is ${owner}`)
  }

  const sourceActive = source.settings.chatGptActiveSeat
  if (typeof sourceActive === "string" && importedSeats.has(sourceActive)) {
    const destinationActive = destination.settings.chatGptActiveSeat
    const destinationHolds = typeof destinationActive === "string" && destinationBySeat.has(destinationActive)
    if (!destinationHolds && destinationActive !== sourceActive) settings.chatGptActiveSeat = sourceActive
    else if (destinationHolds && destinationActive !== sourceActive) {
      notes.push(`the destination keeps its own active seat; the source's was ${labelOf(sourceActive)}`)
    }
  }

  for (const key of ["chatgpt", "integrations"] as const) {
    const from = objectValue(source.settings[key])
    const into = objectValue(destination.settings[key])
    const merged: Record<string, unknown> = { ...into }
    for (const [name, value] of Object.entries(from)) {
      if (key === "chatgpt" && name === "seatCreditsPolicy") {
        const intoSeats = objectValue(into[name])
        const mergedSeats: Record<string, unknown> = { ...intoSeats }
        for (const [seat, policy] of Object.entries(objectValue(value))) {
          if (!(seat in intoSeats)) mergedSeats[seat] = policy
          else if (!isDeepStrictEqual(intoSeats[seat], policy)) {
            conflicts.push(`chatgpt.seatCreditsPolicy for ${labelOf(seat)} is ${JSON.stringify(intoSeats[seat])} on the destination and ${JSON.stringify(policy)} on the source`)
          }
        }
        merged[name] = mergedSeats
      } else if (!(name in into)) {
        merged[name] = value
      } else if (!isDeepStrictEqual(into[name], value)) {
        conflicts.push(`${key}.${name} is ${JSON.stringify(into[name])} on the destination and ${JSON.stringify(value)} on the source`)
      }
    }
    if (!isDeepStrictEqual(merged, into)) settings[key] = merged
  }

  // The profile order names seats: an entry is carried over when it names an
  // imported seat, by its seat id or by a name the source knows it by.
  const seatOfEntry = (entry: string): SeatImport | undefined => seats.find(seat => {
    if (seat.seat === entry || seat.sourceId === entry) return true
    return sourceBySeat.get(seat.seat)?.aliases.includes(entry) ?? false
  })
  for (const key of ["profileOrder"] as const) {
    if (!(key in source.settings)) continue
    const into = stringList(destination.settings[key])
    const merged = [...into]
    const behind: string[] = []
    for (const entry of stringList(source.settings[key])) {
      const seat = seatOfEntry(entry)
      if (!seat) {
        behind.push(entry)
        continue
      }
      const mapped = entry === seat.seat ? entry : rename(entry)
      if (!merged.includes(mapped)) merged.push(mapped)
    }
    if (behind.length > 0) notes.push(`${key}: ${behind.join(", ")} name no seat of the source's ChatGPT store and stay behind`)
    if (!isDeepStrictEqual(merged, into)) settings[key] = merged
  }

  const own = Object.keys(source.settings).filter(key => !IMPORTED_SETTINGS.has(key))
  if (own.length > 0) notes.push(`not imported, each instance keeps its own: ${own.join(", ")}`)

  const pricing: Record<string, unknown> = {}
  for (const [model, price] of Object.entries(source.pricing)) {
    if (!(model in destination.pricing)) pricing[model] = price
    else if (!isDeepStrictEqual(destination.pricing[model], price)) {
      conflicts.push(`the price override for ${model} differs between the two instances`)
    }
  }

  const renamed = new Map([...input.renames].filter(([from]) => known.has(from)))
  return { seats, renamed, settings, pricing, conflicts, notes }
}
