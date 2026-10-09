// Display formatting (DESIGN.md §6, formats): YYYY-MM-DD dates, YYYY-MM-DD HH:mm
// times, thousands separators. No relative dates in the ledger.

const numberFormat = new Intl.NumberFormat('en-US');

export function formatCount(n: number): string {
	return numberFormat.format(n);
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** ISO instant -> local `YYYY-MM-DD HH:mm`. */
export function formatDateTime(iso: string | null | undefined): string {
	if (!iso) {
		return '';
	}
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return '';
	}
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Whole days from `from` to `to` (YYYY-MM-DD), never negative. */
export function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (Number.isNaN(a) || Number.isNaN(b)) {
		return 0;
	}
	return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Byte size for the attachment list. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A leading bracketed label such as "(...)" used by sample names. The
// fullwidth brackets are built from their code points: no CJK in code, and a
// `\u` escape can be turned into the character itself by tools that rewrite
// the file.
const OPENING = String.fromCodePoint(0xff08, 0x3010);
const CLOSING = String.fromCodePoint(0xff09, 0x3011);
const LEADING_LABEL = new RegExp(String.raw`^\s*[([${OPENING}].*?[)\]${CLOSING}]\s*`, 'u');

/** First character of a display name, for the initial avatar. */
export function initialOf(name: string): string {
	const trimmed = name.replace(LEADING_LABEL, '').trim() || name.trim();
	return Array.from(trimmed)[0] ?? '?';
}

/**
 * `src` of a profile image shown `px` wide (DESIGN.md §8.10): the directory URL
 * with `width` / `height` set to twice the displayed size, so the image stays
 * crisp on high-density screens. Null when the value is not an http(s) URL,
 * in which case the avatar shows the initial instead.
 */
export function avatarSrc(imageUrl: string, px: number): string | null {
	let url: URL;
	try {
		url = new URL(imageUrl);
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		return null;
	}
	url.searchParams.set('width', String(px * 2));
	url.searchParams.set('height', String(px * 2));
	return url.toString();
}
