import { describe, expect, it } from 'vite-plus/test';
import { commaSeparatedParam, listParams, PAGE_SIZES, queryHref } from '#lib/urlquery.ts';

// How the list screens change their URL query (src/lib/urlquery.ts, used by
// updateQuery in urlstate.ts): the browser side of the list URL contract.

const at = (href: string) => new URL(href, 'http://app.test');

describe('queryHref', () => {
	it.each([
		[
			'sets a new key after the existing ones',
			'/items?q=pc',
			{ status: 'overdue' },
			'/items?q=pc&status=overdue',
		],
		['replaces a key in place', '/items?q=pc&sort=name', { q: 'dock' }, '/items?q=dock&sort=name'],
		['removes a key on null', '/items?q=pc&type=3', { type: null }, '/items?q=pc'],
		['removes a key on an empty string', '/items?q=pc&type=3', { q: '' }, '/items?type=3'],
		['drops the query when nothing is left', '/items?q=pc', { q: null }, '/items'],
		['writes numbers as text', '/items', { size: 100 }, '/items?size=100'],
		[
			'starts again from page 1 on a new filter',
			'/items?q=pc&page=3',
			{ q: 'dock' },
			'/items?q=dock',
		],
		[
			'starts again from page 1 on a new page size',
			'/history?page=2',
			{ size: 200 },
			'/history?size=200',
		],
		[
			'keeps a page the change sets itself',
			'/items?q=pc&page=3',
			{ page: 4 },
			'/items?q=pc&page=4',
		],
		[
			'sets sort and direction together',
			'/members?holding=1',
			{ sort: 'assigned', dir: 'desc' },
			'/members?holding=1&sort=assigned&dir=desc',
		],
	] as const)('%s', (_label, from, changes, expected) => {
		expect(queryHref(at(from), changes)).toBe(expected);
	});

	it('keeps the page when resetPage is false (the paging buttons)', () => {
		expect(queryHref(at('/items?q=pc&page=2'), { size: 100 }, { resetPage: false })).toBe(
			'/items?q=pc&page=2&size=100',
		);
	});

	it('resets the page when the options leave resetPage out', () => {
		expect(queryHref(at('/items?q=pc&page=2'), { q: 'dock' }, {})).toBe('/items?q=dock');
	});

	it('round-trips list values and spaces through the query', () => {
		const href = queryHref(at('/history'), { kind: 'issue,return', q: 'PC 1' });
		const params = at(href).searchParams;
		expect(params.get('q')).toBe('PC 1');
		expect(commaSeparatedParam(params, 'kind')).toEqual(['issue', 'return']);
	});

	it('does not change the URL it was given', () => {
		const url = at('/items?q=pc&page=3');
		queryHref(url, { q: null });
		expect(url.search).toBe('?q=pc&page=3');
	});
});

describe('commaSeparatedParam', () => {
	it.each([
		['', []],
		['status=overdue', ['overdue']],
		['status=overdue,suspended', ['overdue', 'suspended']],
		['status=overdue,,suspended,', ['overdue', 'suspended']],
		['status=', []],
	] as const)('%s', (qs, expected) => {
		expect(commaSeparatedParam(new URLSearchParams(qs), 'status')).toEqual(expected);
	});
});

describe('listParams', () => {
	it.each([
		['an empty query', '', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		[
			'every key set',
			'sort=name&dir=desc&page=3&size=200',
			{ sort: 'name', dir: 'desc', page: 3, size: 200 },
		],
		['a direction other than desc', 'dir=down', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['page 0', 'page=0', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a negative page', 'page=-2', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a page that is not a number', 'page=two', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a size the bar does not offer', 'size=75', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		['a size of 100', 'size=100', { sort: 'tag', dir: 'asc', page: 1, size: 100 }],
		['a size that is not a number', 'size=all', { sort: 'tag', dir: 'asc', page: 1, size: 50 }],
		// The server checks the sort key against its own list.
		['an unknown sort key', 'sort=color', { sort: 'color', dir: 'asc', page: 1, size: 50 }],
	] as const)('%s', (_label, qs, expected) => {
		expect(listParams(new URLSearchParams(qs), { sort: 'tag' })).toEqual(expected);
	});

	it('reads an empty sort when the screen has none (history, my page)', () => {
		expect(listParams(new URLSearchParams('page=2'))).toEqual({
			sort: '',
			dir: 'asc',
			page: 2,
			size: 50,
		});
	});

	it('defaults to the first page size the bar offers', () => {
		expect(listParams(new URLSearchParams('')).size).toBe(PAGE_SIZES[0]);
	});
});
