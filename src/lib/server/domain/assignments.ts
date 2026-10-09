import type { Client, InStatement, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { nowIso, today } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { AppError, ErrorCode, type FieldErrors, ValidationError } from '#lib/server/errors.ts';
import { type EventInput, eventAfterChangeStatement, type ItemTarget } from './events.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import type { SuspendReason } from './items.ts';
import { findActiveMaster } from './masters.ts';
import {
	findPerson,
	imageUrlOf,
	type Membership,
	membershipOf,
	type PeopleIndex,
	peopleIndex,
	type PersonSummary,
} from './directory.ts';
import { bool, num, numOrNull, str, strOrNull } from '#lib/server/db/rows.ts';

// Assignments: one row per hand-over of one item to one person. returned_on IS
// NULL means "currently held". Every write below is ONE libSQL batch (one
// atomic transaction) whose first statement carries the business-rule guard in
// its WHERE clause; follow-up statements run only if the previous one changed a
// row (`changes() = 1`). Together with the partial unique index on open
// assignments, an item can never be held twice, even under concurrent requests.

export type ReturnKind = 'returned' | 'collected';

/** A row of the assignment ledger (DESIGN.md §9-F). */
export interface AssignmentView {
	id: string;
	itemId: number;
	assetTag: string;
	itemName: string;
	typeName: string | null;
	userId: string;
	userName: string;
	userEmail: string | null;
	/**
	 * The holder's current profile image (directory members only; null for
	 * former members and when none is set). Attached at read time by
	 * `withUserDirectoryInfo`, never stored: name / email are the snapshot, this is not.
	 */
	userImageUrl: string | null;
	/**
	 * Whether the holder is still a workspace member (`former` = left: the
	 * "former member" chip, DESIGN.md §8.10). Attached with the image by
	 * `withUserDirectoryInfo`; `unknown` when the people list could not tell.
	 */
	userMembership: Membership;
	placeId: number | null;
	placeName: string | null;
	issuedOn: string;
	dueOn: string | null;
	note: string | null;
	issuedByName: string;
	returnedOn: string | null;
	returnKind: ReturnKind | null;
	returnedByName: string | null;
	returnNote: string | null;
	pendingReturn: boolean;
	replacedBy: string | null;
	suspendedReason: SuspendReason | null;
	version: number;
}

// A ledger query is `SELECT ${ASSIGNMENT_COLUMNS_SQL} ${ASSIGNMENT_FROM_SQL} WHERE …`.
const ASSIGNMENT_COLUMNS_SQL = `a.*, i.asset_tag, i.name AS item_name, i.suspended_reason,
	t.name AS type_name`;
const ASSIGNMENT_FROM_SQL = `FROM assignments a
	JOIN items i ON i.id = a.item_id
	LEFT JOIN item_types t ON t.id = i.type_id`;

function assignmentViewOf(r: Row): AssignmentView {
	return {
		id: str(r, 'id'),
		itemId: num(r, 'item_id'),
		assetTag: str(r, 'asset_tag'),
		itemName: str(r, 'item_name'),
		typeName: strOrNull(r, 'type_name'),
		userId: str(r, 'user_id'),
		userName: str(r, 'user_name'),
		userEmail: strOrNull(r, 'user_email'),
		userImageUrl: null,
		userMembership: 'unknown',
		placeId: numOrNull(r, 'place_id'),
		placeName: strOrNull(r, 'place_name'),
		issuedOn: str(r, 'issued_on'),
		dueOn: strOrNull(r, 'due_on'),
		note: strOrNull(r, 'note'),
		issuedByName: str(r, 'issued_by_name'),
		returnedOn: strOrNull(r, 'returned_on'),
		returnKind: strOrNull(r, 'return_kind') as ReturnKind | null,
		returnedByName: strOrNull(r, 'returned_by_name'),
		returnNote: strOrNull(r, 'return_note'),
		pendingReturn: bool(r, 'pending_return'),
		replacedBy: strOrNull(r, 'replaced_by'),
		suspendedReason: strOrNull(r, 'suspended_reason') as SuspendReason | null,
		version: num(r, 'version'),
	};
}

/**
 * Rows with what the people index says about each holder now: the profile
 * image and whether they are still a member. Neither is stored with the
 * records.
 */
export function withUserDirectoryInfo(
	index: PeopleIndex,
	rows: AssignmentView[],
): AssignmentView[] {
	return rows.map((a) => ({
		...a,
		userImageUrl: imageUrlOf(index, a.userId),
		userMembership: membershipOf(index, a.userId),
	}));
}

// rowid breaks ties between rows written in the same millisecond.
const LEDGER_ORDER = 'ORDER BY a.issued_on DESC, a.created_at DESC, a.rowid DESC';

// Lookups follow items.ts: find* = null when missing, load* = the not-found
// error (404), no authorization in either.

async function findAssignment(db: Client, id: string): Promise<AssignmentView | null> {
	const res = await db.execute({
		sql: `SELECT ${ASSIGNMENT_COLUMNS_SQL} ${ASSIGNMENT_FROM_SQL} WHERE a.id = ?`,
		args: [id],
	});
	const row = res.rows[0];
	return row ? assignmentViewOf(row) : null;
}

/** findAssignment for an assignment that must exist: `assignment_not_found` when it does not. */
async function loadAssignment(db: Client, id: string): Promise<AssignmentView> {
	const assignment = await findAssignment(db, id);
	if (!assignment) {
		throw new AppError(ErrorCode.AssignmentNotFound);
	}
	return assignment;
}

/** Every assignment of one item, newest first (admin item page). */
export async function listItemAssignments(
	db: Client,
	actor: Actor,
	itemId: number,
): Promise<AssignmentView[]> {
	requireAdmin(actor);
	const [index, res] = await Promise.all([
		peopleIndex(),
		db.execute({
			sql: `SELECT ${ASSIGNMENT_COLUMNS_SQL} ${ASSIGNMENT_FROM_SQL} WHERE a.item_id = ? ${LEDGER_ORDER}`,
			args: [itemId],
		}),
	]);
	return withUserDirectoryInfo(index, res.rows.map(assignmentViewOf));
}

/**
 * Every assignment of one person, newest first. No authorization here: callers
 * (people.ts getMember / getMe) decide whose ledger may be read.
 */
export async function listPersonAssignments(db: Client, userId: string): Promise<AssignmentView[]> {
	const res = await db.execute({
		sql: `SELECT ${ASSIGNMENT_COLUMNS_SQL} ${ASSIGNMENT_FROM_SQL} WHERE a.user_id = ? ${LEDGER_ORDER}`,
		args: [userId],
	});
	return res.rows.map(assignmentViewOf);
}

export interface IssueInput {
	itemId: number;
	/** Target person. Omitted (or the caller's own id) = assign to oneself. */
	userId: string | null;
	placeId: number;
	issuedOn: string;
	dueOn: string | null;
	note: string | null;
	/** Exchange: the person's currently held assignment the new item replaces. */
	exchangeFrom: string | null;
}

function isOpenAssignmentViolation(err: unknown): boolean {
	return (
		err instanceof Error && /UNIQUE constraint failed: assignments\.item_id/i.test(err.message)
	);
}

/** An issue that passed validation, with the person and place resolved. */
export interface PreparedIssue {
	id: string;
	person: PersonSummary;
	place: { id: number; name: string };
	issuedOn: string;
	dueOn: string | null;
	note: string | null;
	exchangeFrom: string | null;
	actor: Actor;
}

/**
 * Validate an issue and resolve the person and place. Every problem tied to a
 * form field is reported at once as `validation_failed`; field names get
 * `prefix` (`assignment.` when issuing together with registering an item).
 * Authorization is the caller's job.
 */
export async function prepareIssue(
	db: Client,
	actor: Actor,
	input: Omit<IssueInput, 'itemId'> & { itemId: number | null },
	prefix = '',
): Promise<PreparedIssue> {
	const errors: FieldErrors = {};
	if (input.issuedOn > today()) {
		errors[`${prefix}issuedOn`] = 'future';
	}
	if (input.dueOn !== null && input.dueOn < input.issuedOn) {
		errors[`${prefix}dueOn`] = 'before_issued';
	}
	const place = await findActiveMaster(db, 'places', input.placeId);
	if (!place) {
		errors[`${prefix}placeId`] = 'not_found';
	}
	const person =
		input.userId === null || input.userId === actor.id
			? { id: actor.id, name: actor.name, email: actor.email }
			: await findPerson(input.userId);
	if (!person) {
		errors[`${prefix}userId`] = 'not_found';
	}
	if (input.exchangeFrom !== null && person) {
		const source = await findAssignment(db, input.exchangeFrom);
		if (
			!source ||
			source.userId !== person.id ||
			source.returnedOn !== null ||
			source.pendingReturn ||
			source.itemId === input.itemId
		) {
			errors[`${prefix}exchangeFrom`] = 'invalid';
		}
	}
	if (Object.keys(errors).length > 0 || !place || !person) {
		throw new ValidationError(errors);
	}
	return {
		id: crypto.randomUUID(),
		person,
		place,
		issuedOn: input.issuedOn,
		dueOn: input.dueOn,
		note: input.note,
		exchangeFrom: input.exchangeFrom,
		actor,
	};
}

/**
 * The statements that write a prepared issue. For an existing item (`id`) the
 * INSERT carries the business-rule guard (not suspended, not held, valid
 * exchange source) and writes nothing if it fails; follow-up statements run
 * only if the previous one changed a row. For an item inserted earlier in the
 * same batch (`assetTag`) there is nothing to guard: the item is new.
 */
export function issueStatements(p: PreparedIssue, item: ItemTarget): InStatement[] {
	const ts = nowIso();
	const itemSql = 'id' in item ? ':itemId' : '(SELECT id FROM items WHERE asset_tag = :assetTag)';
	const guards: string[] = [];
	if ('id' in item) {
		guards.push(
			'EXISTS (SELECT 1 FROM items WHERE id = :itemId AND suspended_reason IS NULL)',
			'NOT EXISTS (SELECT 1 FROM assignments WHERE item_id = :itemId AND returned_on IS NULL)',
		);
	}
	if (p.exchangeFrom !== null) {
		guards.push(`EXISTS (SELECT 1 FROM assignments WHERE id = :exchangeFrom
			AND user_id = :userId AND returned_on IS NULL AND pending_return = 0)`);
	}
	const insertSql = `INSERT INTO assignments (id, item_id, user_id, user_name, user_email, place_id,
			place_name, issued_on, due_on, note, issued_by_id, issued_by_name, pending_return,
			version, created_at, updated_at)
		SELECT :id, ${itemSql}, :userId, :userName, :userEmail, :placeId, :placeName, :issuedOn,
			:dueOn, :note, :actorId, :actorName, 0, 1, :ts, :ts
		${guards.length > 0 ? `WHERE ${guards.join(' AND ')}` : ''}`;
	const statements: InStatement[] = [
		namedStatement(insertSql, {
			id: p.id,
			...('id' in item ? { itemId: item.id } : { assetTag: item.assetTag }),
			userId: p.person.id,
			userName: p.person.name,
			userEmail: p.person.email,
			placeId: p.place.id,
			placeName: p.place.name,
			issuedOn: p.issuedOn,
			dueOn: p.dueOn,
			note: p.note,
			actorId: p.actor.id,
			actorName: p.actor.name,
			ts,
			exchangeFrom: p.exchangeFrom,
		}),
		eventAfterChangeStatement({
			kind: 'issue',
			item,
			assignmentId: p.id,
			subject: { id: p.person.id, name: p.person.name },
			actor: p.actor,
			detail: {
				place: p.place.name,
				issuedOn: p.issuedOn,
				dueOn: p.dueOn,
				note: p.note,
				exchangeFrom: p.exchangeFrom,
			},
		}),
	];
	if (p.exchangeFrom !== null) {
		// Guarded on the event insert above, which only happened if the new
		// assignment was written.
		statements.push({
			sql: `UPDATE assignments SET pending_return = 1, replaced_by = ?, version = version + 1,
					updated_at = ?
				WHERE id = ? AND changes() = 1`,
			args: [p.id, ts, p.exchangeFrom],
		});
	}
	return statements;
}

/**
 * Issue an item to a person, or to oneself (self-assignment).
 *
 * - Members may only assign to themselves; admins may assign to anyone in the
 *   workspace directory.
 * - Only an item that is neither suspended nor currently held can be issued.
 * - With `exchangeFrom` (admin), the person's old assignment is marked as
 *   pending return in the same transaction: the old item stays with the person
 *   until its return is actually recorded.
 */
export async function issueItem(
	db: Client,
	actor: Actor,
	input: IssueInput,
): Promise<AssignmentView> {
	const selfAssign = input.userId === null || input.userId === actor.id;
	if (!selfAssign || input.exchangeFrom !== null) {
		requireAdmin(actor);
	}
	const prepared = await prepareIssue(db, actor, input);
	let inserted: number;
	try {
		const results = await db.batch(issueStatements(prepared, { id: input.itemId }), 'write');
		inserted = results[0].rowsAffected;
	} catch (err) {
		if (isOpenAssignmentViolation(err)) {
			throw new AppError(ErrorCode.ItemAlreadyAssigned);
		}
		throw err;
	}
	if (inserted === 0) {
		throw await diagnoseIssueFailure(db, input);
	}
	return loadAssignment(db, prepared.id);
}

// The guarded insert wrote nothing: work out which rule stopped it.
async function diagnoseIssueFailure(db: Client, input: IssueInput): Promise<AppError> {
	const res = await db.execute({
		sql: `SELECT i.suspended_reason,
				(SELECT COUNT(*) FROM assignments a WHERE a.item_id = i.id AND a.returned_on IS NULL)
					AS open_count
			FROM items i WHERE i.id = ?`,
		args: [input.itemId],
	});
	const row = res.rows[0];
	if (!row) {
		return new AppError(ErrorCode.ItemNotFound);
	}
	if (Number(row.open_count) > 0) {
		return new AppError(ErrorCode.ItemAlreadyAssigned);
	}
	if (row.suspended_reason !== null) {
		return new AppError(ErrorCode.ItemSuspended);
	}
	return new ValidationError({ exchangeFrom: 'invalid' });
}

/** Why an item is out of use (the suspend form, and a return that suspends it). */
export interface Suspension {
	reason: SuspendReason;
	note: string | null;
}

/**
 * UPDATE that suspends an item not suspended yet, and its `suspend` event:
 * items.ts `suspendItem`, and a return that suspends the returned item. With
 * `followUp` the UPDATE is a follow-up statement (see the top of this file):
 * it also needs the statement before it to have changed a row.
 * (It lives here rather than in items.ts so that the two modules import each
 * other one way only: items.ts already uses this module to register + issue.)
 */
export function suspendStatements(
	itemId: number,
	suspension: Suspension,
	actor: EventInput['actor'],
	opts: { at: string; followUp?: boolean },
): InStatement[] {
	return [
		namedStatement(
			`UPDATE items SET suspended_reason = :reason, suspended_note = :note,
					version = version + 1, updated_at = :at
				WHERE id = :itemId AND suspended_reason IS NULL ${opts.followUp ? 'AND changes() = 1' : ''}`,
			{ reason: suspension.reason, note: suspension.note, at: opts.at, itemId },
		),
		eventAfterChangeStatement({
			kind: 'suspend',
			item: { id: itemId },
			actor,
			detail: { reason: suspension.reason, note: suspension.note },
		}),
	];
}

export interface ReturnInput {
	returnedOn: string;
	note: string | null;
	/** Admin only: where the returned item is now stored. */
	storageLocation: string | null;
	/** Admin only: suspend the returned item (needs repair, broken, ...). */
	suspend: Suspension | null;
}

/**
 * Record a return. The holder returns their own item (kind `returned`); an
 * admin may also record it for anyone (kind `collected`). Works on suspended
 * items too.
 */
export async function returnAssignment(
	db: Client,
	actor: Actor,
	assignmentId: string,
	input: ReturnInput,
): Promise<AssignmentView> {
	const current = await loadAssignment(db, assignmentId);
	const own = current.userId === actor.id;
	if (!own && !actor.isAdmin) {
		throw new AppError(ErrorCode.AssignmentNotOwned);
	}
	if (input.storageLocation !== null || input.suspend !== null) {
		requireAdmin(actor);
	}
	if (current.returnedOn !== null) {
		throw new AppError(ErrorCode.AssignmentAlreadyReturned);
	}
	if (input.returnedOn < current.issuedOn) {
		throw new ValidationError({ returnedOn: 'before_issued' });
	}
	if (input.returnedOn > today()) {
		throw new ValidationError({ returnedOn: 'future' });
	}

	const kind: ReturnKind = own ? 'returned' : 'collected';
	const ts = nowIso();
	const statements: InStatement[] = [
		// A member may only return their own (the check above, again inside the write).
		namedStatement(
			`UPDATE assignments SET returned_on = :returnedOn, return_kind = :kind,
					returned_by_id = :actorId, returned_by_name = :actorName, return_note = :note,
					version = version + 1, updated_at = :at
				WHERE id = :id AND returned_on IS NULL ${actor.isAdmin ? '' : 'AND user_id = :actorId'}`,
			{
				returnedOn: input.returnedOn,
				kind,
				actorId: actor.id,
				actorName: actor.name,
				note: input.note,
				at: ts,
				id: assignmentId,
			},
		),
		eventAfterChangeStatement({
			kind: 'return',
			item: { id: current.itemId },
			assignmentId,
			subject: { id: current.userId, name: current.userName },
			actor,
			detail: {
				returnKind: kind,
				returnedOn: input.returnedOn,
				note: input.note,
				storageLocation: input.storageLocation,
			},
		}),
	];
	if (input.storageLocation !== null) {
		statements.push({
			sql: `UPDATE items SET storage_location = ?, version = version + 1, updated_at = ?
				WHERE id = ? AND changes() = 1`,
			args: [input.storageLocation, ts, current.itemId],
		});
	}
	if (input.suspend !== null) {
		statements.push(
			...suspendStatements(current.itemId, input.suspend, actor, { at: ts, followUp: true }),
		);
	}
	const [update] = await db.batch(statements, 'write');
	if (update.rowsAffected === 0) {
		throw new AppError(ErrorCode.AssignmentAlreadyReturned);
	}
	return loadAssignment(db, assignmentId);
}

export interface CorrectInput {
	issuedOn: string;
	returnedOn: string | null;
	placeId: number;
	reason: string;
	version: number;
}

/**
 * Correct a recorded assignment (admin): issue date, return date, usage place.
 * The previous values are kept in the `correct` event, so the history can
 * always be traced back.
 */
export async function correctAssignment(
	db: Client,
	actor: Actor,
	assignmentId: string,
	input: CorrectInput,
): Promise<AssignmentView> {
	requireAdmin(actor);
	const current = await loadAssignment(db, assignmentId);
	// An open assignment is closed by recording a return, not by a correction.
	if ((current.returnedOn === null) !== (input.returnedOn === null)) {
		throw new AppError(ErrorCode.InvalidRequest);
	}
	const todayDate = today();
	const errors: FieldErrors = {};
	if (input.issuedOn > todayDate) {
		errors.issuedOn = 'future';
	}
	if (input.returnedOn !== null && input.returnedOn > todayDate) {
		errors.returnedOn = 'future';
	} else if (input.returnedOn !== null && input.returnedOn < input.issuedOn) {
		errors.returnedOn = 'before_issued';
	}
	const place =
		input.placeId === current.placeId
			? { id: current.placeId, name: current.placeName }
			: await findActiveMaster(db, 'places', input.placeId);
	if (!place) {
		errors.placeId = 'not_found';
	}
	if (Object.keys(errors).length > 0 || !place) {
		throw new ValidationError(errors);
	}

	// The corrected period must not overlap another assignment of the same item.
	const overlap = await db.execute(
		namedStatement(
			`SELECT COUNT(*) AS n FROM assignments
			WHERE item_id = :itemId AND id != :id
				AND issued_on < COALESCE(:returnedOn, '9999-12-31')
				AND COALESCE(returned_on, '9999-12-31') > :issuedOn`,
			{
				itemId: current.itemId,
				id: assignmentId,
				returnedOn: input.returnedOn,
				issuedOn: input.issuedOn,
			},
		),
	);
	if (Number(overlap.rows[0]?.n ?? 0) > 0) {
		throw new AppError(ErrorCode.AssignmentPeriodOverlap);
	}

	const changes: Record<string, [unknown, unknown]> = {};
	if (current.issuedOn !== input.issuedOn) {
		changes.issuedOn = [current.issuedOn, input.issuedOn];
	}
	if (current.returnedOn !== input.returnedOn) {
		changes.returnedOn = [current.returnedOn, input.returnedOn];
	}
	if (current.placeId !== place.id) {
		changes.place = [current.placeName, place.name];
	}
	if (Object.keys(changes).length === 0) {
		throw new AppError(ErrorCode.NothingChanged);
	}

	const [update] = await db.batch(
		[
			namedStatement(
				`UPDATE assignments SET issued_on = :issuedOn, returned_on = :returnedOn,
						place_id = :placeId, place_name = :placeName, version = version + 1, updated_at = :at
					WHERE id = :id AND version = :version`,
				{
					issuedOn: input.issuedOn,
					returnedOn: input.returnedOn,
					placeId: place.id,
					placeName: place.name,
					at: nowIso(),
					id: assignmentId,
					version: input.version,
				},
			),
			eventAfterChangeStatement({
				kind: 'correct',
				item: { id: current.itemId },
				assignmentId,
				subject: { id: current.userId, name: current.userName },
				actor,
				detail: { reason: input.reason, changes },
			}),
		],
		'write',
	);
	if (update.rowsAffected === 0) {
		throw new AppError(ErrorCode.AssignmentVersionConflict);
	}
	return loadAssignment(db, assignmentId);
}
