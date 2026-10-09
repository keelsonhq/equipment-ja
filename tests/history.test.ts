import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { issueItem, returnAssignment } from '#lib/server/domain/assignments.ts';
import { type EventQuery, listEvents } from '#lib/server/domain/events.ts';
import { addDays, today } from '#lib/server/dates.ts';
import { ADMIN, cleanupDbs, freshDb, MEMBER } from './support/harness.ts';
import { addItem, issueInput, placeId, returnInput } from './support/helpers.ts';

// The history screen's filters: kind, period, who acted and the search box.
// Each one adds a condition with its own named values, so every filter (and a
// combination) runs here through the strict client.

afterEach(cleanupDbs);

const NO_FILTER: EventQuery = {
	kinds: [],
	from: null,
	to: null,
	actorId: null,
	q: null,
	page: 1,
	size: 50,
};

async function history(db: Client, filter: Partial<EventQuery>): Promise<string[]> {
	const res = await listEvents(db, ADMIN, { ...NO_FILTER, ...filter });
	return res.rows.map((e) => `${e.kind} ${e.itemTag}`);
}

describe('history filters', () => {
	it('narrows by kind, period, actor and search, alone and together', async () => {
		const db = await freshDb();
		const held = await addItem(db, 'PC-H1');
		await addItem(db, 'PC-H2');
		const a = await issueItem(db, ADMIN, issueInput(held, MEMBER.id, await placeId(db)));
		await returnAssignment(db, MEMBER, a.id, returnInput());

		expect(await history(db, {})).toEqual([
			'return PC-H1',
			'issue PC-H1',
			'create PC-H2',
			'create PC-H1',
		]);
		expect(await history(db, { kinds: ['issue', 'return'] })).toEqual([
			'return PC-H1',
			'issue PC-H1',
		]);
		expect(await history(db, { actorId: MEMBER.id })).toEqual(['return PC-H1']);
		expect(await history(db, { q: 'H2' })).toEqual(['create PC-H2']);
		// The person the event is about, or who acted.
		expect(await history(db, { q: MEMBER.name })).toEqual(['return PC-H1', 'issue PC-H1']);
		expect(await history(db, { from: today(), to: today() })).toHaveLength(4);
		expect(await history(db, { from: addDays(today(), 1) })).toEqual([]);
		expect(await history(db, { to: addDays(today(), -1) })).toEqual([]);
		expect(await history(db, { kinds: ['create'], q: 'H1', from: today() })).toEqual([
			'create PC-H1',
		]);
	});
});
