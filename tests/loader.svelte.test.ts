import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { ApiError } from '#lib/api.ts';
import { type Loaded, loader, type LoaderOptions } from '#lib/state/loader.svelte.ts';

// How a screen's data follows its URL (src/lib/state/loader.svelte.ts): one
// request per URL, and only the newest request may change what is shown. The
// fetch here answers by hand, so a test decides which request finishes first.

interface Request {
	url: string;
	resolve: (value: string) => void;
	reject: (err: unknown) => void;
}

let requests: Request[] = [];
const stops: (() => void)[] = [];

afterEach(() => {
	for (const stop of stops.splice(0)) {
		stop();
	}
	requests = [];
});

function fetchByHand(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		requests.push({ url, resolve, reject });
	});
}

/** The request for `url` (the latest one, if it was made more than once). */
function request(url: string): Request {
	const found = requests.findLast((r) => r.url === url);
	if (!found) {
		throw new Error(`no request for ${url}`);
	}
	return found;
}

/** Let the loader see answered requests (their `await` continues). */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve));
}

/** A loader as a screen holds one; its first request is made on return. */
function start(
	url: () => string | null,
	opts: Omit<LoaderOptions<string>, 'fetch'> = {},
): Loaded<string> {
	let loaded: Loaded<string> | undefined;
	stops.push(
		$effect.root(() => {
			loaded = loader(url, { ...opts, fetch: fetchByHand });
		}),
	);
	flushSync();
	if (!loaded) {
		throw new Error('loader not created');
	}
	return loaded;
}

describe('loader', () => {
	it('reads the URL, and again when the state it reads changes', async () => {
		let url = $state('/api/items?page=1');
		const items = start(() => url, { keepPreviousData: true });
		expect(requests.map((r) => r.url)).toEqual(['/api/items?page=1']);
		expect(items.loading).toBe(true);

		request('/api/items?page=1').resolve('page 1');
		await settle();
		expect(items.data).toBe('page 1');
		expect(items.loading).toBe(false);

		url = '/api/items?page=2';
		flushSync();
		expect(requests.map((r) => r.url)).toEqual(['/api/items?page=1', '/api/items?page=2']);
		// `keepPreviousData`: the old page stays on screen while the next one loads.
		expect(items.data).toBe('page 1');
		expect(items.loading).toBe(true);

		request('/api/items?page=2').resolve('page 2');
		await settle();
		expect(items.data).toBe('page 2');
	});

	it('keeps the newer answer when an older request finishes after it', async () => {
		let url = $state('/api/items?q=a');
		const items = start(() => url, { keepPreviousData: true });
		url = '/api/items?q=ab';
		flushSync();

		request('/api/items?q=ab').resolve('rows for ab');
		await settle();
		expect(items.data).toBe('rows for ab');
		expect(items.loading).toBe(false);

		request('/api/items?q=a').resolve('rows for a');
		await settle();
		expect(items.data).toBe('rows for ab');
		expect(items.loading).toBe(false);
	});

	it('ignores an older request that fails, before or after the newer one answers', async () => {
		let url = $state('/api/members?page=1');
		const members = start(() => url, { keepPreviousData: true });
		url = '/api/members?page=2';
		flushSync();
		url = '/api/members?page=3';
		flushSync();

		request('/api/members?page=1').reject(new ApiError(500, 'internal_error'));
		await settle();
		expect(members.error).toBeNull();
		expect(members.loading).toBe(true);

		request('/api/members?page=3').resolve('page 3');
		await settle();
		request('/api/members?page=2').reject(new ApiError(500, 'internal_error'));
		await settle();
		expect(members.data).toBe('page 3');
		expect(members.error).toBeNull();
		expect(members.loading).toBe(false);
	});

	it('shows the error of the newest request and keeps the data it had', async () => {
		const events = start(() => '/api/events');
		request('/api/events').resolve('first page');
		await settle();

		const retry = events.reload();
		request('/api/events').reject(new ApiError(403, 'forbidden_manage_required'));
		await retry;
		expect(events.error).toBe('forbidden_manage_required');
		expect(events.data).toBe('first page');

		const again = events.reload();
		request('/api/events').resolve('second page');
		await again;
		expect(events.error).toBeNull();
		expect(events.data).toBe('second page');
	});

	it('reports a failed connection as network_error', async () => {
		const home = start(() => '/api/home');
		request('/api/home').reject(new TypeError('fetch failed'));
		await settle();
		expect(home.error).toBe('network_error');
	});

	it('starts another record from null unless `keepPreviousData` is set', async () => {
		let id = $state(1);
		const item = start(() => `/api/items/${id}`);
		request('/api/items/1').resolve('item 1');
		await settle();

		// The same URL again (after a save): the record stays on screen.
		void item.reload();
		expect(item.data).toBe('item 1');
		request('/api/items/1').resolve('item 1, saved');
		await settle();

		id = 2;
		flushSync();
		expect(item.data).toBeNull();
		expect(item.loading).toBe(true);
		request('/api/items/2').resolve('item 2');
		await settle();
		expect(item.data).toBe('item 2');
	});

	it('reads nothing while the URL is null', async () => {
		let admin = $state(false);
		const home = start(() => (admin ? '/api/home' : null));
		expect(requests).toEqual([]);
		expect(home.loading).toBe(false);
		expect(home.data).toBeNull();

		admin = true;
		flushSync();
		request('/api/home').resolve('stock');
		await settle();
		expect(home.data).toBe('stock');
	});

	it('drops an answer that arrives after the URL became null', async () => {
		let file = $state<string | null>('/api/preview?f=1');
		const preview = start(() => file);
		file = null;
		flushSync();
		request('/api/preview?f=1').resolve('preview');
		await settle();
		expect(preview.data).toBeNull();
		expect(preview.loading).toBe(false);
	});
});
