/**
 * Which imported seats Meridian already holds, and what each is called.
 *
 * Two levels of match, because only one of them is proof:
 *
 *   same seat   `accountUserId` is equal. It IS the account Meridian holds:
 *               the store keys on it, so the import refreshes that one record
 *               with whichever token is fresher and the profile keeps its
 *               name. A second record would hold a second copy of one
 *               single-use refresh token, and whichever copy renewed first
 *               would kill the other - so two profiles for one seat are never
 *               created, whatever the option.
 *   possible    a different `accountUserId` with the same email AND the same
 *               workspace (`accountId`). One person cannot hold two seats in
 *               one workspace, so this is the same subscription seen under a
 *               new user id (an account deleted and recreated, a second login
 *               method). Each has its own refresh token, so importing both
 *               breaks nothing; it is imported under a name that says so,
 *               unless the operator asks to skip it.
 *
 * Email alone is not identity: one person holds seats in several workspaces,
 * and those are separate subscriptions. Workspace alone is not either: a
 * Business workspace holds many people.
 */

import { chatGptProfileIds } from "../profiles"

export interface SeatIdentity {
  accountUserId: string
  accountId: string | null
  email: string | null
}

export type DuplicateMatch =
  | { kind: "same-seat"; profileId: string }
  | { kind: "possible"; profileId: string; seat: string }

const PROFILE_ID_LIMIT = 64
const POSSIBLE_DUPLICATE_SUFFIXES = ["-possibly-duplicate-of-", "-possible-dup-of-", "-dup-of-"] as const

function sameEmail(a: string | null, b: string | null | undefined): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function findDuplicate(
  incoming: SeatIdentity,
  held: readonly SeatIdentity[],
  heldProfileIds: ReadonlyMap<string, string>,
): DuplicateMatch | null {
  const profileOf = (seat: string) => heldProfileIds.get(seat) ?? seat
  if (held.some(account => account.accountUserId === incoming.accountUserId)) {
    return { kind: "same-seat", profileId: profileOf(incoming.accountUserId) }
  }
  const possible = held.find(account =>
    account.accountId !== null && account.accountId === incoming.accountId && sameEmail(incoming.email, account.email))
  return possible ? { kind: "possible", profileId: profileOf(possible.accountUserId), seat: possible.accountUserId } : null
}

/**
 * `<name> (possibly duplicate of <existing>)` as a profile id. Profile ids are
 * used in URLs, headers and routing settings, so the sentence is spelled with
 * hyphens and shortened to fit 64 characters; the dry run prints the sentence.
 */
export function possibleDuplicateName(name: string, existing: string): string {
  for (const suffix of POSSIBLE_DUPLICATE_SUFFIXES) {
    const candidate = `${name}${suffix}${existing}`
    if (candidate.length <= PROFILE_ID_LIMIT) return candidate
  }
  // Both names stay recognisable: each gets half of what the suffix leaves.
  const suffix = POSSIBLE_DUPLICATE_SUFFIXES[2]
  const half = Math.floor((PROFILE_ID_LIMIT - suffix.length) / 2)
  const trim = (value: string, length: number) => value.slice(0, length).replace(/[-._]+$/, "")
  return `${trim(name, half)}${suffix}${trim(existing, PROFILE_ID_LIMIT - suffix.length - half)}`
}

export function possibleDuplicateSentence(name: string, existing: string): string {
  return `${name} (possibly duplicate of ${existing})`
}

function numbered(id: string, n: number): string {
  const tail = `-${n}`
  return `${id.slice(0, PROFILE_ID_LIMIT - tail.length).replace(/[-._]+$/, "")}${tail}`
}

export interface ImportNaming {
  /** Seat -> the profile id it carries today (held) or would get on import (incoming). */
  ids: Map<string, string>
  /** Seats whose duplicate status decides their name: seat -> the id to write to `chatGptProfileNames`. */
  names: Map<string, string>
  /** Incoming seat -> the name the importer would give it before any duplicate flag. */
  derived: Map<string, string>
  matches: Map<string, DuplicateMatch>
}

/**
 * Names every incoming seat the way the profile surface will once it is in
 * the store, and flags the duplicates. `heldIds` are computed over the held
 * seats alone, because that is the name the operator sees now.
 */
export function planImportNaming(input: {
  held: readonly SeatIdentity[]
  incoming: readonly SeatIdentity[]
  names?: Readonly<Record<string, unknown>>
  reserved?: ReadonlySet<string>
}): ImportNaming {
  const view = (seat: SeatIdentity) => ({ id: seat.accountUserId, email: seat.email })
  const heldIds = chatGptProfileIds(input.held.map(view), { names: input.names, reserved: input.reserved })
  const heldSeats = new Set(input.held.map(seat => seat.accountUserId))
  const combined = [...input.held, ...input.incoming.filter(seat => !heldSeats.has(seat.accountUserId))]
  const importIds = chatGptProfileIds(combined.map(view), { names: input.names, reserved: input.reserved })

  const ids = new Map<string, string>(heldIds)
  const names = new Map<string, string>()
  const derivedNames = new Map<string, string>()
  const matches = new Map<string, DuplicateMatch>()
  const taken = new Set([...importIds.values(), ...(input.reserved ?? [])])
  for (const seat of input.incoming) {
    const match = findDuplicate(seat, input.held, heldIds)
    if (match) matches.set(seat.accountUserId, match)
    if (match?.kind === "same-seat") continue
    const derived = importIds.get(seat.accountUserId)!
    ids.set(seat.accountUserId, derived)
    derivedNames.set(seat.accountUserId, derived)
    if (match?.kind !== "possible" || typeof input.names?.[seat.accountUserId] === "string") continue
    let flagged = possibleDuplicateName(derived, match.profileId)
    const base = flagged
    for (let n = 2; taken.has(flagged); n++) flagged = numbered(base, n)
    taken.add(flagged)
    names.set(seat.accountUserId, flagged)
    ids.set(seat.accountUserId, flagged)
  }
  return { ids, names, derived: derivedNames, matches }
}
