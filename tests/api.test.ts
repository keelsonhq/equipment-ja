import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as fallbackRoute from '../src/routes/api/[...rest]/+server.ts';
import * as assignmentsRoute from '../src/routes/api/assignments/+server.ts';
import * as returnRoute from '../src/routes/api/assignments/[id]/return/+server.ts';
import * as attachmentFile from '../src/routes/api/attachments/[id]/+server.ts';
import * as availableRoute from '../src/routes/api/available-items/+server.ts';
import * as eventsRoute from '../src/routes/api/events/+server.ts';
import * as homeRoute from '../src/routes/api/home/+server.ts';
import * as itemsRoute from '../src/routes/api/items/+server.ts';
import * as itemAttachmentsRoute from '../src/routes/api/items/[id]/attachments/+server.ts';
import * as exportRoute from '../src/routes/api/items/export/+server.ts';
import * as masterKindRoute from '../src/routes/api/masters/[kind]/+server.ts';
import * as meRoute from '../src/routes/api/me/+server.ts';
import * as membersRoute from '../src/routes/api/members/+server.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER, OTHER } from './support/harness.ts';
import { addItem, PAST, placeId } from './support/helpers.ts';
import { as, call, type Handler } from './support/http.ts';

// HTTP-level smoke tests: requests go through the real `handle` hook
// (authentication) and the real +server.ts handlers, exactly as in the built
// server, without opening a port.

afterEach(cleanupDbs);

describe('authentication', () => {
	it('answers 401 without trusted headers (production behaviour)', async () => {
		await freshDb();
		const { status, body } = await call(meRoute.GET, 'GET', '/api/me');
		expect(status).toBe(401);
		expect(body).toEqual({ error: 'unauthorized' });
	});

	it('reads the gateway identity and the manage grant', async () => {
		await freshDb();
		const member = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(member.status).toBe(200);
		expect(member.body).toMatchObject({ userId: MEMBER.id, isAdmin: false, localPreview: false });
		// There is no demo-mode state any more.
		expect(member.body).not.toHaveProperty('demo');
		const admin = await call(meRoute.GET, 'GET', '/api/me', { headers: as(ADMIN) });
		expect(admin.body).toMatchObject({ isAdmin: true, localPreview: false });
	});

	it('signs in the roster admin only in the SDK local mode (pnpm dev without the CLI)', async () => {
		await freshDb();
		process.env.KEELSON_LOCAL_MODE = '1';
		process.env.KEELSON_LOCAL_USERS_FILE = 'seed-data/dev-users.json';
		const local = await call(meRoute.GET, 'GET', '/api/me');
		expect(local.status).toBe(200);
		expect(local.body).toMatchObject({ isAdmin: true, localPreview: true });

		// In a Keelson deployment the SDK refuses local mode: no identity, 401.
		process.env.KEELSON_APP_URL = 'https://example.test';
		expect((await call(meRoute.GET, 'GET', '/api/me')).status).toBe(401);
	});

	it('shows the local-preview banner behind keelson dev serve only', async () => {
		await freshDb();
		process.env.KEELSON_MODE = 'local';
		const local = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(local.body).toMatchObject({ isAdmin: false, localPreview: true });
		process.env.KEELSON_APP_URL = 'https://example.test';
		const deployed = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(deployed.body).toMatchObject({ localPreview: false });
	});

	it('answers unknown API paths with a code-only 404', async () => {
		await freshDb();
		const res = await call(fallbackRoute.fallback, 'GET', '/api/nope', { headers: as(ADMIN) });
		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: 'not_found' });
	});
});

describe('admin-only APIs answer 403 to members', () => {
	it.each([
		['GET /api/home', homeRoute.GET, 'GET', '/api/home', undefined, {}],
		['GET /api/items', itemsRoute.GET, 'GET', '/api/items', undefined, {}],
		['POST /api/items', itemsRoute.POST, 'POST', '/api/items', { assetTag: 'X', name: 'Y' }, {}],
		['GET /api/items/export', exportRoute.GET, 'GET', '/api/items/export', undefined, {}],
		['GET /api/members', membersRoute.GET, 'GET', '/api/members', undefined, {}],
		['GET /api/events', eventsRoute.GET, 'GET', '/api/events', undefined, {}],
		[
			'POST /api/masters/types',
			masterKindRoute.POST,
			'POST',
			'/api/masters/types',
			{ name: 'Tablet' },
			{ kind: 'types' },
		],
		[
			'GET /api/items/1/attachments',
			itemAttachmentsRoute.GET,
			'GET',
			'/api/items/1/attachments',
			undefined,
			{ id: '1' },
		],
	] as const)('%s', async (_label, handler, method, path, json, params) => {
		await freshDb();
		const res = await call(handler as Handler, method, path, {
			headers: as(MEMBER),
			json,
			params: params as Record<string, string>,
		});
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'forbidden_manage_required' });
	});
});

