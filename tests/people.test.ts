import type { MemberItem } from '@keelsonhq/identity';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import * as itemAssignmentsRoute from '../src/routes/api/items/[id]/assignments/+server.ts';
import * as meRoute from '../src/routes/api/me/+server.ts';
import {
	type AssignmentView,
	issueItem,
	listItemAssignments,
	returnAssignment,
} from '#lib/server/domain/assignments.ts';
import { getHome } from '#lib/server/domain/home.ts';
import { getItem, listItems } from '#lib/server/domain/items.ts';
import {
	directorySnapshot,
	memberToPerson,
	type Person,
	setDirectoryForTest,
} from '#lib/server/domain/directory.ts';
import { getMe, getMember, listMembersPage, searchPeople } from '#lib/server/domain/people.ts';
import { parseItemQuery, parseMemberQuery } from '#lib/server/http/queries.ts';
import {
	ADMIN,
	cleanupDbs,
	directoryPerson,
	expectError,
	freshDb,
	IMAGE_URLS,
	MEMBER,
	OTHER,
} from './support/harness.ts';
import {
	addItem,
	issueInput,
	issueTo,
	LATER,
	PAST_DUE,
	placeId,
	returnInput,
} from './support/helpers.ts';
import { as, call } from './support/http.ts';

afterEach(cleanupDbs);

describe('workspace directory', () => {
	it('tells the UI when the directory is not set up, and invents nobody', async () => {
		const db = await freshDb();
		setDirectoryForTest(null, false);
		const res = await searchPeople(ADMIN, '');
		expect(res.state).toBe('unconfigured');
		expect(res.items).toEqual([]);

		const itemId = await addItem(db, 'PC-1');
		await expectError(issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db))), {
			status: 409,
			code: 'people_unconfigured',
		});
	});

	it('reports an unavailable directory instead of failing the screen', async () => {
		const db = await freshDb();
		setDirectoryForTest(async () => {
			throw new Error('network down');
		});
		const res = await searchPeople(ADMIN, '');
		expect(res.state).toBe('unavailable');
		const page = await listMembersPage(db, ADMIN, parseMemberQuery(new URLSearchParams()));
		expect(page.state).toBe('unavailable');
	});

	it('searches members by name or email', async () => {
		await freshDb();
		const res = await searchPeople(ADMIN, 'other@');
		expect(res.items.map((p) => p.id)).toEqual([OTHER.id]);
	});

	it('keeps the history of someone who left the workspace', async () => {
		const db = await freshDb();
		await issueTo(db, 'PC-2', OTHER.id);
		// OTHER leaves the workspace.
		setDirectoryForTest(async () => [directoryPerson(ADMIN)]);
		const page = await getMember(db, ADMIN, OTHER.id);
		expect(page.person).toMatchObject({ name: OTHER.name, membership: 'former' });
		expect(page.holdings).toHaveLength(1);
		const list = await listMembersPage(db, ADMIN, parseMemberQuery(new URLSearchParams()));
		expect(list.rows.find((r) => r.id === OTHER.id)?.membership).toBe('former');
	});

	it('pages, filters and sorts the members list', async () => {
		const db = await freshDb();
		await issueTo(db, 'PC-3', MEMBER.id);
		const holding = await listMembersPage(
			db,
			ADMIN,
			parseMemberQuery(new URLSearchParams('holding=1')),
		);
		expect(holding.rows.map((r) => r.id)).toEqual([MEMBER.id]);
		const byCount = await listMembersPage(
			db,
			ADMIN,
			parseMemberQuery(new URLSearchParams('sort=assigned&dir=desc')),
		);
		expect(byCount.rows[0].id).toBe(MEMBER.id);
		expect(byCount.total).toBe(3);
	});

	it('is admin-only', async () => {
		const db = await freshDb();
		await expectError(getMember(db, MEMBER, OTHER.id), {
			status: 403,
			code: 'forbidden_manage_required',
		});
	});
});

// A cold cache under concurrent requests (every page load reads the index
// through /api/me) must cost one directory read, shared by all of them.
describe('directory cache', () => {
	it('shares one read between concurrent requests', async () => {
		await freshDb();
		let calls = 0;
		let release: (people: Person[]) => void = () => {};
		setDirectoryForTest(() => {
			calls++;
			return new Promise<Person[]>((resolve) => {
				release = resolve;
			});
		});
		const pending = Promise.all(Array.from({ length: 5 }, () => directorySnapshot()));
		expect(calls).toBe(1);
		release([directoryPerson(ADMIN)]);
		const all = await pending;
		expect(all.map((r) => r.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
		expect(all[0].people.map((p) => p.id)).toEqual([ADMIN.id]);
		expect(all.every((r) => r.people === all[0].people)).toBe(true);
		// Served from the cache afterwards.
		expect((await directorySnapshot()).people).toBe(all[0].people);
		expect(calls).toBe(1);
	});

	it('shares one failed read too, and caches the failure', async () => {
		await freshDb();
		let calls = 0;
		setDirectoryForTest(async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 5));
			throw new Error('network down');
		});
		const all = await Promise.all(Array.from({ length: 5 }, () => directorySnapshot()));
		expect(calls).toBe(1);
		expect(all.every((r) => r.state === 'unavailable' && r.people.length === 0)).toBe(true);
		// The failure is cached (FAILURE_TTL_MS): no new read right away.
		expect((await directorySnapshot()).state).toBe('unavailable');
		expect(calls).toBe(1);
	});
});

