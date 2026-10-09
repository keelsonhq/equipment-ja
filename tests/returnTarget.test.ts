import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	returnTargetOfHolding,
	returnTargetOfItem,
} from '#lib/components/assignments/returnTarget.ts';
import { issueItem } from '#lib/server/domain/assignments.ts';
import { getItem } from '#lib/server/domain/items.ts';
import { getMember } from '#lib/server/domain/people.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER } from './support/harness.ts';
import { addItem, issueInput, PAST, placeId } from './support/helpers.ts';

// The return dialog's target, from the rows the API gives the screens: an item
// (ledger, home, item page, the dialog's own picker) or a holding (a person's
// page). Both describe the same open assignment; only the item knows where the
// item is stored.

afterEach(cleanupDbs);

async function heldItem() {
	const db = await freshDb();
	const id = await addItem(db, 'PC-1', { name: 'Laptop', storageLocation: 'Store room' });
	const before = await getItem(db, ADMIN, id);
	const a = await issueItem(db, ADMIN, issueInput(id, MEMBER.id, await placeId(db)));
	return { db, id, before, assignmentId: a.id };
}

describe('returnTargetOfItem', () => {
	it('describes the open assignment of a held item, with its storage place', async () => {
		const { db, id, assignmentId } = await heldItem();
		expect(returnTargetOfItem(await getItem(db, ADMIN, id))).toEqual({
			assignmentId,
			assetTag: 'PC-1',
			itemName: 'Laptop',
			issuedOn: PAST,
			userName: MEMBER.name,
			storageLocation: 'Store room',
		});
	});

	it('is null when nobody holds the item, or when the row lacks any part of the assignment', async () => {
		const { db, id, before } = await heldItem();
		expect(before.assignmentId).toBeNull();
		expect(returnTargetOfItem(before)).toBeNull();
		// One rule for every screen: no blank to fill in, never a half target.
		const item = await getItem(db, ADMIN, id);
		expect(returnTargetOfItem({ ...item, holder: null })).toBeNull();
		expect(returnTargetOfItem({ ...item, issuedOn: null })).toBeNull();
		expect(returnTargetOfItem({ ...item, assignmentId: null })).toBeNull();
	});
});

describe('returnTargetOfHolding', () => {
	it('describes the same assignment as the item, without a storage place', async () => {
		const { db, id } = await heldItem();
		const page = await getMember(db, ADMIN, MEMBER.id);
		const holding = page.holdings.find((h) => h.itemId === id);
		if (!holding) throw new Error('no holding');
		expect(returnTargetOfHolding(holding, page.person.name)).toEqual({
			...returnTargetOfItem(await getItem(db, ADMIN, id)),
			storageLocation: null,
		});
	});
});
