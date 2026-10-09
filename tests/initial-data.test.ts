import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { issueItem } from '#lib/server/domain/assignments.ts';
import { listItems } from '#lib/server/domain/items.ts';
import { listMasters, updateMaster } from '#lib/server/domain/masters.ts';
import { setDirectoryForTest } from '#lib/server/domain/directory.ts';
import { getMember, listMembersPage, searchPeople } from '#lib/server/domain/people.ts';
import { parseItemQuery, parseMemberQuery } from '#lib/server/http/queries.ts';
import { ensureDefaultMasters } from '#lib/server/domain/seed.ts';
import sampleAssignments from '../seed-data/assignments.json';
import sampleItems from '../seed-data/items.json';
import masters from '../seed-data/masters.json';
import devUsers from '../seed-data/dev-users.json';
import { ADMIN, cleanupDbs, expectError, freshDb, invalid, tempDbUrl } from './support/harness.ts';
import { issueInput, placeId } from './support/helpers.ts';

// What a database contains after the server starts: default lists always,
// the sample ledger only in local development (`pnpm dev`), never in production.
// What the samples hold is read from seed-data/, so editing them keeps these
// tests passing.

afterEach(cleanupDbs);

const ALL_ITEMS = parseItemQuery(new URLSearchParams('size=200'));
/** `pnpm dev` without the CLI: the SDK's local mode with the roster, and the samples. */
const LOCAL_DEV = {
	KEELSON_LOCAL_MODE: '1',
	KEELSON_LOCAL_USERS_FILE: 'seed-data/dev-users.json',
	LOCAL_SAMPLE_DATA: '1',
};
/** A general user of the local roster (seed-data/dev-users.json). */
const SAMPLE_PERSON = devUsers.users.filter((u) => !u.perms.includes('manage'))[0];

async function itemCount(db: Client): Promise<number> {
	return (await listItems(db, ADMIN, ALL_ITEMS)).total;
}

describe('production-equivalent start (gateway sign-in, pnpm start)', () => {
	it('starts with an empty ledger and the default lists', async () => {
		const db = await freshDb();
		expect(await itemCount(db)).toBe(0);
		const lists = await listMasters(db);
		expect(lists.types.map((t) => t.name)).toEqual(masters.types);
		expect(lists.places.map((p) => p.name)).toEqual(masters.places);
	});

	it('never loads samples, even if LOCAL_SAMPLE_DATA is set', async () => {
		const db = await freshDb({ env: { LOCAL_SAMPLE_DATA: '1' } });
		expect(await itemCount(db)).toBe(0);
	});

	it('never loads samples in a Keelson deployment', async () => {
		const db = await freshDb({
			env: { ...LOCAL_DEV, KEELSON_APP_URL: 'https://example.test' },
		});
		expect(await itemCount(db)).toBe(0);
	});

	it('does not re-add a default list entry an admin renamed', async () => {
		const db = await freshDb();
		const before = await listMasters(db);
		await updateMaster(db, ADMIN, 'places', before.places[0].id, { name: 'Head office' });
		await ensureDefaultMasters(db);
		const after = (await listMasters(db)).places.map((p) => p.name);
		expect(after).toHaveLength(masters.places.length);
		expect(after).not.toContain(masters.places[0]);
	});

	it('offers no one without a directory', async () => {
		await freshDb();
		setDirectoryForTest(null, false);
		const res = await searchPeople(ADMIN, '');
		expect(res.state).toBe('unconfigured');
		expect(res.items).toEqual([]);
	});

	it('refuses to issue to a roster person outside the directory', async () => {
		const db = await freshDb({ samples: true });
		const { rows } = await listItems(
			db,
			ADMIN,
			parseItemQuery(new URLSearchParams('status=unassigned')),
		);
		await expectError(
			issueItem(db, ADMIN, issueInput(rows[0].id, SAMPLE_PERSON.id, await placeId(db))),
			invalid({ userId: 'not_found' }),
		);
	});
});

describe('local development (pnpm dev)', () => {
	it('loads the sample ledger into an empty database', async () => {
		const db = await freshDb({ env: LOCAL_DEV });
		const { counts } = await listItems(db, ADMIN, ALL_ITEMS);
		expect(counts.all).toBe(sampleItems.items.length);
		// Every state the screens need to show is present in the samples.
		expect(counts.assigned).toBeGreaterThan(0);
		expect(counts.unassigned).toBeGreaterThan(0);
		expect(counts.pending_return).toBeGreaterThan(0);
		expect(counts.overdue).toBeGreaterThan(0);
		expect(counts.suspended).toBeGreaterThan(0);
	});

	it('does not load the samples twice', async () => {
		const url = tempDbUrl();
		await freshDb({ env: LOCAL_DEV, url });
		const again = await freshDb({ env: LOCAL_DEV, url });
		expect(await itemCount(again)).toBe(sampleItems.items.length);
	});

	it('can start empty with LOCAL_SAMPLE_DATA=0', async () => {
		const db = await freshDb({ env: { ALLOW_DEV_AUTH: '1', LOCAL_SAMPLE_DATA: '0' } });
		expect(await itemCount(db)).toBe(0);
	});

	it('lists the local roster as the members', async () => {
		await freshDb({ env: LOCAL_DEV });
		setDirectoryForTest(null);
		const res = await searchPeople(ADMIN, '');
		expect(res.state).toBe('ok');
		expect(res.items.map((p) => p.id).sort()).toEqual(devUsers.users.map((u) => u.id).sort());
	});

	it('shows an exchange in progress and a former member', async () => {
		const db = await freshDb({ env: LOCAL_DEV });
		setDirectoryForTest(null);
		// The person whose old item is replaced (`replacedByTag`) but not returned yet.
		const exchange = sampleAssignments.assignments.find((a) => 'replacedByTag' in a);
		expect(exchange, 'seed-data/assignments.json has an exchange in progress').toBeDefined();
		const page = await getMember(db, ADMIN, exchange?.user ?? '');
		const statuses = page.holdings.map((h) => h.status);
		expect(statuses).toContain('pending_return');
		expect(statuses).toContain('assigned');
		const { rows } = await listMembersPage(db, ADMIN, parseMemberQuery(new URLSearchParams()));
		expect(rows.filter((r) => r.membership === 'former').map((r) => r.id)).toEqual(
			sampleAssignments.former.map((p) => p.id),
		);
	});

	it('lets the local admin issue to a roster person', async () => {
		const db = await freshDb({ env: LOCAL_DEV });
		setDirectoryForTest(null);
		const { rows } = await listItems(
			db,
			ADMIN,
			parseItemQuery(new URLSearchParams('status=unassigned')),
		);
		const a = await issueItem(
			db,
			ADMIN,
			issueInput(rows[0].id, SAMPLE_PERSON.id, await placeId(db)),
		);
		expect(a.userName).toBe(SAMPLE_PERSON.name);
	});
});
