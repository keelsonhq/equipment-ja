import type { Client } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import {
	issuablePeople,
	type PeopleState,
	type PersonSummary,
} from '#lib/server/domain/directory.ts';
import { allPeople } from '#lib/server/domain/people.ts';
import { AppError, ErrorCode, ValidationError } from '#lib/server/errors.ts';
import { normalizeName } from './args.ts';

// The person an AI assistant names ("Yamada", "taro@example.com") resolved to
// exactly one person. The model only has what the user said, so a reference
// is matched in a fixed order, and an unclear one is answered with the
// candidates instead of a guess.

/** An ambiguous reference returns at most this many candidates. */
export const MAX_CANDIDATES = 10;

/**
 * Who a reference may name. `members`: the people one may issue to (workspace
 * directory members). `records`: also
 * people who appear only in the records (former members) — for lookups.
 */
export type PersonScope = 'members' | 'records';

// Everyone the scope covers, in name order (admin: both lists check).
function peopleIn(
	db: Client,
	actor: Actor,
	scope: PersonScope,
): Promise<{ state: PeopleState; people: PersonSummary[] }> {
	return scope === 'members' ? issuablePeople(actor) : allPeople(db, actor);
}

function match(p: PersonSummary): PersonSummary {
	return { id: p.id, name: p.name, email: p.email };
}

/**
 * Resolve `ref` (admin). Order: a candidate id (exact) -> email (exact,
 * case-insensitive) -> name (exact, then partial; width, case and spaces
 * ignored). The first step with any hit decides: one hit is the person,
 * several are `ambiguous` with `candidates`. No hit is `not_found` — or
 * `people_unconfigured` / `people_unavailable` when there is no member list
 * to look in, as when issuing from the screen.
 */
export async function resolvePersonRef(
	db: Client,
	actor: Actor,
	ref: string,
	opts: { field: string; scope: PersonScope },
): Promise<PersonSummary> {
	const { state, people } = await peopleIn(db, actor, opts.scope);
	const term = ref.trim();
	const byId = people.find((p) => p.id === term);
	if (byId) {
		return match(byId);
	}
	const email = term.toLowerCase();
	const key = normalizeName(term);
	const steps: (() => PersonSummary[])[] = [
		() => people.filter((p) => p.email !== null && p.email.trim().toLowerCase() === email),
		() => people.filter((p) => normalizeName(p.name) === key),
		() => people.filter((p) => normalizeName(p.name).includes(key)),
	];
	for (const step of steps) {
		const hits = step();
		if (hits.length === 1) {
			return match(hits[0]);
		}
		if (hits.length > 1) {
			throw new ValidationError(
				{ [opts.field]: 'ambiguous' },
				{ candidates: hits.slice(0, MAX_CANDIDATES).map(match) },
			);
		}
	}
	if (state === 'unconfigured') {
		throw new AppError(ErrorCode.PeopleUnconfigured);
	}
	if (state === 'unavailable') {
		throw new AppError(ErrorCode.PeopleUnavailable);
	}
	throw new ValidationError({ [opts.field]: 'not_found' });
}
