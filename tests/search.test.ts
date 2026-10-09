import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { returnAssignment } from '#lib/server/domain/assignments.ts';
import { listAvailableItems, listItems } from '#lib/server/domain/items.ts';
import { listMasters } from '#lib/server/domain/masters.ts';
import { parseItemQuery } from '#lib/server/http/queries.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER } from './support/harness.ts';
import { addItem, issueTo, returnInput } from './support/helpers.ts';

// What the search box matches (DESIGN.md §9-A): the admin ledger also searches
// notes and the current holder's name; the members' "available items" list
// searches asset tag, name and type only (notes are admin-only).

afterEach(cleanupDbs);

async function ledger(db: Client, q: string): Promise<string[]> {
	const res = await listItems(db, ADMIN, parseItemQuery(new URLSearchParams({ q })));
	return res.rows.map((r) => r.assetTag);
}

async function available(db: Client, q: string): Promise<string[]> {
	const res = await listAvailableItems(db, { q, typeId: null, page: 1, size: 50 });
	return res.rows.map((r) => r.assetTag);
}

describe('ledger search', () => {
	it('matches the note and the current holder name', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-S1', { note: 'battery swapped in spring' });
		await issueTo(db, 'PC-S2', MEMBER.id);
		await addItem(db, 'PC-S3', { serialNo: 'SN-ZETA' });
		expect(await ledger(db, 'battery')).toEqual(['PC-S1']);
		expect(await ledger(db, 'Member Us')).toEqual(['PC-S2']);
		expect(await ledger(db, 'zeta')).toEqual(['PC-S3']);
	});

	it('forgets the holder once the item is returned', async () => {
		const db = await freshDb();
		const a = await issueTo(db, 'PC-S4', MEMBER.id);
		await returnAssignment(db, ADMIN, a.id, returnInput());
		expect(await ledger(db, 'Member User')).toEqual([]);
	});

	it('treats LIKE wildcards literally', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-S5', { note: '100% charged' });
		await addItem(db, 'PC-S6', { note: '100 charged' });
		expect(await ledger(db, '100%')).toEqual(['PC-S5']);
	});
});

describe('available-items search (members)', () => {
	it('matches asset tag, name and type, but not the note', async () => {
		const db = await freshDb();
		const { types } = await listMasters(db);
		const type = types[0];
		await addItem(db, 'PC-A1', { typeId: type.id, note: 'secret-note' });
		await addItem(db, 'PC-A2', { name: 'Dock' });
		expect(await available(db, type.name)).toEqual(['PC-A1']);
		expect(await available(db, 'dock')).toEqual(['PC-A2']);
		expect(await available(db, 'secret-note')).toEqual([]);
	});
});
