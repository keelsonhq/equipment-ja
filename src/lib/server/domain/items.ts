import type { Client, InStatement, Row } from '@libsql/client';
import {
	issueStatements,
	type PreparedIssue,
	prepareIssue,
	suspendStatements,
} from './assignments.ts';
import type { Actor } from '#lib/server/auth/actor.ts';
import { nowIso, today } from '#lib/server/dates.ts';
import { type NamedArgs, namedList, namedStatement } from '#lib/server/db/named.ts';
import { AppError, ErrorCode, type FieldErrors, ValidationError } from '#lib/server/errors.ts';
import { type EventInput, eventAfterChangeStatement } from './events.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { findActiveMaster } from './masters.ts';
import {
	imageUrlOf,
	type Membership,
	membershipOf,
	type PeopleIndex,
	peopleIndex,
} from './directory.ts';
import { bool, num, numOrNull, str, strOrNull } from '#lib/server/db/rows.ts';
import { likePattern } from '#lib/server/db/like.ts';

// Items (the ledger). An item never stores who holds it: the current holder is
// the assignment row with returned_on IS NULL (see assignments.ts), joined in
// at read time.

export const ITEM_STATUSES = [
	'unassigned',
	'assigned',
	'pending_return',
	'overdue',
	'suspended',
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const SUSPEND_REASONS = ['repair', 'broken', 'lost', 'other'] as const;
export type SuspendReason = (typeof SUSPEND_REASONS)[number];

export const ITEM_SORTS = [
	'tag',
	'name',
	'holder',
	'type',
	'issued',
	'place',
	'serial',
	'updated',
] as const;
export type ItemSort = (typeof ITEM_SORTS)[number];

/**
 * Editable item fields: the register and edit forms, the API bodies, the CSV
 * import and the AI assistant's register_item. ItemView carries them too.
 */
export interface ItemFields {
	assetTag: string;
	name: string;
	typeId: number | null;
	serialNo: string | null;
	purchasedOn: string | null;
	storageLocation: string | null;
	note: string | null;
}

/**
 * The items column of each field. The ledger SELECT (ITEM_COLUMNS_SQL), the
 * INSERT (itemInsertStatements), the edit's UPDATE and its before / after are
 * built from this, so a new field is added here once.
 */
const FIELD_COLUMNS: Record<keyof ItemFields, string> = {
	assetTag: 'asset_tag',
	name: 'name',
	typeId: 'type_id',
	serialNo: 'serial_no',
	purchasedOn: 'purchased_on',
	storageLocation: 'storage_location',
	note: 'note',
};

const FIELD_KEYS = Object.keys(FIELD_COLUMNS) as (keyof ItemFields)[];

export interface Holder {
	userId: string;
	name: string;
	email: string | null;
	/** Current profile image (see `withHolderDirectoryInfo`); null when none / former. */
	imageUrl: string | null;
	/**
	 * Whether the holder is still a workspace member (`former`: the "former
	 * member" chip, DESIGN.md §8.10). Set with the image by `withHolderDirectoryInfo`;
	 * `unknown` until then and when the people list cannot tell.
	 */
	membership: Membership;
}

/** One ledger row (admin view: every column). */
export interface ItemView extends ItemFields {
	id: number;
	typeName: string | null;
	status: ItemStatus;
	suspendedReason: SuspendReason | null;
	suspendedNote: string | null;
	holder: Holder | null;
	assignmentId: string | null;
	issuedOn: string | null;
	dueOn: string | null;
	placeName: string | null;
	pendingReturn: boolean;
	updatedAt: string;
	version: number;
}

// The SQL fragments and itemViewOf below are shared with home.ts (the home
// screen's stock and attention lists read the same rows). A ledger query is
// `SELECT ${ITEM_COLUMNS_SQL} ${ITEM_FROM_SQL} WHERE …` with the `:today` arg.

// The FROM clause: item + type + current (open) assignment, if any.
export const ITEM_FROM_SQL = `FROM items i
	LEFT JOIN item_types t ON t.id = i.type_id
	LEFT JOIN assignments a ON a.item_id = i.id AND a.returned_on IS NULL`;

// Display status, one per row. Precedence: suspended > pending return >
// overdue > assigned > unassigned (an item can be both held and suspended; the
// holder column still shows who has it).
export const STATUS_SQL = `CASE
	WHEN i.suspended_reason IS NOT NULL THEN 'suspended'
	WHEN a.id IS NULL THEN 'unassigned'
	WHEN a.pending_return = 1 THEN 'pending_return'
	WHEN a.due_on IS NOT NULL AND a.due_on < :today THEN 'overdue'
	ELSE 'assigned' END`;

// Last activity on the item or any of its assignments (the "updated" column).
const UPDATED_SQL = `MAX(i.updated_at,
	COALESCE((SELECT MAX(x.updated_at) FROM assignments x WHERE x.item_id = i.id), ''))`;

// The columns of a ledger row (what itemViewOf reads). The item fields
// (i.asset_tag, i.name, … i.note) come from FIELD_COLUMNS; the rest are written out.
export const ITEM_COLUMNS_SQL = `i.id, ${FIELD_KEYS.map((k) => `i.${FIELD_COLUMNS[k]}`).join(', ')},
	t.name AS type_name, i.suspended_reason, i.suspended_note, i.version,
	a.id AS assignment_id, a.user_id, a.user_name, a.user_email, a.issued_on, a.due_on,
	a.place_name, a.pending_return,
	${STATUS_SQL} AS status,
	${UPDATED_SQL} AS last_activity`;

// Filter predicates for each status (a row matches the filter if it matches
// any of the selected statuses). These are conditions, not the display status:
// "suspended" and "assigned" can both be true for one item.
export const STATUS_PREDICATE: Record<ItemStatus, string> = {
	unassigned: '(a.id IS NULL AND i.suspended_reason IS NULL)',
	assigned: '(a.id IS NOT NULL AND a.pending_return = 0)',
	pending_return: '(a.id IS NOT NULL AND a.pending_return = 1)',
	overdue: '(a.id IS NOT NULL AND a.due_on IS NOT NULL AND a.due_on < :today)',
	suspended: '(i.suspended_reason IS NOT NULL)',
};

const SORT_SQL: Record<ItemSort, string> = {
	tag: 'i.asset_tag',
	name: 'i.name',
	holder: 'a.user_name',
	type: 't.name',
	issued: 'a.issued_on',
	place: 'COALESCE(a.place_name, i.storage_location)',
	serial: 'i.serial_no',
	updated: 'last_activity',
};

export function itemViewOf(r: Row): ItemView {
	const assignmentId = strOrNull(r, 'assignment_id');
	return {
		id: num(r, 'id'),
		assetTag: str(r, 'asset_tag'),
		name: str(r, 'name'),
		typeId: numOrNull(r, 'type_id'),
		typeName: strOrNull(r, 'type_name'),
		serialNo: strOrNull(r, 'serial_no'),
		purchasedOn: strOrNull(r, 'purchased_on'),
		storageLocation: strOrNull(r, 'storage_location'),
		note: strOrNull(r, 'note'),
		status: str(r, 'status') as ItemStatus,
		suspendedReason: strOrNull(r, 'suspended_reason') as SuspendReason | null,
		suspendedNote: strOrNull(r, 'suspended_note'),
		holder: assignmentId
			? {
					userId: str(r, 'user_id'),
					name: str(r, 'user_name'),
					email: strOrNull(r, 'user_email'),
					imageUrl: null,
					membership: 'unknown',
				}
			: null,
		assignmentId,
		issuedOn: strOrNull(r, 'issued_on'),
		dueOn: strOrNull(r, 'due_on'),
		placeName: strOrNull(r, 'place_name'),
		pendingReturn: bool(r, 'pending_return'),
		updatedAt: str(r, 'last_activity'),
		version: num(r, 'version'),
	};
}

/**
 * Rows with what the people index says about each holder now: the profile
 * image and whether they are still a member. Neither is stored with the
 * records.
 */
export function withHolderDirectoryInfo(index: PeopleIndex, rows: ItemView[]): ItemView[] {
	return rows.map((v) =>
		v.holder
			? {
					...v,
					holder: {
						...v.holder,
						imageUrl: imageUrlOf(index, v.holder.userId),
						membership: membershipOf(index, v.holder.userId),
					},
				}
			: v,
	);
}

export interface ItemQuery {
	q: string | null;
	statuses: ItemStatus[];
	typeId: number | null;
	/** Only items without a type (`type=none`). */
	noType: boolean;
	/** Only items someone currently holds (`held=1`; the return picker). */
	held: boolean;
	placeId: number | null;
	memberId: string | null;
	ids: number[];
	sort: ItemSort;
	dir: 'asc' | 'desc';
	page: number;
	size: number;
}

export type StatusCounts = Record<'all' | ItemStatus, number>;

/** One page of the ledger (GET /api/items). */
export interface ItemList {
	rows: ItemView[];
	total: number;
	/** Per-status counts over every filter except the status one (the counts strip). */
	counts: StatusCounts;
	/** Name of the person the `member` filter names, from the records (the filter chip). */
	memberName: string | null;
}

// WHERE clause from every filter except status (the counts strip is computed
// over these so each figure shows what clicking it would give).
function baseWhere(query: ItemQuery): { sql: string[]; args: NamedArgs } {
	const sql: string[] = [];
	const args: NamedArgs = { today: today() };
	if (query.q) {
		// Admin ledger: also the note and the current holder's name.
		args.q = likePattern(query.q);
		sql.push(
			`(i.asset_tag LIKE :q ESCAPE '\\' OR i.name LIKE :q ESCAPE '\\' OR i.serial_no LIKE :q ESCAPE '\\'
				OR i.note LIKE :q ESCAPE '\\' OR a.user_name LIKE :q ESCAPE '\\')`,
		);
	}
	if (query.typeId !== null) {
		args.typeId = query.typeId;
		sql.push('i.type_id = :typeId');
	}
	if (query.noType) {
		sql.push('i.type_id IS NULL');
	}
	if (query.held) {
		sql.push('a.id IS NOT NULL');
	}
	if (query.placeId !== null) {
		args.placeId = query.placeId;
		sql.push('a.place_id = :placeId');
	}
	if (query.memberId !== null) {
		args.memberId = query.memberId;
		sql.push('a.user_id = :memberId');
	}
	if (query.ids.length > 0) {
		sql.push(`i.id IN (${namedList('id', query.ids, args)})`);
	}
	return { sql, args };
}

function orderBy(sort: ItemSort, dir: 'asc' | 'desc'): string {
	const d = dir === 'desc' ? 'DESC' : 'ASC';
	return `ORDER BY ${SORT_SQL[sort]} ${d} NULLS LAST, i.asset_tag ASC, i.id ASC`;
}

/** Filtered rows without paging (CSV export). */
async function queryAll(db: Client, query: ItemQuery): Promise<ItemView[]> {
	const base = baseWhere(query);
	const where = [...base.sql];
	if (query.statuses.length > 0) {
		where.push(`(${query.statuses.map((s) => STATUS_PREDICATE[s]).join(' OR ')})`);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	const res = await db.execute(
		namedStatement(
			`SELECT ${ITEM_COLUMNS_SQL} ${ITEM_FROM_SQL} ${whereSql} ${orderBy(query.sort, query.dir)}`,
			base.args,
		),
	);
	return res.rows.map(itemViewOf);
}

/** The ledger: one page of items plus the total and the per-status counts. */
export async function listItems(db: Client, actor: Actor, query: ItemQuery): Promise<ItemList> {
	requireAdmin(actor);
	const base = baseWhere(query);
	const where = [...base.sql];
	if (query.statuses.length > 0) {
		where.push(`(${query.statuses.map((s) => STATUS_PREDICATE[s]).join(' OR ')})`);
	}
	const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
	const baseSql = base.sql.length > 0 ? `WHERE ${base.sql.join(' AND ')}` : '';
	const countCols = ITEM_STATUSES.map(
		(s) => `SUM(CASE WHEN ${STATUS_PREDICATE[s]} THEN 1 ELSE 0 END) AS ${s}`,
	).join(', ');

	const [index, page, total, counts, member] = await Promise.all([
		peopleIndex(),
		db.execute(
			namedStatement(
				`SELECT ${ITEM_COLUMNS_SQL} ${ITEM_FROM_SQL} ${whereSql} ${orderBy(query.sort, query.dir)}
				LIMIT :limit OFFSET :offset`,
				{ ...base.args, limit: query.size, offset: (query.page - 1) * query.size },
			),
		),
		db.execute(namedStatement(`SELECT COUNT(*) AS n ${ITEM_FROM_SQL} ${whereSql}`, base.args)),
		db.execute(
			namedStatement(
				`SELECT COUNT(*) AS all_count, ${countCols} ${ITEM_FROM_SQL} ${baseSql}`,
				base.args,
			),
		),
		query.memberId
			? db.execute({
					sql: `SELECT user_name FROM assignments WHERE user_id = ?
						ORDER BY issued_on DESC, created_at DESC LIMIT 1`,
					args: [query.memberId],
				})
			: Promise.resolve(null),
	]);

	const c = counts.rows[0];
	return {
		rows: withHolderDirectoryInfo(index, page.rows.map(itemViewOf)),
		total: Number(total.rows[0]?.n ?? 0),
		counts: {
			all: Number(c?.all_count ?? 0),
			unassigned: Number(c?.unassigned ?? 0),
			assigned: Number(c?.assigned ?? 0),
			pending_return: Number(c?.pending_return ?? 0),
			overdue: Number(c?.overdue ?? 0),
			suspended: Number(c?.suspended ?? 0),
		},
		memberName: member?.rows[0] ? str(member.rows[0], 'user_name') : null,
	};
}

/** Every row matching the ledger filters, for CSV export (admin). */
export async function exportItems(db: Client, actor: Actor, query: ItemQuery): Promise<ItemView[]> {
	requireAdmin(actor);
	return queryAll(db, query);
}

// Lookups: find* = no authorization, null when missing; load* = no
// authorization, the not-found error (404) when missing; get* = requireAdmin.

/** One item with its current assignment (admin item page). */
export async function getItem(db: Client, actor: Actor, id: number): Promise<ItemView> {
	requireAdmin(actor);
	const [index, item] = await Promise.all([peopleIndex(), loadItem(db, id)]);
	return withHolderDirectoryInfo(index, [item])[0];
}

/** Internal lookup without an authorization check. */
export async function findItem(db: Client, id: number): Promise<ItemView | null> {
	const res = await db.execute(
		namedStatement(`SELECT ${ITEM_COLUMNS_SQL} ${ITEM_FROM_SQL} WHERE i.id = :id`, {
			id,
			today: today(),
		}),
	);
	const row = res.rows[0];
	return row ? itemViewOf(row) : null;
}

/** findItem for an item that must exist: `item_not_found` when it does not. */
async function loadItem(db: Client, id: number): Promise<ItemView> {
	const item = await findItem(db, id);
	if (!item) {
		throw new AppError(ErrorCode.ItemNotFound);
	}
	return item;
}

/**
 * An item by asset tag (the AI assistant's tools name items by tag). An exact
 * match wins; otherwise a case-insensitive match counts only when exactly one
 * item has it.
 */
export async function findItemByTag(db: Client, assetTag: string): Promise<ItemView | null> {
	const res = await db.execute(
		namedStatement(
			`SELECT ${ITEM_COLUMNS_SQL} ${ITEM_FROM_SQL} WHERE i.asset_tag = :tag COLLATE NOCASE
			ORDER BY i.asset_tag = :tag DESC LIMIT 2`,
			{ tag: assetTag, today: today() },
		),
	);
	const [first, second] = res.rows.map(itemViewOf);
	if (!first || (first.assetTag !== assetTag && second)) {
		return null;
	}
	return first;
}

/**
 * findItemByTag for an item that must exist. For the tools members may use
 * too: the business call that follows decides what the caller may do with it.
 */
export async function loadItemByTag(db: Client, assetTag: string): Promise<ItemView> {
	const item = await findItemByTag(db, assetTag);
	if (!item) {
		throw new AppError(ErrorCode.ItemNotFound);
	}
	return item;
}

/** One item by asset tag with its current assignment (admin; AI assistant tools). */
export async function getItemByTag(db: Client, actor: Actor, assetTag: string): Promise<ItemView> {
	requireAdmin(actor);
	return loadItemByTag(db, assetTag);
}

/** Which of `assetTags` are registered already (CSV import), looked up 500 at a time. */
export async function registeredAssetTags(
	db: Client,
	assetTags: readonly string[],
): Promise<Set<string>> {
	const tags = [...new Set(assetTags.filter((t) => t !== ''))];
	const found = new Set<string>();
	for (let i = 0; i < tags.length; i += 500) {
		const args: NamedArgs = {};
		const list = namedList('tag', tags.slice(i, i + 500), args);
		const res = await db.execute(
			namedStatement(`SELECT asset_tag FROM items WHERE asset_tag IN (${list})`, args),
		);
		for (const r of res.rows) {
			found.add(str(r, 'asset_tag'));
		}
	}
	return found;
}

/** What a non-admin may see of an item that is free to take. */
export interface AvailableItem {
	id: number;
	assetTag: string;
	name: string;
	typeName: string | null;
	storageLocation: string | null;
}

/** What GET /api/available-items asks for. */
export interface AvailableItemQuery {
	q: string | null;
	typeId: number | null;
	page: number;
	size: number;
}

/** One page of items free to take (GET /api/available-items). */
export interface AvailableItemList {
	rows: AvailableItem[];
	total: number;
}

/**
 * Items anyone may assign to themselves: not suspended and not held. Only the
 * columns a member needs are returned — never notes, purchase data, or anything
 * about other people.
 */
export async function listAvailableItems(
	db: Client,
	query: AvailableItemQuery,
): Promise<AvailableItemList> {
	const where = ['a.id IS NULL', 'i.suspended_reason IS NULL'];
	const args: NamedArgs = {};
	if (query.q) {
		// Asset tag, name and type only: notes stay admin-only.
		args.q = likePattern(query.q);
		where.push(
			`(i.asset_tag LIKE :q ESCAPE '\\' OR i.name LIKE :q ESCAPE '\\' OR t.name LIKE :q ESCAPE '\\')`,
		);
	}
	if (query.typeId !== null) {
		args.typeId = query.typeId;
		where.push('i.type_id = :typeId');
	}
	const whereSql = `WHERE ${where.join(' AND ')}`;
	const [page, total] = await Promise.all([
		db.execute(
			namedStatement(
				`SELECT i.id, i.asset_tag, i.name, t.name AS type_name, i.storage_location
				${ITEM_FROM_SQL} ${whereSql} ORDER BY i.asset_tag ASC, i.id ASC LIMIT :limit OFFSET :offset`,
				{ ...args, limit: query.size, offset: (query.page - 1) * query.size },
			),
		),
		db.execute(namedStatement(`SELECT COUNT(*) AS n ${ITEM_FROM_SQL} ${whereSql}`, args)),
	]);
	return {
		rows: page.rows.map((r) => ({
			id: num(r, 'id'),
			assetTag: str(r, 'asset_tag'),
			name: str(r, 'name'),
			typeName: strOrNull(r, 'type_name'),
			storageLocation: strOrNull(r, 'storage_location'),
		})),
		total: Number(total.rows[0]?.n ?? 0),
	};
}

/** Issue a newly registered item in the same transaction (register dialog). */
export interface ItemAssignmentInput {
	userId: string;
	placeId: number;
	issuedOn: string;
	dueOn: string | null;
	note: string | null;
}

export function isUniqueTagViolation(err: unknown): boolean {
	return err instanceof Error && /UNIQUE constraint failed: items\.asset_tag/i.test(err.message);
}

// The item fields (columns and `:args`) come from FIELD_COLUMNS.
const ITEM_INSERT_SQL = `INSERT INTO items
	(${FIELD_KEYS.map((k) => FIELD_COLUMNS[k]).join(', ')}, version, created_at, updated_at)
	VALUES (${FIELD_KEYS.map((k) => `:${k}`).join(', ')}, 1, :at, :at)`;

/**
 * INSERT of a new item + its `create` event. The new id is not known inside a
 * batch, so the event (and an issue in the same batch) finds the item by its
 * unique asset tag. Every new item goes through here: the register form, the
 * AI assistant, the CSV import and the sample data (which passes a past `at`).
 */
export function itemInsertStatements(
	fields: ItemFields,
	actor: EventInput['actor'],
	at: string = nowIso(),
): InStatement[] {
	return [
		namedStatement(ITEM_INSERT_SQL, { ...fields, at }),
		eventAfterChangeStatement({ kind: 'create', item: { assetTag: fields.assetTag }, actor, at }),
	];
}

/** Register a new item (admin). Logs a `create` event in the same batch. */
export async function createItem(
	db: Client,
	actor: Actor,
	fields: ItemFields,
	assignment: ItemAssignmentInput | null = null,
): Promise<ItemView> {
	requireAdmin(actor);
	// Check everything first so the form can show every problem at once.
	const errors: FieldErrors = {};
	if (fields.typeId !== null && !(await findActiveMaster(db, 'types', fields.typeId))) {
		errors.typeId = 'not_found';
	}
	const taken = await db.execute({
		sql: 'SELECT 1 FROM items WHERE asset_tag = ?',
		args: [fields.assetTag],
	});
	if (taken.rows.length > 0) {
		errors.assetTag = 'taken';
	}
	let issue: PreparedIssue | null = null;
	if (assignment) {
		const input = { ...assignment, itemId: null, exchangeFrom: null };
		try {
			issue = await prepareIssue(db, actor, input, 'assignment.');
		} catch (err) {
			if (!(err instanceof ValidationError)) throw err;
			Object.assign(errors, err.fields);
		}
	}
	if (Object.keys(errors).length > 0) {
		throw new ValidationError(errors);
	}
	// Register (+ issue): one batch = one transaction, so a failed issue leaves
	// no item behind.
	const statements = itemInsertStatements(fields, actor);
	if (issue) {
		statements.push(...issueStatements(issue, { assetTag: fields.assetTag }));
	}
	try {
		await db.batch(statements, 'write');
	} catch (err) {
		if (isUniqueTagViolation(err)) {
			throw new ValidationError({ assetTag: 'taken' });
		}
		throw err;
	}
	const res = await db.execute({
		sql: 'SELECT id FROM items WHERE asset_tag = ?',
		args: [fields.assetTag],
	});
	return loadItem(db, num(res.rows[0], 'id'));
}

/** Edit item fields (admin) with optimistic concurrency on `version`. */
export async function updateItem(
	db: Client,
	actor: Actor,
	id: number,
	version: number,
	fields: ItemFields,
): Promise<ItemView> {
	requireAdmin(actor);
	const current = await loadItem(db, id);
	if (
		fields.typeId !== null &&
		fields.typeId !== current.typeId &&
		!(await findActiveMaster(db, 'types', fields.typeId))
	) {
		throw new ValidationError({ typeId: 'not_found' });
	}
	const changes: Record<string, [unknown, unknown]> = {};
	for (const key of FIELD_KEYS) {
		if (current[key] !== fields[key]) {
			changes[key] = [current[key], fields[key]];
		}
	}
	if (Object.keys(changes).length === 0) {
		return current;
	}
	const sets = (Object.keys(changes) as (keyof ItemFields)[]).map(
		(k) => `${FIELD_COLUMNS[k]} = :${k}`,
	);
	try {
		const [update] = await db.batch(
			[
				namedStatement(
					`UPDATE items SET ${sets.join(', ')}, version = version + 1, updated_at = :at
					WHERE id = :id AND version = :version`,
					{ ...fields, at: nowIso(), id, version },
				),
				eventAfterChangeStatement({
					kind: 'edit',
					item: { id },
					actor,
					detail: { changes: await namedChanges(db, changes) },
				}),
			],
			'write',
		);
		if (update.rowsAffected === 0) {
			throw new AppError(ErrorCode.ItemVersionConflict);
		}
	} catch (err) {
		if (isUniqueTagViolation(err)) {
			throw new ValidationError({ assetTag: 'taken' });
		}
		throw err;
	}
	return loadItem(db, id);
}

/**
 * Fields that point at another table: the history records the name the row
 * had at the time (not the id), under its own key. A new such field is added
 * here with its key in the history and its table.
 */
const NAMED_FIELDS: Partial<Record<keyof ItemFields, { key: string; table: string }>> = {
	typeId: { key: 'type', table: 'item_types' },
};

/** The edit's changes with the NAMED_FIELDS ids turned into names (same order). */
async function namedChanges(
	db: Client,
	changes: Record<string, [unknown, unknown]>,
): Promise<Record<string, [unknown, unknown]>> {
	const out: Record<string, [unknown, unknown]> = {};
	for (const [key, [before, after]] of Object.entries(changes)) {
		const named = NAMED_FIELDS[key as keyof ItemFields];
		if (!named) {
			out[key] = [before, after];
			continue;
		}
		const nameOf = async (id: unknown) => {
			if (id === null) {
				return null;
			}
			const res = await db.execute({
				sql: `SELECT name FROM ${named.table} WHERE id = ?`,
				args: [Number(id)],
			});
			return res.rows[0] ? str(res.rows[0], 'name') : null;
		};
		out[named.key] = [await nameOf(before), await nameOf(after)];
	}
	return out;
}

/**
 * Suspend an item (admin): repair / broken / lost / other. Existing assignments
 * are left untouched — a suspended item can still be returned.
 */
export async function suspendItem(
	db: Client,
	actor: Actor,
	id: number,
	reason: SuspendReason,
	note: string | null,
): Promise<ItemView> {
	requireAdmin(actor);
	const [update] = await db.batch(
		suspendStatements(id, { reason, note }, actor, { at: nowIso() }),
		'write',
	);
	if (update.rowsAffected === 0) {
		const item = await findItem(db, id);
		throw item ? new AppError(ErrorCode.ItemSuspended) : new AppError(ErrorCode.ItemNotFound);
	}
	return loadItem(db, id);
}

/** Lift a suspension (admin). */
export async function resumeItem(db: Client, actor: Actor, id: number): Promise<ItemView> {
	requireAdmin(actor);
	const [update] = await db.batch(
		[
			{
				sql: `UPDATE items SET suspended_reason = NULL, suspended_note = NULL,
						version = version + 1, updated_at = ?
					WHERE id = ? AND suspended_reason IS NOT NULL`,
				args: [nowIso(), id],
			},
			eventAfterChangeStatement({ kind: 'resume', item: { id }, actor }),
		],
		'write',
	);
	if (update.rowsAffected === 0) {
		const item = await findItem(db, id);
		throw item ? new AppError(ErrorCode.ItemNotSuspended) : new AppError(ErrorCode.ItemNotFound);
	}
	return loadItem(db, id);
}

/** Distinct storage locations in use (suggestions for the item form). */
export async function listStorageLocations(db: Client, actor: Actor): Promise<string[]> {
	requireAdmin(actor);
	const res = await db.execute(
		`SELECT DISTINCT storage_location FROM items
		 WHERE storage_location IS NOT NULL AND storage_location != ''
		 ORDER BY storage_location`,
	);
	return res.rows.map((r) => str(r, 'storage_location'));
}
