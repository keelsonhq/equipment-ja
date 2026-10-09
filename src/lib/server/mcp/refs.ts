import type { Client } from '@libsql/client';
import { findItemByTag } from '#lib/server/domain/items.ts';
import { listMasters, type MasterEntry } from '#lib/server/domain/masters.ts';
import { type FieldErrors, ValidationError } from '#lib/server/errors.ts';
import { normalizeName } from './args.ts';

// How this app's records and names meet the tools' arguments: what the model
// names (an item type, a usage place, the item to exchange) turned into the
// records the business layer takes — an unknown name is an argument error
// with what the model needs to retry (`choices`) — and the business layer's
// field names turned back into the argument names in errors. People are in
// people.ts.

// --- Records by name (types, places, the item to exchange) ------------------

/**
 * Valid names returned in `choices` per argument. The gateway shows the model
 * only the first 4 KiB of an error body; list_masters has the full lists.
 */
export const MAX_CHOICES = 30;

/**
 * An item type or usage place by name (exact, after normalizeName). Writes
 * take active entries only; a filter may name a deactivated type. Unknown ->
 * `not_found` on `field`, with the valid names in `choices`.
 */
export function masterByName(
	entries: MasterEntry[],
	ref: string,
	field: string,
	opts: { activeOnly: boolean },
): { id: number; name: string } {
	const pool = opts.activeOnly ? entries.filter((e) => e.active) : entries;
	const key = normalizeName(ref);
	const hit = pool.find((e) => normalizeName(e.name) === key);
	if (!hit) {
		throw new ValidationError(
			{ [field]: 'not_found' },
			{ choices: { [field]: pool.slice(0, MAX_CHOICES).map((e) => e.name) } },
		);
	}
	return { id: hit.id, name: hit.name };
}

/** The find tools' `type` filter: any type, deactivated ones too; omitted -> null. */
export async function typeFilter(
	db: Client,
	ref: string | null,
): Promise<{ id: number; name: string } | null> {
	if (ref === null) {
		return null;
	}
	return masterByName((await listMasters(db)).types, ref, 'type', { activeOnly: false });
}

/** A usage place by name; omitted -> the first active place (as in the issue dialog). */
export function placeOrFirst(
	places: MasterEntry[],
	ref: string | null,
	field: string,
): { id: number; name: string } {
	if (ref !== null) {
		return masterByName(places, ref, field, { activeOnly: true });
	}
	const first = places.find((p) => p.active);
	if (!first) {
		throw new ValidationError({ [field]: 'not_found' }, { choices: { [field]: [] } });
	}
	return { id: first.id, name: first.name };
}

/** The open assignment of the item tagged `assetTag` (the item an exchange takes back). */
export async function openAssignmentByTag(
	db: Client,
	assetTag: string,
	field: string,
): Promise<string> {
	const item = await findItemByTag(db, assetTag);
	if (!item) {
		throw new ValidationError({ [field]: 'not_found' });
	}
	if (item.assignmentId === null) {
		throw new ValidationError({ [field]: 'invalid' });
	}
	return item.assignmentId;
}

// --- Field names in errors -> argument names --------------------------------

// Business-layer field names that are not just their argument name in
// camelCase: the register block, and ids the tool takes something else in
// place of (a name, an asset tag).
const ARG_NAMES: Record<string, string> = {
	assignment: 'assign_to',
	userId: 'person',
	placeId: 'place',
	typeId: 'type',
	exchangeFrom: 'exchange_for',
};

/** A business-layer field name as the tool's argument name: `assignment.issuedOn` -> `assign_to.issued_on`. */
export function argName(field: string): string {
	return field
		.split('.')
		.map((part) => ARG_NAMES[part] ?? part.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))
		.join('.');
}

/**
 * Run a business-layer call, renaming the fields of its ValidationError to the
 * tool's argument names (argName). Reasons are kept as they are.
 */
export async function withArgNames<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (err) {
		if (!(err instanceof ValidationError)) {
			throw err;
		}
		const fields: FieldErrors = {};
		for (const [key, reason] of Object.entries(err.fields)) {
			fields[argName(key)] ??= reason;
		}
		throw new ValidationError(fields, err.extra);
	}
}
