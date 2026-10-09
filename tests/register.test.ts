import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { listItemEvents } from '#lib/server/domain/events.ts';
import { createItem, findItem, listItems } from '#lib/server/domain/items.ts';
import { parseItemQuery } from '#lib/server/http/queries.ts';
import * as itemsRoute from '../src/routes/api/items/+server.ts';
import * as masterKindRoute from '../src/routes/api/masters/[kind]/+server.ts';
import { ADMIN, cleanupDbs, expectError, freshDb, invalid, MEMBER } from './support/harness.ts';
import { addItem, FUTURE, itemFields, PAST, placeId, typeId } from './support/helpers.ts';
import { as, call } from './support/http.ts';

// Registering an item (optionally issuing it in the same transaction) and the
// field-level validation errors forms rely on (DESIGN.md §8.6, §9-E).

afterEach(cleanupDbs);

async function itemCount(db: Client): Promise<number> {
	const res = await db.execute('SELECT COUNT(*) AS n FROM items');
	return Number(res.rows[0].n);
}

async function eventCount(db: Client): Promise<number> {
	const res = await db.execute('SELECT COUNT(*) AS n FROM events');
	return Number(res.rows[0].n);
}

describe('register and issue in one step', () => {
	it('registers the item, issues it, and records both events', async () => {
		const db = await freshDb();
		const place = await placeId(db);
		const created = await createItem(db, ADMIN, itemFields('PC-R1'), {
			userId: MEMBER.id,
			placeId: place,
			issuedOn: PAST,
			dueOn: null,
			note: null,
		});
		expect(created.holder?.userId).toBe(MEMBER.id);
		expect(created.status).toBe('assigned');
		expect(created.issuedOn).toBe(PAST);
		const events = await listItemEvents(db, ADMIN, created.id);
		expect(events.map((e) => e.kind).sort()).toEqual(['create', 'issue']);
		expect(events.find((e) => e.kind === 'issue')?.subjectId).toBe(MEMBER.id);
	});

	it('leaves no item behind when the issue fails inside the transaction', async () => {
		const db = await freshDb();
		const place = await placeId(db);
		// Make the assignment insert fail after the item insert has run.
		await db.execute(
			"CREATE TRIGGER fail_issue BEFORE INSERT ON assignments BEGIN SELECT RAISE(ABORT, 'boom'); END",
		);
		const before = await eventCount(db);
		await expect(
			createItem(db, ADMIN, itemFields('PC-R2'), {
				userId: MEMBER.id,
				placeId: place,
				issuedOn: PAST,
				dueOn: null,
				note: null,
			}),
		).rejects.toThrow('boom');
		expect(await itemCount(db)).toBe(0);
		expect(await eventCount(db)).toBe(before);
	});

	it('reports item and assignment problems together and writes nothing', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-R3');
		const before = await eventCount(db);
		await expectError(
			createItem(db, ADMIN, itemFields('PC-R3'), {
				userId: 'u-stranger',
				placeId: await placeId(db),
				issuedOn: FUTURE,
				dueOn: null,
				note: null,
			}),
			invalid({
				assetTag: 'taken',
				'assignment.userId': 'not_found',
				'assignment.issuedOn': 'future',
			}),
		);
		expect(await itemCount(db)).toBe(1);
		expect(await eventCount(db)).toBe(before);
	});

	it('accepts the assignment block over HTTP', async () => {
		const db = await freshDb();
		const res = await call(itemsRoute.POST, 'POST', '/api/items', {
			headers: as(ADMIN),
			json: {
				assetTag: 'PC-R4',
				name: 'Laptop',
				typeId: await typeId(db),
				assignment: { userId: MEMBER.id, placeId: await placeId(db), issuedOn: PAST },
			},
		});
		expect(res.status).toBe(201);
		const id = (res.body as { id: number }).id;
		expect((await findItem(db, id))?.holder?.userId).toBe(MEMBER.id);
		const held = await listItems(db, ADMIN, parseItemQuery(new URLSearchParams('held=1')));
		expect(held.rows.map((r) => r.assetTag)).toEqual(['PC-R4']);
	});
});

describe('validation_failed carries the field reasons', () => {
	it('marks a duplicate asset tag on the assetTag field', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-DUP');
		const res = await call(itemsRoute.POST, 'POST', '/api/items', {
			headers: as(ADMIN),
			json: { assetTag: 'PC-DUP', name: 'Laptop' },
		});
		expect(res.status).toBe(422);
		expect(res.body).toEqual({ error: 'validation_failed', fields: { assetTag: 'taken' } });
	});

	it('reports every bad field of one request at once', async () => {
		await freshDb();
		const res = await call(itemsRoute.POST, 'POST', '/api/items', {
			headers: as(ADMIN),
			json: {
				assetTag: 'PC-X',
				name: ' ',
				purchasedOn: '2025/01/01',
				assignment: { placeId: 'x', issuedOn: '' },
			},
		});
		expect(res.status).toBe(422);
		expect(res.body).toEqual({
			error: 'validation_failed',
			fields: {
				name: 'required',
				purchasedOn: 'invalid_date',
				'assignment.userId': 'required',
				'assignment.placeId': 'invalid',
				'assignment.issuedOn': 'required',
			},
		});
	});

	it('marks a duplicate master name on the name field', async () => {
		await freshDb();
		const first = await call(masterKindRoute.POST, 'POST', '/api/masters/types', {
			headers: as(ADMIN),
			json: { name: 'Tablet' },
			params: { kind: 'types' },
		});
		expect(first.status).toBe(201);
		const again = await call(masterKindRoute.POST, 'POST', '/api/masters/types', {
			headers: as(ADMIN),
			json: { name: 'Tablet' },
			params: { kind: 'types' },
		});
		expect(again.status).toBe(422);
		expect(again.body).toEqual({ error: 'validation_failed', fields: { name: 'taken' } });
	});

	it('keeps non-field errors as a bare code', async () => {
		const db = await freshDb();
		const res = await call(itemsRoute.POST, 'POST', '/api/items', {
			headers: as(ADMIN),
			json: ['not', 'an', 'object'],
		});
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'invalid_request' });
		expect(await itemCount(db)).toBe(0);
	});
});
