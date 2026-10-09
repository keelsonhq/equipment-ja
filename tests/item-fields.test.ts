import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { listItemEvents } from '#lib/server/domain/events.ts';
import { findItemByTag, type ItemFields } from '#lib/server/domain/items.ts';
import { listMasters } from '#lib/server/domain/masters.ts';
import { runImport } from '#lib/server/import/importer.ts';
import { argName } from '#lib/server/mcp/refs.ts';
import * as itemsRoute from '../src/routes/api/items/+server.ts';
import * as itemRoute from '../src/routes/api/items/[id]/+server.ts';
import * as exportRoute from '../src/routes/api/items/export/+server.ts';
import { ADMIN, cleanupDbs, freshDb } from './support/harness.ts';
import { type CompleteItemFields, completeItemFields, typeId } from './support/helpers.ts';
import { as, call, callTool } from './support/http.ts';

// Every item field, set to a value, survives every way in and out: the API
// (register, edit, read), the CSV (export, then import into another
// database), the AI assistant (register_item, get_item) and the edit's
// history. The fields compared are the keys of completeItemFields, whose type
// lists every key of ItemFields: a new field is checked here without new tests.

afterEach(cleanupDbs);

type FieldKey = keyof ItemFields;

function keysOf(fields: CompleteItemFields): FieldKey[] {
	return Object.keys(fields) as FieldKey[];
}

/** The item fields of a record (anything keyed by the field names). */
function pickFields(record: unknown, keys: FieldKey[]): Record<string, unknown> {
	const r = record as Record<string, unknown>;
	return Object.fromEntries(keys.map((k) => [k, r[k]]));
}

async function typeName(db: Client, id: number): Promise<string> {
	const type = (await listMasters(db)).types.find((t) => t.id === id);
	if (!type) {
		throw new Error(`type ${id} not found`);
	}
	return type.name;
}

async function typeIdByName(db: Client, name: string): Promise<number> {
	const type = (await listMasters(db)).types.find((t) => t.name === name);
	if (!type) {
		throw new Error(`type ${name} not found`);
	}
	return type.id;
}

async function itemByTag(db: Client, tag: string) {
	const item = await findItemByTag(db, tag);
	if (!item) {
		throw new Error(`item ${tag} not found`);
	}
	return item;
}

/** Register through POST /api/items; the new item's id. */
async function register(fields: CompleteItemFields): Promise<number> {
	const res = await call(itemsRoute.POST, 'POST', '/api/items', {
		headers: as(ADMIN),
		json: fields,
	});
	expect(res.status, JSON.stringify(res.body)).toBe(201);
	return (res.body as { id: number }).id;
}

/** GET /api/items/[id]. */
async function read(id: number): Promise<Record<string, unknown>> {
	const res = await call(itemRoute.GET, 'GET', `/api/items/${id}`, {
		headers: as(ADMIN),
		params: { id: String(id) },
	});
	expect(res.status, JSON.stringify(res.body)).toBe(200);
	return res.body as Record<string, unknown>;
}

describe('every item field round-trips', () => {
	it('through the API: register, then edit every field', async () => {
		const db = await freshDb();
		const first = completeItemFields('PC-F1', await typeId(db, 1));
		const id = await register(first);
		const created = await read(id);
		expect(pickFields(created, keysOf(first))).toEqual(first);

		const second = completeItemFields('PC-F2', await typeId(db, 2), true);
		for (const key of keysOf(first)) {
			expect(second[key], `the edit changes ${key}`).not.toEqual(first[key]);
		}
		const edited = await call(itemRoute.PATCH, 'PATCH', `/api/items/${id}`, {
			headers: as(ADMIN),
			json: { ...second, version: created.version },
			params: { id: String(id) },
		});
		expect(edited.status, JSON.stringify(edited.body)).toBe(200);
		expect(pickFields(await read(id), keysOf(second))).toEqual(second);

		// The edit's history holds [before, after] of every field; the type by
		// name, under `type`.
		const [event] = (await listItemEvents(db, ADMIN, id)).filter((e) => e.kind === 'edit');
		const { type, ...rest } = (event.detail as { changes: Record<string, unknown> }).changes;
		expect(type).toEqual([await typeName(db, first.typeId), await typeName(db, second.typeId)]);
		expect(rest).toEqual(
			Object.fromEntries(
				keysOf(first)
					.filter((k) => k !== 'typeId')
					.map((k) => [k, [first[k], second[k]]]),
			),
		);
	});

	it('through the CSV: export, then import into another database', async () => {
		const db = await freshDb();
		const fields = completeItemFields('PC-F3', await typeId(db, 2));
		await register(fields);
		const exported = await call(exportRoute.GET, 'GET', '/api/items/export', {
			headers: as(ADMIN),
		});
		expect(exported.status).toBe(200);
		const bytes = new Uint8Array(await exported.res.arrayBuffer());
		const name = await typeName(db, fields.typeId);

		// The target starts with the same default types; the import matches them by name.
		const target = await freshDb();
		const options = { autoAddMasters: false, unassignUnknown: false };
		const result = await runImport(target, ADMIN, bytes, 'export.csv', options, 'all');
		expect(result.created).toBe(1);
		const imported = await itemByTag(target, fields.assetTag);
		expect(pickFields(imported, keysOf(fields))).toEqual({
			...fields,
			typeId: await typeIdByName(target, name),
		});
	});

	it('through the AI assistant: register_item, then get_item', async () => {
		const db = await freshDb();
		const fields = completeItemFields('PC-F4', await typeId(db, 3));
		const name = await typeName(db, fields.typeId);
		// Arguments are the field names in snake_case (argName); the type goes by name.
		const args = Object.fromEntries(
			keysOf(fields).map((k) => [argName(k), k === 'typeId' ? name : fields[k]]),
		);
		const registered = await callTool('register_item', args, ADMIN);
		expect(registered.status, JSON.stringify(registered.body)).toBe(200);

		const got = await callTool('get_item', { asset_tag: fields.assetTag }, ADMIN);
		expect(got.status, JSON.stringify(got.body)).toBe(200);
		const result = got.body as Record<string, unknown>;
		const back = Object.fromEntries(keysOf(fields).map((k) => [k, result[argName(k)]]));
		expect({ ...back, typeId: await typeIdByName(db, String(back.typeId)) }).toEqual(fields);
	});
});
