import type { Client, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { today } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { bool, num, numOrNull, str } from '#lib/server/db/rows.ts';
import { type EventView, recentEvents } from './events.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import {
	ITEM_COLUMNS_SQL,
	ITEM_FROM_SQL,
	type ItemStatus,
	type ItemView,
	itemViewOf,
	STATUS_PREDICATE,
	STATUS_SQL,
	withHolderDirectoryInfo,
} from './items.ts';
import { peopleIndex } from './directory.ts';

// The admin home screen (DESIGN.md §9-L): entry points for the daily
// jobs, per-type stock, items that need action and the latest history, in
// one request.

export interface HomeData {
	stock: TypeStock[];
	attention: AttentionList;
	recent: EventView[];
}

/** Items that need action: the first rows and how many there are in all. */
export interface AttentionList {
	rows: ItemView[];
	total: number;
}

export async function getHome(db: Client, actor: Actor): Promise<HomeData> {
	requireAdmin(actor);
	const [index, stock, attention, recent] = await Promise.all([
		peopleIndex(),
		stockByType(db),
		attentionItems(db, 10),
		recentEvents(db, 10),
	]);
	return {
		stock,
		attention: { rows: withHolderDirectoryInfo(index, attention.rows), total: attention.total },
		recent,
	};
}

/** Per-type stock: one row per type, the display status as a partition. */
export interface TypeStock {
	/** null = items without a type. */
	typeId: number | null;
	name: string | null;
	active: boolean;
	unassigned: number;
	/** Held and not pending return (overdue included). */
	assigned: number;
	pendingReturn: number;
	suspended: number;
	total: number;
}

/**
 * Stock by item type for the home screen ("can I issue a laptop now?"). Each
 * item is counted once, by its display status (suspended > pending return >
 * held > unassigned), so the columns add up to the total. Active types are
 * listed even when empty; inactive ones only while they still have items.
 */
async function stockByType(db: Client): Promise<TypeStock[]> {
	const [counts, types] = await Promise.all([
		db.execute(
			namedStatement(
				`SELECT s.type_id,
					SUM(CASE WHEN s.status = 'unassigned' THEN 1 ELSE 0 END) AS unassigned,
					SUM(CASE WHEN s.status IN ('assigned', 'overdue') THEN 1 ELSE 0 END) AS assigned,
					SUM(CASE WHEN s.status = 'pending_return' THEN 1 ELSE 0 END) AS pending_return,
					SUM(CASE WHEN s.status = 'suspended' THEN 1 ELSE 0 END) AS suspended,
					COUNT(*) AS total
				FROM (SELECT i.type_id, ${STATUS_SQL} AS status ${ITEM_FROM_SQL}) s
				GROUP BY s.type_id`,
				{ today: today() },
			),
		),
		db.execute('SELECT id, name, active FROM item_types ORDER BY sort_order, id'),
	]);
	const byType = new Map<number | null, Row>();
	for (const r of counts.rows) {
		byType.set(numOrNull(r, 'type_id'), r);
	}
	const row = (typeId: number | null, name: string | null, active: boolean): TypeStock => {
		const c = byType.get(typeId);
		return {
			typeId,
			name,
			active,
			unassigned: c ? num(c, 'unassigned') : 0,
			assigned: c ? num(c, 'assigned') : 0,
			pendingReturn: c ? num(c, 'pending_return') : 0,
			suspended: c ? num(c, 'suspended') : 0,
			total: c ? num(c, 'total') : 0,
		};
	};
	const rows = types.rows
		.map((t) => row(num(t, 'id'), str(t, 'name'), bool(t, 'active')))
		.filter((r) => r.active || r.total > 0);
	if (byType.has(null)) {
		rows.push(row(null, null, true));
	}
	return rows;
}

/** Statuses that need someone to act (home screen). */
const ATTENTION_STATUSES: ItemStatus[] = ['overdue', 'pending_return', 'suspended'];

/**
 * Items that need action: overdue first (oldest due date first), then pending
 * returns, then suspended items. At most `limit` rows, plus the total.
 */
async function attentionItems(db: Client, limit: number): Promise<AttentionList> {
	const where = `WHERE ${ATTENTION_STATUSES.map((s) => STATUS_PREDICATE[s]).join(' OR ')}`;
	const [page, total] = await Promise.all([
		db.execute(
			namedStatement(
				`SELECT ${ITEM_COLUMNS_SQL} ${ITEM_FROM_SQL} ${where}
				ORDER BY CASE ${STATUS_SQL} WHEN 'overdue' THEN 0 WHEN 'pending_return' THEN 1 ELSE 2 END,
					a.due_on ASC NULLS LAST, last_activity DESC, i.asset_tag ASC
				LIMIT :limit`,
				{ today: today(), limit },
			),
		),
		db.execute(
			namedStatement(`SELECT COUNT(*) AS n ${ITEM_FROM_SQL} ${where}`, { today: today() }),
		),
	]);
	return { rows: page.rows.map(itemViewOf), total: Number(total.rows[0]?.n ?? 0) };
}