describe('issue and return over HTTP', () => {
	it('lets exactly one of two simultaneous issue requests win', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-1');
		const place = await placeId(db);
		const body = (userId: string) => ({ itemId, userId, placeId: place, issuedOn: PAST });
		const [a, b] = await Promise.all([
			call(assignmentsRoute.POST, 'POST', '/api/assignments', {
				headers: as(ADMIN),
				json: body(MEMBER.id),
			}),
			call(assignmentsRoute.POST, 'POST', '/api/assignments', {
				headers: as(ADMIN),
				json: body(OTHER.id),
			}),
		]);
		expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
		expect([a.body, b.body]).toContainEqual({ error: 'item_already_assigned' });
	});

	it("refuses a member returning someone else's item", async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-2');
		const issued = await call(assignmentsRoute.POST, 'POST', '/api/assignments', {
			headers: as(ADMIN),
			json: { itemId, userId: MEMBER.id, placeId: await placeId(db), issuedOn: PAST },
		});
		const id = (issued.body as { id: string }).id;
		const res = await call(returnRoute.POST, 'POST', `/api/assignments/${id}/return`, {
			headers: as(OTHER),
			json: { returnedOn: PAST },
			params: { id },
		});
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'assignment_not_owned' });

		const own = await call(returnRoute.POST, 'POST', `/api/assignments/${id}/return`, {
			headers: as(MEMBER),
			json: { returnedOn: PAST },
			params: { id },
		});
		expect(own.status).toBe(200);
		expect(own.body).toMatchObject({ returnKind: 'returned', returnedOn: PAST });
	});

	it('only accepts JSON bodies on state-changing endpoints (415)', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-3');
		const res = await call(assignmentsRoute.POST, 'POST', '/api/assignments', {
			headers: { ...as(ADMIN), 'content-type': 'application/x-www-form-urlencoded' },
			body: `itemId=${itemId}`,
		});
		expect(res.status).toBe(415);
		expect(res.body).toEqual({ error: 'unsupported_media_type' });
	});

	it('shows members only the items free to take, with limited columns', async () => {
		const db = await freshDb();
		const free = await addItem(db, 'MS-1', { note: 'secret purchase note' });
		const held = await addItem(db, 'MS-2');
		await call(assignmentsRoute.POST, 'POST', '/api/assignments', {
			headers: as(ADMIN),
			json: { itemId: held, userId: OTHER.id, placeId: await placeId(db), issuedOn: PAST },
		});
		const res = await call(availableRoute.GET, 'GET', '/api/available-items', {
			headers: as(MEMBER),
		});
		const body = res.body as { rows: Record<string, unknown>[]; total: number };
		expect(body.total).toBe(1);
		expect(body.rows[0]).toEqual({
			id: free,
			assetTag: 'MS-1',
			name: 'Laptop MS-1',
			typeName: null,
			storageLocation: 'Store room',
		});
	});
});

