import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as mcpRoute from '../src/routes/api/mcp/[tool]/+server.ts';
import { MCP_LIST_LIMIT } from '#lib/limits.ts';
import { today } from '#lib/server/dates.ts';
import { setDirectoryForTest } from '#lib/server/domain/directory.ts';
import { listItemEvents } from '#lib/server/domain/events.ts';
import { addMaster } from '#lib/server/domain/masters.ts';
import { argName } from '#lib/server/mcp/refs.ts';
import * as tools from '#lib/server/mcp/tools.ts';
import { ADMIN, cleanupDbs, directoryPerson, freshDb, MEMBER, OTHER } from './support/harness.ts';
import { addItem, FUTURE, LATER, PAST } from './support/helpers.ts';
import { as, call, type Caller, callTool } from './support/http.ts';

// AI assistant (MCP) tools: the main flows work through the real auth hook
// and the POST /api/mcp/<tool> route, as the platform gateway calls them. That
// keelson.yaml declares these tools as the registry has them is
// tests/mcp-manifest.test.ts.

afterEach(cleanupDbs);

type ResultOf<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

/** What each tool answers on success: the return type of its function in tools.ts. */
interface Results {
	find_items: ResultOf<typeof tools.findItems>;
	find_available_items: ResultOf<typeof tools.findAvailableItems>;
	get_item: ResultOf<typeof tools.getItem>;
	my_items: ResultOf<typeof tools.myItems>;
	member_items: ResultOf<typeof tools.memberItems>;
	list_masters: ResultOf<typeof tools.listMasters>;
	register_item: ResultOf<typeof tools.registerItem>;
	issue_item: ResultOf<typeof tools.issueItem>;
	take_item: ResultOf<typeof tools.takeItem>;
	return_item: ResultOf<typeof tools.returnItem>;
	suspend_item: ResultOf<typeof tools.suspendItem>;
	resume_item: ResultOf<typeof tools.resumeItem>;
}

/** A tool's 4xx answer: the status and the body the model reads. */
interface Refusal {
	status: number;
	body: {
		error: string;
		fields?: Record<string, string>;
		candidates?: { id: string; name: string; email: string | null }[];
		choices?: Record<string, string[]>;
	};
}

/** Call a tool and return its result, failing the test unless it answered 200. */
async function run<N extends keyof Results>(
	name: N,
	args: object = {},
	actor: Caller = ADMIN,
): Promise<Results[N]> {
	const res = await callTool(name, args, actor);
	expect(res.status, `${name} answered ${JSON.stringify(res.body)}`).toBe(200);
	return res.body as Results[N];
}

/** Call a tool that refuses, failing the test unless it answered 4xx. */
async function refuse(name: string, args: object = {}, actor: Caller = ADMIN): Promise<Refusal> {
	const res = await callTool(name, args, actor);
	expect(res.status, `${name} answered ${JSON.stringify(res.body)}`).toBeGreaterThanOrEqual(400);
	return { status: res.status, body: res.body as Refusal['body'] };
}

/** The field-level refusal (422 validation_failed) with exactly these reasons. */
function invalidArgs(fields: Record<string, string>): Refusal {
	return { status: 422, body: { error: 'validation_failed', fields } };
}

/**
 * A usage place this test adds after the default ones (so it is not the
 * default place), to see that a tool uses the place it was given.
 */
async function addedPlace(db: Client): Promise<string> {
	return (await addMaster(db, ADMIN, 'places', 'Test Annex')).name;
}

// --- Flows --------------------------------------------------------------------

