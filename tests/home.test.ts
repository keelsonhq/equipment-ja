import { afterEach, describe, expect, it } from 'vite-plus/test';
import { issueItem, returnAssignment } from '#lib/server/domain/assignments.ts';
import { getHome } from '#lib/server/domain/home.ts';
import { suspendItem } from '#lib/server/domain/items.ts';
import { ADMIN, cleanupDbs, expectError, freshDb, MEMBER, OTHER } from './support/harness.ts';
import { addItem, issueInput, PAST_DUE, placeId, returnInput, typeId } from './support/helpers.ts';

afterEach(cleanupDbs);

describe('GET /api/home data', () => {
	it('counts stock per type as a partition of the display status', async () => {
		const db = await freshDb();
		const laptop = await typeId(db, 1);
		const place = await placeId(db);
		const free = await addItem(db, 'PC-1', { typeId: laptop });
		const held = await addItem(db, 'PC-2', { typeId: laptop });
		const old = await addItem(db, 'PC-3', { typeId: laptop });
		const broken = await addItem(db, 'PC-4', { typeId: laptop });
		await addItem(db, 'X-1'); // no type
		const a = await issueItem(db, ADMIN, issueInput(old, MEMBER.id, place));
		await issueItem(db, ADMIN, issueInput(held, MEMBER.id, place, { exchangeFrom: a.id }));
		await suspendItem(db, ADMIN, broken, 'repair', null);
		void free;

		const home = await getHome(db, ADMIN);
		const laptops = home.stock.find((s) => s.typeId === laptop);
		expect(laptops).toMatchObject({
			unassigned: 1,
			assigned: 1,
			pendingReturn: 1,
			suspended: 1,
			total: 4,
		});
		const untyped = home.stock.find((s) => s.typeId === null);
		expect(untyped).toMatchObject({ name: null, unassigned: 1, total: 1 });
		// Active types without items are listed too (with zeros).
		expect(home.stock.filter((s) => s.typeId !== null).length).toBeGreaterThan(1);
	});

	it('lists overdue, pending-return and suspended items, overdue first', async () => {
		const db = await freshDb();
		const place = await placeId(db);
		const late = await addItem(db, 'A-1');
		const old = await addItem(db, 'A-2');
		const fresh = await addItem(db, 'A-3');
		const broken = await addItem(db, 'A-4');
		await addItem(db, 'A-5'); // unassigned, not listed
		await issueItem(db, ADMIN, issueInput(late, MEMBER.id, place, { dueOn: PAST_DUE }));
		const a = await issueItem(db, ADMIN, issueInput(old, OTHER.id, place));
		await issueItem(db, ADMIN, issueInput(fresh, OTHER.id, place, { exchangeFrom: a.id }));
		await suspendItem(db, ADMIN, broken, 'broken', 'screen');

		const home = await getHome(db, ADMIN);
		expect(home.attention.total).toBe(3);
		expect(home.attention.rows.map((r) => [r.assetTag, r.status])).toEqual([
			['A-1', 'overdue'],
			['A-2', 'pending_return'],
			['A-4', 'suspended'],
		]);
	});

	it('caps the attention list at 10 rows and returns the latest 10 events', async () => {
		const db = await freshDb();
		for (let i = 0; i < 12; i++) {
			const id = await addItem(db, `S-${i}`);
			await suspendItem(db, ADMIN, id, 'repair', null);
		}
		const home = await getHome(db, ADMIN);
		expect(home.attention.rows).toHaveLength(10);
		expect(home.attention.total).toBe(12);
		expect(home.recent).toHaveLength(10);
		expect(home.recent[0].kind).toBe('suspend');
	});

	it('reflects returns', async () => {
		const db = await freshDb();
		const place = await placeId(db);
		const id = await addItem(db, 'R-1', { typeId: await typeId(db, 2) });
		const a = await issueItem(db, ADMIN, issueInput(id, MEMBER.id, place, { dueOn: PAST_DUE }));
		await returnAssignment(db, MEMBER, a.id, returnInput());
		const home = await getHome(db, ADMIN);
		expect(home.attention.total).toBe(0);
		expect(home.stock.find((s) => s.typeId === null)).toBeUndefined();
	});

	it('is admin-only', async () => {
		const db = await freshDb();
		await expectError(getHome(db, MEMBER), { status: 403, code: 'forbidden_manage_required' });
	});
});
