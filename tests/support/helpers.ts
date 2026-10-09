import type { Client } from '@libsql/client';
import {
	type AssignmentView,
	type IssueInput,
	issueItem,
	type ReturnInput,
} from '#lib/server/domain/assignments.ts';
import { createItem, type ItemFields } from '#lib/server/domain/items.ts';
import { ADMIN } from './harness.ts';

// This app's records for tests (items, types, places, issues, returns, dates),
// made in the database of harness.ts `freshDb`.

// Dates of the records the tests write. Fixed values keep failures readable;
// all but FUTURE are safely before "today" in any time zone, in this order:
// BEFORE_PAST < PAST < PAST_DUE < LATER < FUTURE.

/** A date before PAST: a due or return date before the issue date (`before_issued`), or an earlier issue date. */
export const BEFORE_PAST = '2024-12-31';
/** A past date (YYYY-MM-DD): the issue date of issueInput / issueTo. */
export const PAST = '2025-01-15';
/** A due date after PAST that has already passed: the item is overdue. */
export const PAST_DUE = '2025-01-20';
/** A past date after PAST: the return date of returnInput, or a later issue. */
export const LATER = '2025-02-01';
/** A date no time zone has reached: an issue date that is `future`, or a due date still ahead. */
export const FUTURE = '2999-01-01';

/** Id of a default usage place by its position (1 = first). */
export async function placeId(db: Client, position = 1): Promise<number> {
	const res = await db.execute({
		sql: 'SELECT id FROM places ORDER BY sort_order LIMIT 1 OFFSET ?',
		args: [position - 1],
	});
	return Number(res.rows[0]?.id);
}

/** Id of a default item type by its position (1 = first). */
export async function typeId(db: Client, position = 1): Promise<number> {
	const res = await db.execute({
		sql: 'SELECT id FROM item_types ORDER BY sort_order LIMIT 1 OFFSET ?',
		args: [position - 1],
	});
	return Number(res.rows[0]?.id);
}

export function itemFields(tag: string, overrides: Partial<ItemFields> = {}): ItemFields {
	return {
		assetTag: tag,
		name: `Laptop ${tag}`,
		typeId: null,
		serialNo: `SN-${tag}`,
		purchasedOn: '2025-04-01',
		storageLocation: 'Store room',
		note: null,
		...overrides,
	};
}

/** Item fields with every field set: none optional, none null. */
export type CompleteItemFields = { [K in keyof ItemFields]-?: NonNullable<ItemFields[K]> };

/**
 * A value in every item field (tests/item-fields.test.ts checks that each one
 * survives every way in and out). A new field in ItemFields fails the type
 * check here until it has a value. `second`: a different value in every field
 * (with another tag and type, an edit that changes them all).
 */
export function completeItemFields(
	tag: string,
	typeId: number,
	second = false,
): CompleteItemFields {
	return {
		assetTag: tag,
		name: second ? `Desktop ${tag}` : `Laptop ${tag}`,
		typeId,
		serialNo: second ? `SN2-${tag}` : `SN-${tag}`,
		purchasedOn: second ? LATER : PAST,
		storageLocation: second ? 'Cabinet B' : 'Store room',
		note: second ? 'Spare charger' : 'Keyboard replaced',
	};
}

/** Register an item as the admin and return its id. */
export async function addItem(db: Client, tag: string, overrides: Partial<ItemFields> = {}) {
	return (await createItem(db, ADMIN, itemFields(tag, overrides))).id;
}

/**
 * Input of `issueItem`: the item to `userId` (null: the caller themselves) at
 * the usage place `placeId`, issued on PAST, no due date, no note, no exchange.
 */
export function issueInput(
	itemId: number,
	userId: string | null,
	placeId: number,
	overrides: Partial<IssueInput> = {},
): IssueInput {
	return {
		itemId,
		userId,
		placeId,
		issuedOn: PAST,
		dueOn: null,
		note: null,
		exchangeFrom: null,
		...overrides,
	};
}

/** Input of `returnAssignment`: returned on LATER, nothing else (the holder's own return). */
export function returnInput(overrides: Partial<ReturnInput> = {}): ReturnInput {
	return { returnedOn: LATER, note: null, storageLocation: null, suspend: null, ...overrides };
}

/**
 * Register the item `tag` and issue it to `userId` as the admin, at the first
 * usage place on PAST (issueInput, with `overrides`). Returns the assignment
 * (its `itemId` is the new item's id).
 */
export async function issueTo(
	db: Client,
	tag: string,
	userId: string,
	overrides: Partial<IssueInput> = {},
): Promise<AssignmentView> {
	const itemId = await addItem(db, tag);
	return issueItem(db, ADMIN, issueInput(itemId, userId, await placeId(db), overrides));
}
