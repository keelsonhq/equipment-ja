import { isIsoDate } from '#lib/server/dates.ts';
import { EVENT_KINDS, type EventKind, type EventQuery } from '#lib/server/domain/events.ts';
import {
	type AvailableItemQuery,
	ITEM_SORTS,
	ITEM_STATUSES,
	type ItemQuery,
	type ItemSort,
	type ItemStatus,
} from '#lib/server/domain/items.ts';
import { MEMBER_SORTS, type MemberQuery, type MemberSort } from '#lib/server/domain/people.ts';
import type { ImportMode, ImportOptions } from '#lib/server/import/importer.ts';
import { IMPORT_FILE_NAME_MAX, ITEM_IDS_MAX, SEARCH_MAX } from '#lib/limits.ts';
import { readDir, readList, readPaging } from './validate.ts';

// Query-string parsers: the list endpoints and the CSV import's options.
// Unknown or malformed values fall back to defaults (a stale shared URL should
// still open the list), so these never throw.

function positiveInt(value: string | null): number | null {
	const n = Number(value);
	return value !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function text(value: string | null, max = SEARCH_MAX): string | null {
	const trimmed = value?.trim() ?? '';
	return trimmed === '' ? null : trimmed.slice(0, max);
}

export function parseItemQuery(params: URLSearchParams): ItemQuery {
	const sort = params.get('sort');
	return {
		q: text(params.get('q')),
		statuses: readList(params, 'status').filter((s): s is ItemStatus =>
			(ITEM_STATUSES as readonly string[]).includes(s),
		),
		typeId: positiveInt(params.get('type')),
		noType: params.get('type') === 'none',
		held: params.get('held') === '1',
		placeId: positiveInt(params.get('place')),
		memberId: text(params.get('member')),
		ids: readList(params, 'ids')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0)
			.slice(0, ITEM_IDS_MAX),
		sort: (ITEM_SORTS as readonly string[]).includes(sort ?? '') ? (sort as ItemSort) : 'tag',
		dir: readDir(params, 'asc'),
		...readPaging(params),
	};
}

export function parseMemberQuery(params: URLSearchParams): MemberQuery {
	const sort = params.get('sort');
	return {
		q: text(params.get('q')),
		holdingOnly: params.get('holding') === '1',
		sort: (MEMBER_SORTS as readonly string[]).includes(sort ?? '') ? (sort as MemberSort) : 'name',
		dir: readDir(params, 'asc'),
		...readPaging(params),
	};
}

export function parseEventQuery(params: URLSearchParams): EventQuery {
	const from = params.get('from');
	const to = params.get('to');
	return {
		kinds: readList(params, 'kind').filter((k): k is EventKind =>
			(EVENT_KINDS as readonly string[]).includes(k),
		),
		from: isIsoDate(from) ? from : null,
		to: isIsoDate(to) ? to : null,
		actorId: text(params.get('actor')),
		q: text(params.get('q')),
		...readPaging(params),
	};
}

/** GET /api/available-items: the items free to take (any signed-in user). */
export function parseAvailableQuery(params: URLSearchParams): AvailableItemQuery {
	return {
		q: text(params.get('q')),
		typeId: positiveInt(params.get('type')),
		...readPaging(params),
	};
}

/** The CSV import's options (preview and import; both default on). */
export function parseImportOptions(params: URLSearchParams): ImportOptions {
	return {
		autoAddMasters: params.get('autoAddMasters') !== '0',
		unassignUnknown: params.get('unassignUnknown') !== '0',
	};
}

/**
 * The import run: `mode=skip_errors` leaves the `error` rows out (anything
 * else is `all`), and `name` is the file name the history keeps.
 */
export function parseImportRun(params: URLSearchParams): {
	mode: ImportMode;
	fileName: string | null;
} {
	return {
		mode: params.get('mode') === 'skip_errors' ? 'skip_errors' : 'all',
		fileName: text(params.get('name'), IMPORT_FILE_NAME_MAX),
	};
}
