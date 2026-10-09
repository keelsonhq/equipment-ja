import { untrack } from 'svelte';
import { errorCode, getJson } from '#lib/api.ts';

/** What a screen reads from the API: the latest response, or why it failed. */
export interface Loaded<T> {
	/** The last response (null until one arrives). */
	readonly data: T | null;
	/** A request is on its way. */
	readonly loading: boolean;
	/** Error code of the last failure; cleared by the next success. */
	readonly error: string | null;
	/** Read the current URL again (after a change, or from a retry button). */
	reload(): Promise<void>;
}

export interface LoaderOptions<T> {
	/** How to read the URL (default: GET it as JSON). */
	fetch?: (url: string) => Promise<T>;
	/**
	 * Keep the previous data on screen while a new URL loads: a list keeps its
	 * rows when the filter or the page changes. Without it, a new URL starts
	 * from null, so another record's page shows "loading" instead of the
	 * previous record. A `reload()` of the same URL keeps the data either way.
	 */
	keepPreviousData?: boolean;
}

/**
 * Read `url()` from the API now and again whenever the state it reads changes
 * (the page URL, an id). A response that arrives after a newer request was
 * started is dropped, so a slow earlier answer never replaces a newer one.
 * `url()` returning null means "nothing to read" (data and error go back to
 * null). Create it while a component initializes (it uses `$effect`).
 */
export function loader<T>(url: () => string | null, opts: LoaderOptions<T> = {}): Loaded<T> {
	const fetch = opts.fetch ?? ((target: string) => getJson<T>(target));
	let data = $state<T | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	// Only the latest request may write; each new one takes the next number.
	let seq = 0;
	let requested: string | null = null;

	async function run(target: string | null): Promise<void> {
		const mine = ++seq;
		const changed = target !== requested;
		requested = target;
		if (target === null) {
			data = null;
			error = null;
			loading = false;
			return;
		}
		if (changed && !opts.keepPreviousData) {
			data = null;
		}
		loading = true;
		try {
			const res = await fetch(target);
			if (mine === seq) {
				data = res;
				error = null;
			}
		} catch (err) {
			if (mine === seq) {
				error = errorCode(err);
			}
		} finally {
			if (mine === seq) {
				loading = false;
			}
		}
	}

	$effect(() => {
		const target = url();
		// Only what url() reads decides when to load again.
		untrack(() => void run(target));
	});

	return {
		get data() {
			return data;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
		reload: () => run(untrack(url)),
	};
}
