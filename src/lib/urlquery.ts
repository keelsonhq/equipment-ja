// The pure half of urlstate.ts: how a list screen's URL query changes, and how
// a list value is read from it. No SvelteKit imports, so the tests load it.

/** Anything with a path and a readable query (URL, or SvelteKit's page.url). */
export interface UrlLike {
	pathname: string;
	searchParams: { toString(): string };
}

/** Read access to a URL query (URLSearchParams, or SvelteKit's page.url.searchParams). */
export interface QueryLike {
	get(key: string): string | null;
}

/**
 * The same path with some query keys replaced (null or '' removes the key).
 * With `resetPage` (the default), a change that does not set `page` itself
 * drops it: a new filter, sort or page size starts again from page 1.
 */
export function queryHref(
	current: UrlLike,
	changes: Record<string, string | number | null>,
	{ resetPage = true }: { resetPage?: boolean } = {},
): string {
	const params = new URLSearchParams(current.searchParams.toString());
	for (const [key, value] of Object.entries(changes)) {
		if (value === null || value === '') {
			params.delete(key);
		} else {
			params.set(key, String(value));
		}
	}
	if (resetPage && !('page' in changes)) {
		params.delete('page');
	}
	const qs = params.toString();
	return `${current.pathname}${qs ? `?${qs}` : ''}`;
}

/** The values of a comma-separated query key (`kind=issue,return`). */
export function commaSeparatedParam(params: QueryLike, key: string): string[] {
	return (params.get(key) ?? '').split(',').filter((s) => s !== '');
}

/** Rows per page a list offers (the paging bar's choices); the first is the default. */
export const PAGE_SIZES = [50, 100, 200] as const;

/**
 * A list screen's sort and paging from its URL query: `sort` (or the screen's
 * default), `dir` (`asc` unless `desc`), `page` (1 unless a positive number)
 * and `size` (one of PAGE_SIZES, else the first). The server reads the same
 * query again and has the final say.
 */
export function listParams(
	params: QueryLike,
	defaults: { sort?: string } = {},
): { sort: string; dir: 'asc' | 'desc'; page: number; size: number } {
	const size = Number(params.get('size'));
	return {
		sort: params.get('sort') ?? defaults.sort ?? '',
		dir: params.get('dir') === 'desc' ? 'desc' : 'asc',
		page: Math.max(1, Number(params.get('page') ?? 1) || 1),
		size: (PAGE_SIZES as readonly number[]).includes(size) ? size : PAGE_SIZES[0],
	};
}