describe('admin flow: register -> issue -> look up -> return', () => {
	it('works end to end and marks the history as done through MCP', async () => {
		const db = await freshDb();
		const { types } = await run('list_masters');
		const place = await addedPlace(db);

		const { item } = await run('register_item', {
			asset_tag: 'PC-0101',
			name: 'Laptop 14',
			type: types[0],
			serial_no: 'SN-1',
			purchased_on: PAST,
		});
		expect(item).toMatchObject({ asset_tag: 'PC-0101', type: types[0], status: 'unassigned' });

		const unassigned = await run('find_items', { q: 'Laptop', status: ['unassigned'] });
		expect(unassigned.items.map((r) => r.asset_tag)).toEqual(['PC-0101']);

		const issued = await run('issue_item', {
			asset_tag: 'PC-0101',
			person: MEMBER.email,
			place,
			due_on: FUTURE,
		});
		expect(issued.assignment).toMatchObject({
			asset_tag: 'PC-0101',
			person: MEMBER.name,
			place,
			issued_on: today(),
			due_on: FUTURE,
		});

		expect(await run('get_item', { asset_tag: 'PC-0101' })).toMatchObject({
			asset_tag: 'PC-0101',
			status: 'assigned',
			holder: { person: MEMBER.name, place },
			assignment_count: 1,
		});

		expect(await run('member_items', { person: MEMBER.name })).toMatchObject({
			person: { id: MEMBER.id, membership: 'member' },
			items: [{ asset_tag: 'PC-0101', status: 'assigned' }],
			total: 1,
			truncated: false,
		});
		const byHolder = await run('find_items', { holder: MEMBER.email });
		expect(byHolder.items).toEqual([
			expect.objectContaining({ asset_tag: 'PC-0101', holder: MEMBER.name }),
		]);

		const returned = await run('return_item', { asset_tag: 'PC-0101' });
		expect(returned.assignment).toMatchObject({
			returned_on: today(),
			return_kind: 'collected',
		});
		const after = await run('find_items', { status: ['unassigned'] });
		expect(after.items.map((r) => r.asset_tag)).toContain('PC-0101');

		const events = await listItemEvents(db, ADMIN, item.id);
		expect(events.map((e) => e.kind).sort()).toEqual(['create', 'issue', 'return']);
		for (const e of events) {
			expect(e.detail?.source).toBe('mcp');
		}
	});

	it('registers and issues in one call, and nothing is left if the issue fails', async () => {
		const db = await freshDb();
		const ok = await run('register_item', {
			asset_tag: 'MN-0031',
			name: 'Monitor EV2480',
			assign_to: { person: OTHER.name, issued_on: PAST },
		});
		expect(ok.item).toMatchObject({ status: 'assigned', holder: OTHER.name, issued_on: PAST });

		const bad = await refuse('register_item', {
			asset_tag: 'MN-0032',
			name: 'Monitor EV2480',
			assign_to: { person: OTHER.name, issued_on: FUTURE },
		});
		expect(bad).toEqual(invalidArgs({ 'assign_to.issued_on': 'future' }));
		const left = await db.execute("SELECT COUNT(*) AS n FROM items WHERE asset_tag = 'MN-0032'");
		expect(Number(left.rows[0].n)).toBe(0);
	});

	it('answers a second registration of the same tag with asset_tag: taken', async () => {
		await freshDb();
		const args = { asset_tag: 'MN-0031', name: 'Monitor' };
		await run('register_item', args);
		expect(await refuse('register_item', args)).toEqual(invalidArgs({ asset_tag: 'taken' }));
	});

	it('exchanges, suspends and resumes', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-OLD');
		await addItem(db, 'PC-NEW');
		await run('issue_item', { asset_tag: 'PC-OLD', person: MEMBER.id, issued_on: PAST });

		await run('issue_item', { asset_tag: 'PC-NEW', person: MEMBER.id, exchange_for: 'PC-OLD' });
		const held = await run('member_items', { person: MEMBER.email });
		expect(held.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ asset_tag: 'PC-OLD', status: 'pending_return' }),
				expect.objectContaining({ asset_tag: 'PC-NEW', status: 'assigned' }),
			]),
		);

		await addItem(db, 'PC-BROKEN');
		const suspended = await run('suspend_item', {
			asset_tag: 'PC-BROKEN',
			reason: 'broken',
			detail: 'No picture',
		});
		expect(suspended.item.status).toBe('suspended');
		expect(await refuse('issue_item', { asset_tag: 'PC-BROKEN', person: OTHER.id })).toEqual({
			status: 409,
			body: { error: 'item_suspended' },
		});
		const resumed = await run('resume_item', { asset_tag: 'PC-BROKEN' });
		expect(resumed.item.status).toBe('unassigned');
	});

	it('rejects a second issue and a return of an item nobody holds', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-1');
		await addItem(db, 'PC-2');
		await run('issue_item', { asset_tag: 'PC-1', person: MEMBER.id });
		expect(await refuse('issue_item', { asset_tag: 'PC-1', person: OTHER.id })).toEqual({
			status: 409,
			body: { error: 'item_already_assigned' },
		});
		expect(await refuse('return_item', { asset_tag: 'PC-2' })).toEqual({
			status: 409,
			body: { error: 'item_not_assigned' },
		});
		expect(await refuse('get_item', { asset_tag: 'NOPE-1' })).toEqual({
			status: 404,
			body: { error: 'item_not_found' },
		});
	});

	it('reports date rules under the argument names', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-1');
		const order = await refuse('issue_item', {
			asset_tag: 'PC-1',
			person: MEMBER.id,
			issued_on: LATER,
			due_on: PAST,
		});
		expect(order).toEqual(invalidArgs({ due_on: 'before_issued' }));
		const bad = await refuse('issue_item', {
			asset_tag: 'PC-1',
			person: MEMBER.id,
			issued_on: 'x',
		});
		expect(bad).toEqual(invalidArgs({ issued_on: 'invalid_date' }));
	});

	it('matches asset tags case-insensitively when only one item fits', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-0101');
		expect(await run('get_item', { asset_tag: 'pc-0101' })).toMatchObject({
			asset_tag: 'PC-0101',
		});
	});
});

