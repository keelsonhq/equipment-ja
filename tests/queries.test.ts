import { describe, expect, it } from 'vite-plus/test';
import { parseEventQuery, parseItemQuery, parseMemberQuery } from '#lib/server/http/queries.ts';

// The list URL contract (DESIGN.md §2, §8.4): what each query key of the
// ledger, history and members lists means. A shared or stale URL must still
// open the list, so a bad value falls back to its default instead of failing.

const items = (qs: string) => parseItemQuery(new URLSearchParams(qs));
const events = (qs: string) => parseEventQuery(new URLSearchParams(qs));
const members = (qs: string) => parseMemberQuery(new URLSearchParams(qs));

describe('parseItemQuery (ledger, /api/items)', () => {
	it('defaults to every item by asset tag, 50 per page', () => {
		expect(items('')).toEqual({
			q: null,
			statuses: [],
			typeId: null,
			noType: false,
			held: false,
			placeId: null,
			memberId: null,
			ids: [],
			sort: 'tag',
			dir: 'asc',
			page: 1,
			size: 50,
		});
	});

	it.each([
		// search
		['q=%20laptop%20', { q: 'laptop' }],
		['q=%20%20', { q: null }],
		[`q=${'x'.repeat(150)}`, { q: 'x'.repeat(100) }],
		// status: known values only
		['status=overdue,suspended', { statuses: ['overdue', 'suspended'] }],
		['status=overdue,,bogus,%20assigned', { statuses: ['overdue', 'assigned'] }],
		// type: an id, or `none` for items without a type
		['type=3', { typeId: 3, noType: false }],
		['type=none', { typeId: null, noType: true }],
		['type=0', { typeId: null, noType: false }],
		['type=-1', { typeId: null, noType: false }],
		['type=1.5', { typeId: null, noType: false }],
		['type=abc', { typeId: null, noType: false }],
		// held (the return picker)
		['held=1', { held: true }],
		['held=true', { held: false }],
		// place
		['place=2', { placeId: 2 }],
		['place=x', { placeId: null }],
		// member (the "items of this person" link)
		['member=sample-sato', { memberId: 'sample-sato' }],
		['member=%20', { memberId: null }],
		// ids (CSV export of the selected rows): positive integers, in order
		['ids=3,1,2', { ids: [3, 1, 2] }],
		['ids=1,x,0,-2,2.5,4', { ids: [1, 4] }],
		// sort and direction
		['sort=holder&dir=desc', { sort: 'holder', dir: 'desc' }],
		['sort=bogus&dir=sideways', { sort: 'tag', dir: 'asc' }],
		// paging
		['page=3&size=100', { page: 3, size: 100 }],
		['page=0&size=75', { page: 1, size: 50 }],
		['page=2.5&size=200', { page: 1, size: 200 }],
	] as const)('%s', (qs, expected) => {
		expect(items(qs)).toMatchObject(expected);
	});

	it('keeps at most 1,000 ids', () => {
		const ids = Array.from({ length: 1200 }, (_, i) => i + 1);
		expect(items(`ids=${ids.join(',')}`).ids).toEqual(ids.slice(0, 1000));
	});
});

describe('parseEventQuery (history, /api/events)', () => {
	it('defaults to every event, 50 per page', () => {
		expect(events('')).toEqual({
			kinds: [],
			from: null,
			to: null,
			actorId: null,
			q: null,
			page: 1,
			size: 50,
		});
	});

	it.each([
		// kind: known values only
		['kind=issue', { kinds: ['issue'] }],
		['kind=issue,return,import', { kinds: ['issue', 'return', 'import'] }],
		['kind=issue,nope,', { kinds: ['issue'] }],
		// from / to: real YYYY-MM-DD dates only
		['from=2025-04-01&to=2025-04-30', { from: '2025-04-01', to: '2025-04-30' }],
		['from=2025/04/01&to=2025-02-30', { from: null, to: null }],
		// actor
		['actor=u-admin', { actorId: 'u-admin' }],
		['actor=', { actorId: null }],
		// search
		['q=%20PC-1%20', { q: 'PC-1' }],
		[`q=${'y'.repeat(150)}`, { q: 'y'.repeat(100) }],
		// paging
		['page=4&size=200', { page: 4, size: 200 }],
		['page=-1&size=10', { page: 1, size: 50 }],
	] as const)('%s', (qs, expected) => {
		expect(events(qs)).toMatchObject(expected);
	});
});

describe('parseMemberQuery (members, /api/members)', () => {
	it('defaults to everyone by name, 50 per page', () => {
		expect(members('')).toEqual({
			q: null,
			holdingOnly: false,
			sort: 'name',
			dir: 'asc',
			page: 1,
			size: 50,
		});
	});

	it.each([
		['q=%20sato%20', { q: 'sato' }],
		['holding=1', { holdingOnly: true }],
		['holding=0', { holdingOnly: false }],
		['sort=assigned&dir=desc', { sort: 'assigned', dir: 'desc' }],
		['sort=updated', { sort: 'updated', dir: 'asc' }],
		['sort=bogus&dir=up', { sort: 'name', dir: 'asc' }],
		['page=2&size=100', { page: 2, size: 100 }],
		['page=x&size=0', { page: 1, size: 50 }],
	] as const)('%s', (qs, expected) => {
		expect(members(qs)).toMatchObject(expected);
	});
});
