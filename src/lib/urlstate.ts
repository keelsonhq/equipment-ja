import { goto } from '$app/navigation';
import { queryHref, type UrlLike } from './urlquery.ts';

// List screens keep their filters, sort and page in the URL query, so a
// filtered list can be bookmarked and shared (DESIGN.md §2, §8.4). Building the
// new URL lives in urlquery.ts (pure, unit-tested); this adds the navigation.

export { commaSeparatedParam, listParams } from './urlquery.ts';

/** Navigate to the same path with some query keys replaced (null removes). */
export function updateQuery(
	current: UrlLike,
	changes: Record<string, string | number | null>,
	opts: { resetPage?: boolean } = {},
): Promise<void> {
	// Replace the history entry and keep scroll position and focus (the search
	// box keeps focus while typing).
	return goto(queryHref(current, changes, opts), { replace: true, reset: false });
}
