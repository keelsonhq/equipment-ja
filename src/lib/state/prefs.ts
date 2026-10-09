// Per-browser display preferences (row density, visible columns). Stored in
// localStorage; every access is guarded so a blocked storage never breaks the
// page.

// Key prefix: the app's slug (keelson.yaml `slug`). Apps served from the same
// origin (local previews on localhost) share one localStorage, so each keeps
// its own keys. Changing it loses the preferences browsers have saved so far.
const PREFIX = 'equipment:';

export function readPref<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(`${PREFIX}${key}`);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

export function writePref(key: string, value: unknown): void {
	try {
		localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value));
	} catch {
		// Storage unavailable: the preference lasts for this page view only.
	}
}