// Profile images come from the directory and are looked up on every display,
// never stored. Every response that names a person
// carries `imageUrl` (or `userImageUrl`): the member's current image, or null.
describe('profile images', () => {
	it('maps the directory image_url, treating a missing one as null', () => {
		const base: MemberItem = {
			id: 'u-1',
			email: 'u1@example.com',
			name: 'U One',
			role: null,
			image_url: 'https://img.example.com/u/1',
		};
		expect(memberToPerson(base).imageUrl).toBe('https://img.example.com/u/1');
		expect(memberToPerson({ ...base, image_url: null }).imageUrl).toBeNull();
		// An older directory that does not send the field at all.
		const { image_url: _omitted, ...withoutImage } = base;
		expect(memberToPerson(withoutImage as MemberItem).imageUrl).toBeNull();
	});

	it('puts the image on every response that names a member', async () => {
		const db = await freshDb();
		const { itemId } = await issueTo(db, 'PC-10', ADMIN.id);
		await issueTo(db, 'PC-11', MEMBER.id);

		// Who am I (/api/me), with and without an image.
		const admin = await call(meRoute.GET, 'GET', '/api/me', { headers: as(ADMIN) });
		expect(admin.body).toMatchObject({ userId: ADMIN.id, imageUrl: IMAGE_URLS[ADMIN.id] });
		const member = await call(meRoute.GET, 'GET', '/api/me', { headers: as(MEMBER) });
		expect(member.body).toMatchObject({ userId: MEMBER.id, imageUrl: null });

		// Picker candidates and the members screen.
		const search = await searchPeople(ADMIN, '');
		expect(search.items.find((p) => p.id === OTHER.id)?.imageUrl).toBe(IMAGE_URLS[OTHER.id]);
		expect(search.items.find((p) => p.id === MEMBER.id)?.imageUrl).toBeNull();
		const list = await listMembersPage(db, ADMIN, parseMemberQuery(new URLSearchParams()));
		expect(list.rows.find((r) => r.id === ADMIN.id)?.imageUrl).toBe(IMAGE_URLS[ADMIN.id]);
		expect(list.rows.find((r) => r.id === MEMBER.id)?.imageUrl).toBeNull();

		// A person's page and my own page: the name tag and the ledger rows.
		const page = await getMember(db, ADMIN, ADMIN.id);
		expect(page.person.imageUrl).toBe(IMAGE_URLS[ADMIN.id]);
		expect(page.ledger.map((a) => a.userImageUrl)).toEqual([IMAGE_URLS[ADMIN.id]]);
		const mine = await getMe(db, MEMBER);
		expect(mine.person.imageUrl).toBeNull();
		expect(mine.ledger.map((a) => a.userImageUrl)).toEqual([null]);

		// The item ledger, an item's page, its assignments and the home screen.
		const items = await listItems(db, ADMIN, parseItemQuery(new URLSearchParams()));
		const holders = new Map(items.rows.map((r) => [r.assetTag, r.holder?.imageUrl]));
		expect(holders.get('PC-10')).toBe(IMAGE_URLS[ADMIN.id]);
		expect(holders.get('PC-11')).toBeNull();
		expect((await getItem(db, ADMIN, itemId)).holder?.imageUrl).toBe(IMAGE_URLS[ADMIN.id]);
		const ledger = await listItemAssignments(db, ADMIN, itemId);
		expect(ledger.map((a) => a.userImageUrl)).toEqual([IMAGE_URLS[ADMIN.id]]);
		const { itemId: overdue } = await issueTo(db, 'PC-12', OTHER.id, { dueOn: PAST_DUE });
		const home = await getHome(db, ADMIN);
		expect(home.attention.rows.find((r) => r.id === overdue)?.holder?.imageUrl).toBe(
			IMAGE_URLS[OTHER.id],
		);
	});

	it('shows no image for someone who left the workspace', async () => {
		const db = await freshDb();
		const { itemId } = await issueTo(db, 'PC-20', OTHER.id);
		setDirectoryForTest(async () => [directoryPerson(ADMIN), directoryPerson(MEMBER)]);

		const page = await getMember(db, ADMIN, OTHER.id);
		expect(page.person).toMatchObject({ membership: 'former', imageUrl: null });
		expect(page.ledger[0].userImageUrl).toBeNull();
		const list = await listMembersPage(db, ADMIN, parseMemberQuery(new URLSearchParams()));
		expect(list.rows.find((r) => r.id === OTHER.id)?.imageUrl).toBeNull();
		expect((await getItem(db, ADMIN, itemId)).holder?.imageUrl).toBeNull();
		expect((await listItemAssignments(db, ADMIN, itemId))[0].userImageUrl).toBeNull();
	});

	it('shows no image without a directory', async () => {
		const db = await freshDb();
		setDirectoryForTest(null, false);
		expect((await getMe(db, ADMIN)).person.imageUrl).toBeNull();
		// A deployed app whose directory is not set up: null, not an error.
		const me = await call(meRoute.GET, 'GET', '/api/me', { headers: as(ADMIN) });
		expect(me.status).toBe(200);
		expect(me.body).toMatchObject({ imageUrl: null });
	});
});

