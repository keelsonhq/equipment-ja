import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	correctAssignment,
	issueItem,
	listItemAssignments,
	returnAssignment,
} from '#lib/server/domain/assignments.ts';
import { listItemEvents } from '#lib/server/domain/events.ts';
import { findItem, resumeItem, suspendItem } from '#lib/server/domain/items.ts';
import { updateMaster } from '#lib/server/domain/masters.ts';
import { getMe, getMember } from '#lib/server/domain/people.ts';
import { addDays } from '#lib/server/dates.ts';
import {
	ADMIN,
	cleanupDbs,
	expectError,
	freshDb,
	invalid,
	MEMBER,
	OTHER,
} from './support/harness.ts';
import {
	addItem,
	BEFORE_PAST,
	FUTURE,
	issueInput,
	LATER,
	PAST,
	placeId,
	returnInput,
} from './support/helpers.ts';

afterEach(cleanupDbs);

const FORBIDDEN = { status: 403, code: 'forbidden_manage_required' } as const;
const ALREADY_ASSIGNED = { status: 409, code: 'item_already_assigned' } as const;
const SUSPENDED = { status: 409, code: 'item_suspended' } as const;

describe('issue', () => {
	it('issues an item to a member and logs the event', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-1');
		const place = await placeId(db);

		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place));
		expect(a.userId).toBe(MEMBER.id);
		expect(a.userName).toBe(MEMBER.name); // snapshot from the directory
		expect(a.returnedOn).toBeNull();

		const item = await findItem(db, itemId);
		expect(item?.status).toBe('assigned');
		expect(item?.holder?.userId).toBe(MEMBER.id);

		const kinds = (await listItemEvents(db, ADMIN, itemId)).map((e) => e.kind);
		expect(kinds).toEqual(['issue', 'create']);
	});

	it('lets a member assign an available item to themselves', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'MS-1');
		const a = await issueItem(db, MEMBER, issueInput(itemId, null, await placeId(db)));
		expect(a.userId).toBe(MEMBER.id);
		expect(a.issuedByName).toBe(MEMBER.name);
	});

	it('refuses a member issuing to someone else (forbidden_manage_required)', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'MS-2');
		await expectError(
			issueItem(db, MEMBER, issueInput(itemId, OTHER.id, await placeId(db))),
			FORBIDDEN,
		);
	});

	it('refuses a person outside the directory (field userId: not_found)', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'MS-3');
		await expectError(
			issueItem(db, ADMIN, issueInput(itemId, 'u-stranger', await placeId(db))),
			invalid({
				userId: 'not_found',
			}),
		);
	});

	it('reports a deactivated usage place on its field (issue and correction)', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-P1');
		const [open, closed] = [await placeId(db), await placeId(db, 2)];
		await updateMaster(db, ADMIN, 'places', closed, { active: false });
		await expectError(
			issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, closed)),
			invalid({
				placeId: 'not_found',
			}),
		);
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, open));
		const correction = { issuedOn: PAST, returnedOn: null, reason: 'x', version: a.version };
		await expectError(
			correctAssignment(db, ADMIN, a.id, { ...correction, placeId: closed }),
			invalid({
				placeId: 'not_found',
			}),
		);
	});

	it('rejects future issue dates and due dates before the issue date', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'MS-4');
		const place = await placeId(db);
		await expectError(
			issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place, { issuedOn: FUTURE })),
			invalid({ issuedOn: 'future' }),
		);
		await expectError(
			issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place, { dueOn: BEFORE_PAST })),
			invalid({ dueOn: 'before_issued' }),
		);
	});
});

describe('double assignment', () => {
	it('rejects issuing an item that is already held', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-2');
		const place = await placeId(db);
		await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place));
		await expectError(issueItem(db, ADMIN, issueInput(itemId, OTHER.id, place)), ALREADY_ASSIGNED);
		await expectError(issueItem(db, OTHER, issueInput(itemId, null, place)), ALREADY_ASSIGNED);
	});

	it('lets exactly one of two simultaneous issues win', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-3');
		const place = await placeId(db);
		const results = await Promise.allSettled([
			issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place)),
			issueItem(db, ADMIN, issueInput(itemId, OTHER.id, place)),
			issueItem(db, OTHER, issueInput(itemId, null, place)),
		]);
		const won = results.filter((r) => r.status === 'fulfilled');
		const lost = results.filter((r) => r.status === 'rejected');
		expect(won).toHaveLength(1);
		expect(lost).toHaveLength(2);
		for (const r of lost) {
			await expectError(Promise.reject((r as PromiseRejectedResult).reason), ALREADY_ASSIGNED);
		}
		const open = (await listItemAssignments(db, ADMIN, itemId)).filter((a) => !a.returnedOn);
		expect(open).toHaveLength(1);
		// Exactly one issue event: losers log nothing.
		const issues = (await listItemEvents(db, ADMIN, itemId)).filter((e) => e.kind === 'issue');
		expect(issues).toHaveLength(1);
	});

	it('enforces one open assignment per item at the database level', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-4');
		const place = await placeId(db);
		await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place));
		// Bypass the business layer: the partial unique index still refuses.
		await expect(
			db.execute({
				sql: `INSERT INTO assignments (id, item_id, user_id, user_name, issued_on, issued_by_id,
					issued_by_name, created_at, updated_at) VALUES ('x', ?, 'u', 'u', ?, 'a', 'a', 't', 't')`,
				args: [itemId, PAST],
			}),
		).rejects.toThrow(/UNIQUE/);
	});
});