describe('member flow', () => {
	it('finds a free item, takes it, lists and returns it', async () => {
		const db = await freshDb();
		await addItem(db, 'MS-0012', { name: 'Mouse' });
		const { places } = await run('list_masters');

		expect(await run('find_available_items', { q: 'Mouse' }, MEMBER)).toEqual({
			items: [
				{
					id: expect.any(Number),
					asset_tag: 'MS-0012',
					name: 'Mouse',
					type: null,
					storage_location: 'Store room',
				},
			],
			total: 1,
			truncated: false,
		});

		// Without a place, the first usage place.
		const taken = await run('take_item', { asset_tag: 'MS-0012' }, MEMBER);
		expect(taken.assignment).toMatchObject({
			person: MEMBER.name,
			place: places[0],
			issued_on: today(),
		});

		expect(await run('my_items', {}, MEMBER)).toMatchObject({
			person: { name: MEMBER.name },
			items: [{ asset_tag: 'MS-0012', status: 'assigned' }],
			total: 1,
		});

		const back = await run('return_item', { asset_tag: 'MS-0012' }, MEMBER);
		expect(back.assignment.return_kind).toBe('returned');
		expect((await run('my_items', {}, MEMBER)).total).toBe(0);
	});

	it.each([
		['find_items', {}],
		['get_item', { asset_tag: 'PC-1' }],
		['member_items', { person: 'Other' }],
		['register_item', { asset_tag: 'PC-9', name: 'Laptop' }],
		['issue_item', { asset_tag: 'PC-1', person: 'Other' }],
		['suspend_item', { asset_tag: 'PC-1', reason: 'lost' }],
		['resume_item', { asset_tag: 'PC-1' }],
	])('gets 403 from the admin-only tool %s', async (name, args) => {
		await freshDb();
		expect(await refuse(name, args, MEMBER)).toEqual({
			status: 403,
			body: { error: 'forbidden_manage_required' },
		});
	});

	it("cannot return someone else's item or use the admin-only return options", async () => {
		const db = await freshDb();
		await addItem(db, 'PC-1');
		await run('issue_item', { asset_tag: 'PC-1', person: OTHER.id });
		expect(await refuse('return_item', { asset_tag: 'PC-1' }, MEMBER)).toEqual({
			status: 403,
			body: { error: 'assignment_not_owned' },
		});

		await addItem(db, 'PC-2');
		await run('take_item', { asset_tag: 'PC-2' }, MEMBER);
		expect(await refuse('return_item', { asset_tag: 'PC-2', needs_repair: true }, MEMBER)).toEqual({
			status: 403,
			body: { error: 'forbidden_manage_required' },
		});
	});
});

// --- People, names, limits ----------------------------------------------------