describe('ledger paging', () => {
	async function bulkInsert(db: Client, n: number) {
		const ts = new Date().toISOString();
		const statements = Array.from({ length: n }, (_, i) => ({
			sql: `INSERT INTO items (asset_tag, name, version, created_at, updated_at)
				VALUES (?, ?, 1, ?, ?)`,
			args: [`EQ-${String(i + 1).padStart(4, '0')}`, `Item ${i + 1}`, ts, ts],
		}));
		await db.batch(statements, 'write');
	}

	it('pages 1,000 items server-side with a total count', async () => {
		const db = await freshDb();
		await bulkInsert(db, 1000);
		const first = await call(itemsRoute.GET, 'GET', '/api/items?size=50&page=1', {
			headers: as(ADMIN),
		});
		const p1 = first.body as {
			rows: { assetTag: string }[];
			total: number;
			counts: { all: number };
		};
		expect(first.status).toBe(200);
		expect(p1.total).toBe(1000);
		expect(p1.counts.all).toBe(1000);
		expect(p1.rows).toHaveLength(50);
		expect(p1.rows[0].assetTag).toBe('EQ-0001');

		const last = await call(itemsRoute.GET, 'GET', '/api/items?size=200&page=5', {
			headers: as(ADMIN),
		});
		const p5 = last.body as { rows: { assetTag: string }[] };
		expect(p5.rows).toHaveLength(200);
		expect(p5.rows.at(-1)?.assetTag).toBe('EQ-1000');

		const desc = await call(itemsRoute.GET, 'GET', '/api/items?sort=tag&dir=desc', {
			headers: as(ADMIN),
		});
		expect((desc.body as { rows: { assetTag: string }[] }).rows[0].assetTag).toBe('EQ-1000');
	});

	it('filters by status and search, and counts each status', async () => {
		const db = await freshDb();
		await bulkInsert(db, 120);
		const itemId = Number(
			(await db.execute("SELECT id FROM items WHERE asset_tag = 'EQ-0007'")).rows[0].id,
		);
		await call(assignmentsRoute.POST, 'POST', '/api/assignments', {
			headers: as(ADMIN),
			json: { itemId, userId: MEMBER.id, placeId: await placeId(db), issuedOn: PAST },
		});
		const res = await call(itemsRoute.GET, 'GET', '/api/items?status=assigned', {
			headers: as(ADMIN),
		});
		const body = res.body as {
			rows: { assetTag: string; holder: { userId: string } }[];
			total: number;
			counts: Record<string, number>;
		};
		expect(body.total).toBe(1);
		expect(body.rows[0].holder.userId).toBe(MEMBER.id);
		expect(body.counts).toMatchObject({ all: 120, assigned: 1, unassigned: 119 });

		const search = await call(itemsRoute.GET, 'GET', '/api/items?q=EQ-011', {
			headers: as(ADMIN),
		});
		expect((search.body as { total: number }).total).toBe(10); // EQ-0110 .. EQ-0119
	});

	it('exports the filtered ledger as CSV', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-1');
		await addItem(db, '=HYPERLINK("x")');
		const res = await call(exportRoute.GET, 'GET', '/api/items/export', { headers: as(ADMIN) });
		expect(res.status).toBe(200);
		expect(res.res.headers.get('content-type')).toContain('text/csv');
		// UTF-8 BOM first (Response.text() strips it, so read the bytes).
		const bytes = new Uint8Array(await res.res.arrayBuffer());
		expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
		const text = res.body as string;
		const lines = text.trim().split('\r\n');
		expect(lines).toHaveLength(3); // header + 2 rows
		// Formula-looking cells are neutralized.
		expect(text).toContain(`"'=HYPERLINK(""x"")"`);
	});
});

describe('attachments', () => {
	const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

	it('stores, serves and deletes an attachment', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-1');
		const params = { id: String(itemId) };
		const up = await call(
			itemAttachmentsRoute.POST,
			'POST',
			`/api/items/${itemId}/attachments?name=receipt.png`,
			{
				headers: { ...as(ADMIN), 'content-type': 'application/octet-stream' },
				body: PNG,
				params,
			},
		);
		expect(up.status).toBe(201);
		const meta = up.body as { id: string; fileName: string; contentType: string; size: number };
		expect(meta).toMatchObject({ fileName: 'receipt.png', contentType: 'image/png', size: 12 });

		const get = await call(attachmentFile.GET, 'GET', `/api/attachments/${meta.id}`, {
			headers: as(ADMIN),
			params: { id: meta.id },
		});
		expect(get.status).toBe(200);
		expect(get.res.headers.get('content-type')).toBe('image/png');

		const del = await call(attachmentFile.DELETE, 'DELETE', `/api/attachments/${meta.id}`, {
			headers: as(ADMIN),
			json: {},
			params: { id: meta.id },
		});
		expect(del.status).toBe(200);
		const gone = await call(attachmentFile.GET, 'GET', `/api/attachments/${meta.id}`, {
			headers: as(ADMIN),
			params: { id: meta.id },
		});
		expect(gone.status).toBe(404);
	});

	it('rejects unsupported file types', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-2');
		const res = await call(
			itemAttachmentsRoute.POST,
			'POST',
			`/api/items/${itemId}/attachments?name=x.txt`,
			{
				headers: { ...as(ADMIN), 'content-type': 'application/octet-stream' },
				body: new TextEncoder().encode('plain text'),
				params: { id: String(itemId) },
			},
		);
		expect(res.status).toBe(415);
		expect(res.body).toEqual({ error: 'attachment_type_unsupported' });
	});
});