// Someone who left the workspace keeps their records under the snapshot name.
// The assignment rows say so (`userMembership`), so the item's ledger can put
// the "former member" chip next to them (DESIGN.md §8.10).
describe('former members on the assignment ledger', () => {
	it('marks the rows of someone no longer in the directory', async () => {
		const db = await freshDb();
		const first = await issueTo(db, 'PC-30', OTHER.id);
		const { itemId } = first;
		await returnAssignment(db, ADMIN, first.id, returnInput());
		const place = await placeId(db);
		await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place, { issuedOn: LATER }));
		// OTHER leaves the workspace.
		setDirectoryForTest(async () => [directoryPerson(ADMIN), directoryPerson(MEMBER)]);

		const res = await call(itemAssignmentsRoute.GET, 'GET', `/api/items/${itemId}/assignments`, {
			headers: as(ADMIN),
			params: { id: String(itemId) },
		});
		expect(res.status).toBe(200);
		expect(
			(res.body as AssignmentView[]).map((a) => [a.userId, a.userName, a.userMembership]),
		).toEqual([
			[MEMBER.id, MEMBER.name, 'member'],
			[OTHER.id, OTHER.name, 'former'],
		]);
		// The person's own page lists the same rows the same way.
		const page = await getMember(db, ADMIN, OTHER.id);
		expect(page.ledger.map((a) => a.userMembership)).toEqual(['former']);
	});

	it('calls nobody former when the directory cannot be read', async () => {
		const db = await freshDb();
		const { itemId } = await issueTo(db, 'PC-31', OTHER.id);
		setDirectoryForTest(async () => {
			throw new Error('network down');
		});
		const ledger = await listItemAssignments(db, ADMIN, itemId);
		expect(ledger.map((a) => a.userMembership)).toEqual(['unknown']);
	});
});

// The ledger and the home screen show the current holder of an item; the
// holder says whether they are still a member (`membership`, named like the
// `imageUrl` next to it), so both can put the same chip next to them.
describe('former members as the holder (ledger and home)', () => {
	it('marks the holder who is no longer in the directory', async () => {
		const db = await freshDb();
		const { itemId: kept } = await issueTo(db, 'PC-40', MEMBER.id);
		// Overdue, so the home screen lists it as needing action.
		const { itemId: left } = await issueTo(db, 'PC-41', OTHER.id, { dueOn: PAST_DUE });
		// OTHER leaves the workspace.
		setDirectoryForTest(async () => [directoryPerson(ADMIN), directoryPerson(MEMBER)]);

		const ledger = await listItems(db, ADMIN, parseItemQuery(new URLSearchParams()));
		const holders = new Map(ledger.rows.map((r) => [r.id, r.holder?.membership]));
		expect(holders.get(kept)).toBe('member');
		expect(holders.get(left)).toBe('former');
		const home = await getHome(db, ADMIN);
		expect(home.attention.rows.find((r) => r.id === left)?.holder?.membership).toBe('former');
		expect((await getItem(db, ADMIN, left)).holder?.membership).toBe('former');
	});

	it('calls nobody former when the directory cannot be read', async () => {
		const db = await freshDb();
		const { itemId } = await issueTo(db, 'PC-42', OTHER.id);
		setDirectoryForTest(async () => {
			throw new Error('network down');
		});
		const ledger = await listItems(db, ADMIN, parseItemQuery(new URLSearchParams()));
		expect(ledger.rows.find((r) => r.id === itemId)?.holder?.membership).toBe('unknown');
	});
});