describe('person references', () => {
	const PEOPLE = [
		{ id: 'u-taro', name: 'Taro Yamada', email: 'taro.yamada@example.com' },
		{ id: 'u-hanako', name: 'Hanako Yamada', email: 'hanako@example.com' },
		{ id: 'u-sato', name: 'Sato', email: 'sato@example.com' },
		{ id: 'u-sato2', name: 'Sato Ichiro', email: 'ichiro@example.com' },
	];

	async function setup() {
		const db = await freshDb();
		setDirectoryForTest(async () => [ADMIN, ...PEOPLE].map(directoryPerson));
		await addItem(db, 'PC-1');
		return db;
	}

	/** Issue PC-1 to the person `ref` names, and return who it went to. */
	async function issuedTo(ref: string): Promise<string> {
		return (await run('issue_item', { asset_tag: 'PC-1', person: ref })).assignment.person;
	}

	it('matches an email exactly, ignoring case', async () => {
		await setup();
		expect(await issuedTo('TARO.YAMADA@example.com')).toBe('Taro Yamada');
	});

	it('matches a full name, ignoring case and spaces', async () => {
		await setup();
		expect(await issuedTo('hanakoyamada')).toBe('Hanako Yamada');
	});

	it('prefers an exact name over partial matches', async () => {
		await setup();
		expect(await issuedTo('Sato')).toBe('Sato');
	});

	it('takes a unique partial name, and a candidate id', async () => {
		await setup();
		expect(await issuedTo('Taro')).toBe('Taro Yamada');
		await run('return_item', { asset_tag: 'PC-1' });
		expect(await issuedTo('u-hanako')).toBe('Hanako Yamada');
	});

	it('answers an ambiguous name with the candidates', async () => {
		await setup();
		const res = await refuse('issue_item', { asset_tag: 'PC-1', person: 'Yamada' });
		expect(res.status).toBe(422);
		expect(res.body.fields).toEqual({ person: 'ambiguous' });
		expect(res.body.candidates).toEqual([
			{ id: 'u-hanako', name: 'Hanako Yamada', email: 'hanako@example.com' },
			{ id: 'u-taro', name: 'Taro Yamada', email: 'taro.yamada@example.com' },
		]);
	});

	it('answers an unknown person with not_found', async () => {
		await setup();
		expect(await refuse('issue_item', { asset_tag: 'PC-1', person: 'Nobody' })).toEqual(
			invalidArgs({ person: 'not_found' }),
		);
	});

	it('finds a former member in lookups but not as an issue target', async () => {
		const db = await setup();
		await issuedTo('Sato Ichiro');
		// Sato Ichiro leaves the workspace.
		setDirectoryForTest(async () =>
			[ADMIN, ...PEOPLE.filter((p) => p.id !== 'u-sato2')].map(directoryPerson),
		);
		expect(await run('member_items', { person: 'Ichiro' })).toMatchObject({
			person: { id: 'u-sato2', membership: 'former' },
			items: [{ asset_tag: 'PC-1' }],
		});
		await addItem(db, 'PC-2');
		expect(await refuse('issue_item', { asset_tag: 'PC-2', person: 'Ichiro' })).toEqual(
			invalidArgs({ person: 'not_found' }),
		);
	});

	it('reports every lookup problem of one call together', async () => {
		await setup();
		const res = await refuse('register_item', {
			asset_tag: 'PC-9',
			name: 'Laptop',
			type: 'Spaceship',
			assign_to: { person: 'Yamada', place: 'Moon' },
		});
		expect(res.status).toBe(422);
		const { types, places } = await run('list_masters');
		expect(res.body.fields).toEqual({
			type: 'not_found',
			'assign_to.place': 'not_found',
			'assign_to.person': 'ambiguous',
		});
		expect(res.body.choices).toEqual({ type: types, 'assign_to.place': places });
		expect(res.body.candidates?.map((c) => c.id)).toEqual(['u-hanako', 'u-taro']);
	});
});

