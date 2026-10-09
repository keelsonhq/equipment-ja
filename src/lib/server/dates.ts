import { appTimeZone } from './env.ts';

// Calendar dates are plain `YYYY-MM-DD` strings (issue / return / due dates are
// chosen by people, at day precision). Operation timestamps are ISO-8601 UTC.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in `YYYY-MM-DD` form. */
export function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !DATE_RE.test(value)) {
		return false;
	}
	const d = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * A date as typed in a spreadsheet: `YYYY-MM-DD` or `YYYY/M/D` (what
 * spreadsheet software in Japanese shows and saves). Returns `YYYY-MM-DD`, or
 * null when it is not a real calendar date.
 */
export function parseSheetDate(value: string): string | null {
	const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.trim());
	if (!m) {
		return null;
	}
	const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
	return isIsoDate(iso) ? iso : null;
}

/** Today's date in the app time zone (APP_TIME_ZONE, default Asia/Tokyo). */
export function today(now: Date = new Date(), timeZone: string = appTimeZone()): string {
	// en-CA formats as YYYY-MM-DD.
	return new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(now);
}

/** The calendar date `days` after `date` (negative: before). */
export function addDays(date: string, days: number): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

/** Current instant as an ISO-8601 UTC string. */
export function nowIso(): string {
	return new Date().toISOString();
}

/**
 * UTC instant at which a local calendar day starts in `timeZone`. Turns a
 * date-range filter (local dates) into bounds on an ISO-8601 UTC column.
 */
export function zonedDayStartIso(date: string, timeZone: string = appTimeZone()): string {
	const utcMidnight = new Date(`${date}T00:00:00Z`);
	// Offset of the zone at that instant: format the instant in the zone and
	// read it back as if it were UTC.
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(utcMidnight);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second'),
	);
	const offsetMs = asUtc - utcMidnight.getTime();
	return new Date(utcMidnight.getTime() - offsetMs).toISOString();
}