describe('suspension', () => {
	it('refuses to issue a suspended item and allows it again after resuming', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-5');
		const place = await placeId(db);
		await suspendItem(db, ADMIN, itemId, 'repair', null);
		await expectError(issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place)), SUSPENDED);
		await expectError(issueItem(db, MEMBER, issueInput(itemId, null, place)), SUSPENDED);
		await resumeItem(db, ADMIN, itemId);
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place));
		expect(a.itemId).toBe(itemId);
	});

	it('keeps an existing assignment when the item is suspended, and it can be returned', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'SC-1');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		await suspendItem(db, ADMIN, itemId, 'lost', 'reported');
		const held = await findItem(db, itemId);
		expect(held?.status).toBe('suspended');
		expect(held?.holder?.userId).toBe(MEMBER.id);

		const returned = await returnAssignment(db, MEMBER, a.id, returnInput());
		expect(returned.returnedOn).toBe(LATER);
		expect((await findItem(db, itemId))?.suspendedReason).toBe('lost');
	});

	it('is admin-only', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-6');
		await expectError(suspendItem(db, MEMBER, itemId, 'broken', null), FORBIDDEN);
	});
});

describe('return', () => {
	it('records the holder returning their own item', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-7');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		const r = await returnAssignment(db, MEMBER, a.id, returnInput({ note: 'done' }));
		expect(r.returnedOn).toBe(LATER);
		expect(r.returnKind).toBe('returned');
		expect((await findItem(db, itemId))?.status).toBe('unassigned');
		const kinds = (await listItemEvents(db, ADMIN, itemId)).map((e) => e.kind);
		expect(kinds).toEqual(['return', 'issue', 'create']);
	});

	it("refuses a member returning someone else's item (assignment_not_owned)", async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-8');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		await expectError(returnAssignment(db, OTHER, a.id, returnInput()), {
			status: 403,
			code: 'assignment_not_owned',
		});
		expect((await findItem(db, itemId))?.status).toBe('assigned');
	});

	it('records an admin return for someone else as a collection', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-9');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		const r = await returnAssignment(
			db,
			ADMIN,
			a.id,
			returnInput({
				storageLocation: 'Repair shelf',
				suspend: { reason: 'repair', note: 'cracked hinge' },
			}),
		);
		expect(r.returnKind).toBe('collected');
		const item = await findItem(db, itemId);
		expect(item?.storageLocation).toBe('Repair shelf');
		expect(item?.suspendedReason).toBe('repair');
		const kinds = (await listItemEvents(db, ADMIN, itemId)).map((e) => e.kind);
		expect(kinds.slice(0, 2).sort()).toEqual(['return', 'suspend']);
	});

	it('suspends on return only when that return is the one recorded', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-9B');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		const [plain, suspending] = await Promise.allSettled([
			returnAssignment(db, ADMIN, a.id, returnInput()),
			returnAssignment(db, ADMIN, a.id, returnInput({ suspend: { reason: 'broken', note: null } })),
		]);
		expect([plain.status, suspending.status].sort()).toEqual(['fulfilled', 'rejected']);
		const suspended = suspending.status === 'fulfilled';
		expect((await findItem(db, itemId))?.suspendedReason).toBe(suspended ? 'broken' : null);
		const kinds = (await listItemEvents(db, ADMIN, itemId)).map((e) => e.kind);
		expect(kinds.filter((k) => k === 'return')).toHaveLength(1);
		expect(kinds.filter((k) => k === 'suspend')).toHaveLength(suspended ? 1 : 0);
	});

	it('refuses members setting the storage location or suspending on return', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-10');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		await expectError(
			returnAssignment(db, MEMBER, a.id, returnInput({ storageLocation: 'Desk' })),
			FORBIDDEN,
		);
	});

	it('refuses a second return and dates before the issue date', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-11');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		await expectError(
			returnAssignment(db, MEMBER, a.id, returnInput({ returnedOn: BEFORE_PAST })),
			invalid({ returnedOn: 'before_issued' }),
		);
		await returnAssignment(db, MEMBER, a.id, returnInput());
		await expectError(returnAssignment(db, MEMBER, a.id, returnInput()), {
			status: 409,
			code: 'assignment_already_returned',
		});
	});
});

