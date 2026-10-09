import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { listItemEvents } from '#lib/server/domain/events.ts';
import { findItem, type ItemFields, type ItemView, updateItem } from '#lib/server/domain/items.ts';
import * as itemRoute from '../src/routes/api/items/[id]/+server.ts';
import { ADMIN, cleanupDbs, expectError, freshDb, invalid, MEMBER } from './support/harness.ts';
import { addItem, itemFields, typeId } from './support/helpers.ts';
import { as, call } from './support/http.ts';

// Editing an item (PATCH /api/items/[id], DESIGN.md §9-E): the change is written
// with an optimistic version check and logged as an `edit` event holding the
// before / after of each changed field.

afterEach(cleanupDbs);

/** PATCH body: every item field (the edit form sends them all) + version. */
function editBody(item: ItemView, changes: Record<string, unknown> = {}) {
	const body: ItemFields & { version: number } = {
		assetTag: item.assetTag,
		name: item.name,
		typeId: item.typeId,
		serialNo: item.serialNo,
		purchasedOn: item.purchasedOn,
		storageLocation: item.storageLocation,
		note: item.note,
		version: item.version,
	};
	return { ...body, ...changes };
}

function patch(id: number, json: unknown, actor = ADMIN) {
	return call(itemRoute.PATCH, 'PATCH', `/api/items/${id}`, {
		headers: as(actor),
		json,
		params: { id: String(id) },
	});
}

async function load(db: Client, id: number): Promise<ItemView> {
	const item = await findItem(db, id);
	if (!item) {
		throw new Error(`item ${id} not found`);
	}
	return item;
}

async function editEvents(db: Client, id: number) {
	return (await listItemEvents(db, ADMIN, id)).filter((e) => e.kind === 'edit');
}

describe('edit an item', () => {
	it('saves the changed fields, bumps the version and logs before / after', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-E1');
		const before = await load(db, id);
		const type = await typeId(db, 2);

		const res = await patch(
			id,
			editBody(before, { name: 'Laptop 14"', typeId: type, note: 'new battery' }),
		);
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			id,
			name: 'Laptop 14"',
			typeId: type,
			note: 'new battery',
			version: before.version + 1,
		});

		const events = await editEvents(db, id);
		expect(events).toHaveLength(1);
		expect(events[0].actorId).toBe(ADMIN.id);
		// Only the changed fields, as [before, after].
		expect(events[0].detail).toEqual({
			changes: {
				name: [before.name, 'Laptop 14"'],
				type: [null, (res.body as ItemView).typeName],
				note: [null, 'new battery'],
			},
		});
	});

	it('logs a type change by the names the types had at the time', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-E4', { typeId: await typeId(db, 1) });
		const before = await load(db, id);
		const res = await patch(id, editBody(before, { typeId: await typeId(db, 2) }));
		expect(res.status).toBe(200);
		const after = res.body as ItemView;
		// Renaming the type later leaves the history as it was.
		await db.execute({
			sql: "UPDATE item_types SET name = 'Renamed' WHERE id = ?",
			args: [after.typeId],
		});
		const [event] = await editEvents(db, id);
		expect(event.detail).toEqual({ changes: { type: [before.typeName, after.typeName] } });
		expect(after.typeName).not.toBe('Renamed');
	});

	it('writes nothing when no field changed', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-E2');
		const before = await load(db, id);
		const res = await patch(id, editBody(before));
		expect(res.status).toBe(200);
		expect((res.body as ItemView).version).toBe(before.version);
		expect(await editEvents(db, id)).toEqual([]);
	});

	it('answers 409 item_version_conflict to an edit based on an old version', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-E3');
		const stale = await load(db, id);
		// Someone else saved first.
		expect((await patch(id, editBody(stale, { name: 'First' }))).status).toBe(200);

		const res = await patch(id, editBody(stale, { name: 'Second' }));
		expect(res.status).toBe(409);
		expect(res.body).toEqual({ error: 'item_version_conflict' });
		expect((await load(db, id)).name).toBe('First');
		// The losing edit is not logged.
		expect((await editEvents(db, id)).map((e) => e.detail)).toEqual([
			{ changes: { name: [stale.name, 'First'] } },
		]);
	});

	it('raises the same conflict from the business layer', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-E4');
		const item = await load(db, id);
		await expectError(
			updateItem(db, ADMIN, id, item.version + 1, { ...itemFields('PC-E4'), name: 'Changed' }),
			{ status: 409, code: 'item_version_conflict' },
		);
	});

	it('answers 403 to a general user and changes nothing', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-E5');
		const before = await load(db, id);
		const res = await patch(id, editBody(before, { name: 'Mine now' }), MEMBER);
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'forbidden_manage_required' });
		expect(await load(db, id)).toEqual(before);
	});

	it('answers 404 for an unknown item', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-E6');
		const res = await patch(id + 1, editBody(await load(db, id)));
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: 'item_not_found' });
	});
});

describe('edit: validation_failed carries the field reasons', () => {
	it('reports every bad field of the body at once', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-V1');
		const before = await load(db, id);
		const res = await patch(
			id,
			editBody(before, {
				assetTag: 'X'.repeat(41),
				name: ' ',
				purchasedOn: '2025/04/01',
			}),
		);
		expect(res.status).toBe(422);
		expect(res.body).toEqual({
			error: 'validation_failed',
			fields: { assetTag: 'too_long', name: 'required', purchasedOn: 'invalid_date' },
		});
		expect(await load(db, id)).toEqual(before);
	});

	it('marks an asset tag another item already uses', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-V2');
		const id = await addItem(db, 'PC-V3');
		const res = await patch(id, editBody(await load(db, id), { assetTag: 'PC-V2' }));
		expect(res.status).toBe(422);
		expect(res.body).toEqual({ error: 'validation_failed', fields: { assetTag: 'taken' } });
		expect(await editEvents(db, id)).toEqual([]);
	});

	it('marks a type that does not exist', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-V4');
		await expectError(
			updateItem(db, ADMIN, id, 1, { ...itemFields('PC-V4'), typeId: 9999 }),
			invalid({
				typeId: 'not_found',
			}),
		);
	});

	it('answers 400 invalid_request without a version', async () => {
		const db = await freshDb();
		const id = await addItem(db, 'PC-V5');
		const res = await patch(id, editBody(await load(db, id), { version: undefined }));
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: 'invalid_request' });
	});
});
