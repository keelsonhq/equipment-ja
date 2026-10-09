import type { Client, InStatement } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { nowIso } from '#lib/server/dates.ts';
import { AppError, ErrorCode, ValidationError } from '#lib/server/errors.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { type NamedArgs, namedStatement } from '#lib/server/db/named.ts';
import { bool, num, str } from '#lib/server/db/rows.ts';

// Item types and usage places: two small admin-managed lists (masters screen).
// A value in use cannot be deleted, only deactivated; deactivated values stay
// readable on existing records but are no longer offered for new ones.

type MasterKind = 'types' | 'places';

export interface MasterEntry {
	id: number;
	name: string;
	active: boolean;
	sortOrder: number;
	/** Items (types) or open assignments (places) currently using the value. */
	usage: number;
}

/** Route parameter -> list kind (404 for anything else). */
export function parseMasterKind(value: string): MasterKind {
	if (value !== 'types' && value !== 'places') {
		throw new AppError(ErrorCode.NotFound);
	}
	return value;
}

const TABLE: Record<MasterKind, string> = { types: 'item_types', places: 'places' };

const USAGE_SQL: Record<MasterKind, string> = {
	types: '(SELECT COUNT(*) FROM items i WHERE i.type_id = m.id)',
	places: '(SELECT COUNT(*) FROM assignments a WHERE a.place_id = m.id AND a.returned_on IS NULL)',
};

/** All entries of one list, in display order. */
export async function listMaster(db: Client, kind: MasterKind): Promise<MasterEntry[]> {
	const res = await db.execute(
		`SELECT m.id, m.name, m.active, m.sort_order, ${USAGE_SQL[kind]} AS usage
		 FROM ${TABLE[kind]} m ORDER BY m.sort_order, m.id`,
	);
	return res.rows.map((r) => ({
		id: num(r, 'id'),
		name: str(r, 'name'),
		active: bool(r, 'active'),
		sortOrder: num(r, 'sort_order'),
		usage: num(r, 'usage'),
	}));
}

/**
 * One list for the masters screen (admin). `kind` is the route parameter as
 * it came: a member gets 403 whatever it says, before any 404 for a bad kind.
 */
export async function getMasterList(
	db: Client,
	actor: Actor,
	kind: string,
): Promise<MasterEntry[]> {
	requireAdmin(actor);
	return listMaster(db, parseMasterKind(kind));
}

/** Both lists (GET /api/masters). */
export interface MasterLists {
	types: MasterEntry[];
	places: MasterEntry[];
}

/** Both lists, for filters and dialogs (any signed-in user). */
export async function listMasters(db: Client): Promise<MasterLists> {
	const [types, places] = await Promise.all([listMaster(db, 'types'), listMaster(db, 'places')]);
	return { types, places };
}

function isUniqueViolation(err: unknown): boolean {
	return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

// The sort order of a new entry: after every entry of its list.
function nextSortOrderSql(kind: MasterKind): string {
	return `(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM ${TABLE[kind]})`;
}

/** Append a new active entry at the end of the list. */
export async function addMaster(
	db: Client,
	actor: Actor,
	kind: MasterKind,
	name: string,
): Promise<MasterEntry> {
	requireAdmin(actor);
	try {
		const res = await db.execute(
			namedStatement(
				`INSERT INTO ${TABLE[kind]} (name, active, sort_order, created_at, updated_at)
				VALUES (:name, 1, ${nextSortOrderSql(kind)}, :at, :at)
				RETURNING id, sort_order`,
				{ name, at: nowIso() },
			),
		);
		const row = res.rows[0];
		return { id: num(row, 'id'), name, active: true, sortOrder: num(row, 'sort_order'), usage: 0 };
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new ValidationError({ name: 'taken' });
		}
		throw err;
	}
}

/**
 * Statements that append each name to its list as an active entry, unless the
 * list has it already (CSV import: a name someone added in the meantime is
 * left as it is). The caller checks the admin and runs them in one batch.
 */
export function addMissingMasterStatements(
	kind: MasterKind,
	names: readonly string[],
): InStatement[] {
	const at = nowIso();
	return names.map((name) =>
		namedStatement(
			`INSERT INTO ${TABLE[kind]} (name, active, sort_order, created_at, updated_at)
			SELECT :name, 1, ${nextSortOrderSql(kind)}, :at, :at
			WHERE NOT EXISTS (SELECT 1 FROM ${TABLE[kind]} WHERE name = :name)`,
			{ name, at },
		),
	);
}

/** Rename and / or (de)activate an entry. */
export async function updateMaster(
	db: Client,
	actor: Actor,
	kind: MasterKind,
	id: number,
	patch: { name?: string; active?: boolean },
): Promise<void> {
	requireAdmin(actor);
	const sets: string[] = [];
	const args: NamedArgs = { id };
	if (patch.name !== undefined) {
		sets.push('name = :name');
		args.name = patch.name;
	}
	if (patch.active !== undefined) {
		sets.push('active = :active');
		args.active = patch.active ? 1 : 0;
	}
	if (sets.length === 0) {
		throw new AppError(ErrorCode.InvalidRequest);
	}
	args.at = nowIso();
	try {
		const res = await db.execute(
			namedStatement(
				`UPDATE ${TABLE[kind]} SET ${sets.join(', ')}, updated_at = :at WHERE id = :id`,
				args,
			),
		);
		if (res.rowsAffected === 0) {
			throw new AppError(kind === 'types' ? ErrorCode.TypeNotFound : ErrorCode.PlaceNotFound);
		}
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new ValidationError({ name: 'taken' });
		}
		throw err;
	}
}

/**
 * An active entry by id, or null when it is missing or deactivated (the caller
 * reports `not_found` on the form field that chose it).
 */
export async function findActiveMaster(
	db: Client,
	kind: MasterKind,
	id: number,
): Promise<{ id: number; name: string } | null> {
	const res = await db.execute({
		sql: `SELECT id, name FROM ${TABLE[kind]} WHERE id = ? AND active = 1`,
		args: [id],
	});
	const row = res.rows[0];
	return row ? { id: num(row, 'id'), name: str(row, 'name') } : null;
}