describe('exchange', () => {
	it('keeps the old item as pending return until it is actually returned', async () => {
		const db = await freshDb();
		const oldId = await addItem(db, 'PC-OLD');
		const newId = await addItem(db, 'PC-NEW');
		const place = await placeId(db);
		const old = await issueItem(db, ADMIN, issueInput(oldId, MEMBER.id, place));
		const fresh = await issueItem(
			db,
			ADMIN,
			issueInput(newId, MEMBER.id, place, { issuedOn: LATER, exchangeFrom: old.id }),
		);

		const page = await getMember(db, ADMIN, MEMBER.id);
		const statuses = Object.fromEntries(page.holdings.map((h) => [h.assetTag, h.status]));
		expect(statuses).toEqual({ 'PC-OLD': 'pending_return', 'PC-NEW': 'assigned' });
		expect((await findItem(db, oldId))?.status).toBe('pending_return');

		await returnAssignment(db, MEMBER, old.id, returnInput());
		const after = await getMe(db, MEMBER);
		expect(after.holdings.map((h) => h.assetTag)).toEqual(['PC-NEW']);
		expect(after.ledger.find((a) => a.id === old.id)?.replacedBy).toBe(fresh.id);
	});

	it('rolls back entirely when the new item cannot be issued', async () => {
		const db = await freshDb();
		const oldId = await addItem(db, 'PC-A');
		const busyId = await addItem(db, 'PC-B');
		const place = await placeId(db);
		const old = await issueItem(db, ADMIN, issueInput(oldId, MEMBER.id, place));
		await issueItem(db, ADMIN, issueInput(busyId, OTHER.id, place));
		await expectError(
			issueItem(db, ADMIN, issueInput(busyId, MEMBER.id, place, { exchangeFrom: old.id })),
			ALREADY_ASSIGNED,
		);
		expect((await findItem(db, oldId))?.status).toBe('assigned');
	});

	it('requires the exchange source to be held by the same person', async () => {
		const db = await freshDb();
		const a = await addItem(db, 'PC-C');
		const b = await addItem(db, 'PC-D');
		const place = await placeId(db);
		const other = await issueItem(db, ADMIN, issueInput(a, OTHER.id, place));
		await expectError(
			issueItem(db, ADMIN, issueInput(b, MEMBER.id, place, { exchangeFrom: other.id })),
			invalid({ exchangeFrom: 'invalid' }),
		);
	});
});

describe('correction', () => {
	it('corrects dates with a reason and keeps the previous values in history', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-12');
		const a = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, await placeId(db)));
		const c = await correctAssignment(db, ADMIN, a.id, {
			issuedOn: BEFORE_PAST,
			returnedOn: null,
			placeId: await placeId(db, 2),
			reason: 'typo',
			version: a.version,
		});
		expect(c.issuedOn).toBe(BEFORE_PAST);
		const event = (await listItemEvents(db, ADMIN, itemId))[0];
		expect(event.kind).toBe('correct');
		expect(event.detail?.reason).toBe('typo');
		expect((event.detail?.changes as Record<string, unknown> | undefined)?.issuedOn).toEqual([
			PAST,
			BEFORE_PAST,
		]);
	});

	it('refuses overlapping periods, stale versions and non-admins', async () => {
		const db = await freshDb();
		const itemId = await addItem(db, 'PC-13');
		const place = await placeId(db);
		// MEMBER held it from PAST to LATER, OTHER holds it since LATER.
		const first = await issueItem(db, ADMIN, issueInput(itemId, MEMBER.id, place));
		await returnAssignment(db, MEMBER, first.id, returnInput());
		const second = await issueItem(
			db,
			ADMIN,
			issueInput(itemId, OTHER.id, place, { issuedOn: LATER }),
		);
		const correction = (issuedOn: string, version = second.version) => ({
			issuedOn,
			returnedOn: null,
			placeId: place,
			reason: 'x',
			version,
		});
		const duringFirst = addDays(LATER, -1);
		const afterFirst = addDays(LATER, 1);
		await expectError(correctAssignment(db, ADMIN, second.id, correction(duringFirst)), {
			status: 409,
			code: 'assignment_period_overlap',
		});
		await expectError(
			correctAssignment(db, ADMIN, second.id, correction(afterFirst, second.version + 5)),
			{ status: 409, code: 'assignment_version_conflict' },
		);
		await expectError(correctAssignment(db, MEMBER, second.id, correction(afterFirst)), FORBIDDEN);
	});
});