/** ASCII letters and digits as their full-width forms (as some IMEs type them). */
function fullWidth(text: string): string {
	return text.replace(/[!-~]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

describe('names, dates and limits', () => {
	it('accepts type and place names regardless of width, case and spaces', async () => {
		const db = await freshDb();
		// A type name that mixes Japanese and Latin letters ("<dock in katakana>-X1"),
		// added here so the test does not depend on the default lists.
		const dock = `${String.fromCodePoint(0x30c9, 0x30c3, 0x30af)}-X1`;
		await addMaster(db, ADMIN, 'types', dock);
		const registered = await run('register_item', {
			asset_tag: 'PC-1',
			name: 'Laptop',
			type: ` ${fullWidth(dock).toLowerCase()} `,
		});
		expect(registered.item.type).toBe(dock);
		const place = await addedPlace(db);
		await addItem(db, 'PC-2');
		const issued = await run('issue_item', {
			asset_tag: 'PC-2',
			person: MEMBER.id,
			place: ` ${place}`,
		});
		expect(issued.assignment.place).toBe(place);
	});

	it('defaults the issue and return dates to today', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-1');
		const issued = await run('issue_item', { asset_tag: 'PC-1', person: MEMBER.id });
		expect(issued.assignment.issued_on).toBe(today());
		const back = await run('return_item', { asset_tag: 'PC-1' }, MEMBER);
		expect(back.assignment.returned_on).toBe(today());
	});

	it('returns MCP_LIST_LIMIT.default rows by default and never more than its max', async () => {
		const db = await freshDb();
		const count = MCP_LIST_LIMIT.max + 10;
		for (let i = 0; i < count; i++) {
			await addItem(db, `EQ-${String(i).padStart(3, '0')}`);
		}
		const first = await run('find_items');
		expect(first.items).toHaveLength(MCP_LIST_LIMIT.default);
		expect(first).toMatchObject({ total: count, truncated: true });
		expect(first.items[0].asset_tag).toBe('EQ-000');

		const capped = await run('find_items', { limit: MCP_LIST_LIMIT.max * 10 });
		expect(capped.items).toHaveLength(MCP_LIST_LIMIT.max);
		expect(capped.truncated).toBe(true);

		const free = await run('find_available_items', { limit: count }, MEMBER);
		expect(free.items).toHaveLength(MCP_LIST_LIMIT.max);

		expect(await refuse('find_items', { limit: 0 })).toEqual(invalidArgs({ limit: 'invalid' }));
	});
});

describe('the MCP route', () => {
	it.each(['no_such_tool', 'constructor', 'toString'])(
		'answers 404 mcp_tool_not_found for %s',
		async (name) => {
			await freshDb();
			expect(await refuse(name)).toEqual({ status: 404, body: { error: 'mcp_tool_not_found' } });
		},
	);

	it('requires a trusted identity', async () => {
		await freshDb();
		const res = await call(mcpRoute.POST, 'POST', '/api/mcp/my_items', {
			json: {},
			params: { tool: 'my_items' },
		});
		expect(res.status).toBe(401);
	});

	it('does not mark the history when the gateway did not say MCP', async () => {
		const db = await freshDb();
		const res = await call(mcpRoute.POST, 'POST', '/api/mcp/register_item', {
			headers: as(ADMIN),
			json: { asset_tag: 'PC-1', name: 'Laptop' },
			params: { tool: 'register_item' },
		});
		const { item } = res.body as Results['register_item'];
		const events = await listItemEvents(db, ADMIN, item.id);
		expect(events[0].detail).toBeNull();
	});

	it('answers a malformed assign_to block as an argument problem', async () => {
		await freshDb();
		const res = await refuse('register_item', {
			asset_tag: 'PC-1',
			name: 'Laptop',
			assign_to: 'x',
		});
		expect(res).toEqual(invalidArgs({ assign_to: 'invalid' }));
	});

	it('keeps notes short in get_item', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-1', { note: 'n'.repeat(tools.TEXT_MAX * 5) });
		const { note } = await run('get_item', { asset_tag: 'PC-1' });
		expect(note).toBe(`${'n'.repeat(tools.TEXT_MAX)}...`);
	});
});

describe('argument names in errors', () => {
	it('names every field the business layer reports after the tool argument', () => {
		const names = {
			// issue_item / take_item
			userId: 'person',
			placeId: 'place',
			issuedOn: 'issued_on',
			dueOn: 'due_on',
			exchangeFrom: 'exchange_for',
			// register_item
			assetTag: 'asset_tag',
			typeId: 'type',
			'assignment.userId': 'assign_to.person',
			'assignment.placeId': 'assign_to.place',
			'assignment.issuedOn': 'assign_to.issued_on',
			'assignment.dueOn': 'assign_to.due_on',
			// return_item
			returnedOn: 'returned_on',
			// a field added later follows the rule without an entry
			warrantyUntil: 'warranty_until',
		};
		for (const [field, arg] of Object.entries(names)) {
			expect(argName(field)).toBe(arg);
		}
	});
});
