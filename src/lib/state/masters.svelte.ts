import type { MasterLists } from '#lib/server/domain/masters.ts';
import { getJson } from '#lib/api.ts';

// Item types and usage places, shared by filters and dialogs. Loaded once and
// refreshed after the masters screen changes them.
export const masters = $state<MasterLists & { loaded: boolean }>({
	types: [],
	places: [],
	loaded: false,
});

let pending: Promise<void> | null = null;

export function loadMasters(force = false): Promise<void> {
	if (pending && !force) {
		return pending;
	}
	pending = getJson<MasterLists>('/api/masters')
		.then((res) => {
			masters.types = res.types;
			masters.places = res.places;
			masters.loaded = true;
		})
		.catch(() => {
			pending = null;
		});
	return pending;
}
