import type { Client, InStatement, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { addDays, nowIso, zonedDayStartIso } from '#lib/server/dates.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { type NamedArgs, namedList, namedStatement } from '#lib/server/db/named.ts';
import { numOrNull, str, strOrNull } from '#lib/server/db/rows.ts';
import { likePattern } from '#lib/server/db/like.ts';

// Operation history. Every operation on items and assignments (register, edit,
// suspend, resume, issue, return, correct) writes its events in the same
// atomic batch as the change itself. A CSV import writes each row's events
// with the row (100 rows per batch) and one `import` event after the last
// batch. Changes to the masters and the attachments keep no history.

export const EVENT_KINDS = [
	'create',
	'edit',
	'issue',
	'return',
	'suspend',
	'resume',
	'correct',
	'import',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * The item a statement writes about: by id, or by asset tag for an item
 * inserted earlier in the same batch (its id is not known yet).
 */
export type ItemTarget = { id: number } | { assetTag: string };

export interface EventInput {
	kind: EventKind;
	item: ItemTarget | null;
	assignmentId?: string | null;
	subject?: { id: string; name: string } | null;
	actor: Pick<Actor, 'id' | 'name' | 'source'>;
	detail?: Record<string, unknown> | null;
	/** Defaults to now; the sample-data loader passes historical times. */
	at?: string;
}

// The item id / tag / name snapshot columns: the item's own values when it is
// given by id, looked up by its unique tag otherwise.
function itemColumnsSql(item: ItemTarget | null): string {
	if (item === null) {
		return 'NULL, NULL, NULL';
	}
	if ('id' in item) {
		return `:itemId, (SELECT asset_tag FROM items WHERE id = :itemId),
			(SELECT name FROM items WHERE id = :itemId)`;
	}
	return `(SELECT id FROM items WHERE asset_tag = :assetTag), :assetTag,
		(SELECT name FROM items WHERE asset_tag = :assetTag)`;
}

function eventInsert(input: EventInput, condition: string): InStatement {
	const item = input.item;
	const detail = input.actor.source
		? { ...input.detail, source: input.actor.source }
		: (input.detail ?? null);
	return namedStatement(
		`INSERT INTO events (id, at, kind, item_id, item_tag, item_name, assignment_id,
				subject_user_id, subject_user_name, actor_id, actor_name, detail)
			SELECT :id, :at, :kind, ${itemColumnsSql(item)}, :assignmentId, :subjectId,
				:subjectName, :actorId, :actorName, :detail
			${condition}`,
		{
			id: crypto.randomUUID(),
			at: input.at ?? nowIso(),
			kind: input.kind,
			itemId: item && 'id' in item ? item.id : null,
			assetTag: item && 'assetTag' in item ? item.assetTag : null,
			assignmentId: input.assignmentId ?? null,
			subjectId: input.subject?.id ?? null,
			subjectName: input.subject?.name ?? null,
			actorId: input.actor.id,
			actorName: input.actor.name,
			detail: detail ? JSON.stringify(detail) : null,
		},
	);
}

/**
 * INSERT for one event, written only when the statement just before it in the
 * batch changed exactly one row (SQLite `changes()`), so an event is never
 * logged for a guarded write that did not happen. Every operation of the
 * business layer logs through this. Item tag / name are snapshotted from the
 * items table. A change made through an AI assistant (MCP) adds
 * `source: "mcp"` to the detail.
 */
export function eventAfterChangeStatement(input: EventInput): InStatement {
	return eventInsert(input, 'WHERE changes() = 1');
}

/**
 * INSERT for one event that does not depend on the statement before it (no
 * `changes()` check, unlike `eventAfterChangeStatement`): the sample data
 * (records written as they are) and the CSV import's summary.
 */
export function unguardedEventStatement(input: EventInput): InStatement {
	return eventInsert(input, '');
}

export interface EventView {
	id: string;
	at: string;
	kind: EventKind;
	itemId: number | null;
	itemTag: string | null;
	itemName: string | null;
	assignmentId: string | null;
	subjectId: string | null;
	subjectName: string | null;
	actorId: string;
	actorName: string;
	detail: Record<string, unknown> | null;
}

function eventViewOf(r: Row): EventView {
	const raw = strOrNull(r, 'detail');
	let detail: Record<string, unknown> | null = null;
	if (raw) {
		try {
			detail = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			detail = null;
		}
	}
	return {
		id: str(r, 'id'),
		at: str(r, 'at'),
		kind: str(r, 'kind') as EventKind,
		itemId: numOrNull(r, 'item_id'),
		itemTag: strOrNull(r, 'item_tag'),
		itemName: strOrNull(r, 'item_name'),
		assignmentId: strOrNull(r, 'assignment_id'),
		subjectId: strOrNull(r, 'subject_user_id'),
		subjectName: strOrNull(r, 'subject_user_name'),
		actorId: str(r, 'actor_id'),
		actorName: str(r, 'actor_name'),
		detail,
	};
}

export interface EventQuery {
	kinds: EventKind[];
	from: string | null;
	to: string | null;
	actorId: string | null;
	q: string | null;
	page: number;
	size: number;
}

/** One page of the history (GET /api/events). */
export interface EventList {
	rows: EventView[];
	total: number;
	/** Everyone who has acted, for the actor filter. */
	actors: { id: string; name: string }[];
}

/** Paged operation history for the admin history screen. */
export async function listEvents(db: Client, actor: Actor, query: EventQuery): Promise<EventList> {
	requireAdmin(actor);
	const where: string[] = [];
	const args: NamedArgs = {};
	if (query.kinds.length > 0) {
		where.push(`kind IN (${namedList('kind', query.kinds, args)})`);
	}
	if (query.from) {
		args.from = zonedDayStartIso(query.from);
		where.push('at >= :from');
	}
	if (query.to) {
		args.to = zonedDayStartIso(addDays(query.to, 1));
		where.push('at < :to');
	}
	if (query.actorId) {
		args.actorId = query.actorId;
		where.push('actor_id = :actorId');
	}
	if (query.q) {
		args.q = likePattern(query.q);
		where.push(
			`(item_tag LIKE :q ESCAPE '\\' OR item_name LIKE :q ESCAPE '\\'
			  OR subject_user_name LIKE :q ESCAPE '\\' OR actor_name LIKE :q ESCAPE '\\')`,
		);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	const [count, page, actors] = await Promise.all([
		db.execute(namedStatement(`SELECT COUNT(*) AS n FROM events ${whereSql}`, args)),
		db.execute(
			namedStatement(
				`SELECT * FROM events ${whereSql} ORDER BY at DESC, rowid DESC LIMIT :limit OFFSET :offset`,
				{ ...args, limit: query.size, offset: (query.page - 1) * query.size },
			),
		),
		db.execute(
			`SELECT actor_id, MAX(actor_name) AS actor_name FROM events
			 GROUP BY actor_id ORDER BY actor_name`,
		),
	]);
	return {
		rows: page.rows.map(eventViewOf),
		total: Number(count.rows[0]?.n ?? 0),
		actors: actors.rows.map((r) => ({ id: str(r, 'actor_id'), name: str(r, 'actor_name') })),
	};
}

/** Every event of one item, newest first (item page, history tab). */
export async function listItemEvents(
	db: Client,
	actor: Actor,
	itemId: number,
): Promise<EventView[]> {
	requireAdmin(actor);
	const res = await db.execute({
		sql: 'SELECT * FROM events WHERE item_id = ? ORDER BY at DESC, rowid DESC',
		args: [itemId],
	});
	return res.rows.map(eventViewOf);
}

/** The latest `limit` events (home screen). */
export async function recentEvents(db: Client, limit: number): Promise<EventView[]> {
	const res = await db.execute({
		sql: 'SELECT * FROM events ORDER BY at DESC, rowid DESC LIMIT ?',
		args: [limit],
	});
	return res.rows.map(eventViewOf);
}
