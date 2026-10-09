import type { Client, InStatement } from '@libsql/client';
import assignmentsFile from '../../../../seed-data/assignments.json';
import itemsFile from '../../../../seed-data/items.json';
import mastersFile from '../../../../seed-data/masters.json';
import devUsersFile from '../../../../seed-data/dev-users.json';
import { addDays, nowIso, today } from '#lib/server/dates.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { unguardedEventStatement } from './events.ts';
import { type ItemFields, itemInsertStatements } from './items.ts';
import { listMaster } from './masters.ts';

// Initial data.
//
// - Default item types and usage places (seed-data/masters.json): the initial
//   entries of the masters screen, inserted at every start into a list that is
//   still empty.
// - The sample ledger (items, assignments, history) is for local preview,
//   tests and screenshots only. The `pnpm dev` launcher asks for it; a deployed
//   app (gateway sign-in) never loads it.
//
// The Japanese text lives in seed-data/*.json; this module is CJK-free. Dates
// in the files are relative ("issued 410 days ago"), so the sample ledger
// always looks current. See seed-data/README.md for the story the data tells.
// Items are written by items.ts `itemInsertStatements`, like every new item.

interface SeedItem {
	tag: string;
	name: string;
	type: string;
	serial?: string;
	purchasedDaysAgo: number;
	storage?: string;
	note?: string;
	suspend?: { reason: 'repair' | 'broken' | 'lost' | 'other'; note: string; daysAgo: number };
}

interface SeedAssignment {
	tag: string;
	user: string;
	place: string;
	issuedDaysAgo: number;
	dueDaysAgo?: number;
	note?: string;
	returnedDaysAgo?: number;
	returnKind?: 'returned' | 'collected';
	returnNote?: string;
	/** This (still held) assignment was exchanged for the open one of that tag. */
	replacedByTag?: string;
}

interface SeedPerson {
	id: string;
	name: string;
	email: string;
}

/** A morning timestamp on a local date (10:00 + minutes, Japan time). */
function atOn(date: string, minutes: number): string {
	const d = new Date(`${date}T01:00:00.000Z`);
	d.setUTCMinutes(d.getUTCMinutes() + minutes);
	return d.toISOString();
}

async function isEmpty(db: Client, table: 'item_types' | 'places' | 'items'): Promise<boolean> {
	const res = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
	return Number(res.rows[0]?.n ?? 0) === 0;
}

/**
 * Default item types and usage places. A list that already has rows is left
 * alone (an admin may have renamed or deactivated the defaults). Unique names
 * make a concurrent start by another container harmless.
 */
export async function ensureDefaultMasters(db: Client): Promise<void> {
	const ts = nowIso();
	const statements: InStatement[] = [];
	if (await isEmpty(db, 'item_types')) {
		mastersFile.types.forEach((name, i) => {
			statements.push(
				namedStatement(
					`INSERT INTO item_types (name, active, sort_order, created_at, updated_at)
					VALUES (:name, 1, :sortOrder, :at, :at) ON CONFLICT (name) DO NOTHING`,
					{ name, sortOrder: i + 1, at: ts },
				),
			);
		});
	}
	if (await isEmpty(db, 'places')) {
		mastersFile.places.forEach((name, i) => {
			statements.push(
				namedStatement(
					`INSERT INTO places (name, active, sort_order, created_at, updated_at)
					VALUES (:name, 1, :sortOrder, :at, :at) ON CONFLICT (name) DO NOTHING`,
					{ name, sortOrder: i + 1, at: ts },
				),
			);
		});
	}
	if (statements.length > 0) {
		await db.batch(statements, 'write');
	}
}

/** Load the sample ledger into a database that has no items yet. */
export async function seedSampleDataIfEmpty(db: Client): Promise<boolean> {
	if (!(await isEmpty(db, 'items'))) {
		return false;
	}
	await seedSampleData(db);
	return true;
}

/** The sample ledger: items, current and past assignments, and their history. */
export async function seedSampleData(db: Client): Promise<void> {
	const base = today();
	const admin = itemsFile.admin;
	const items = itemsFile.items as SeedItem[];
	const assignments = assignmentsFile.assignments as SeedAssignment[];
	// The people of the records: the local roster (who `pnpm dev` signs in and
	// lists as members) and the former members, who appear in the records only.
	const people = new Map<string, SeedPerson>(
		[...devUsersFile.users, ...assignmentsFile.former].map((p) => [p.id, p]),
	);

	const typeIds = new Map((await listMaster(db, 'types')).map((t) => [t.name, t.id]));

	const statements: InStatement[] = [];
	let minute = 0;

	for (const item of items) {
		const purchased = addDays(base, -item.purchasedDaysAgo);
		const fields: ItemFields = {
			assetTag: item.tag,
			name: item.name,
			typeId: typeIds.get(item.type) ?? null,
			serialNo: item.serial ?? null,
			purchasedOn: purchased,
			storageLocation: item.storage ?? null,
			note: item.note ?? null,
		};
		statements.push(...itemInsertStatements(fields, admin, atOn(purchased, minute++)));
		if (item.suspend) {
			const suspendedAt = atOn(addDays(base, -item.suspend.daysAgo), 30);
			statements.push(
				namedStatement(
					`UPDATE items SET suspended_reason = :reason, suspended_note = :note, updated_at = :at
					WHERE asset_tag = :tag`,
					{ reason: item.suspend.reason, note: item.suspend.note, at: suspendedAt, tag: item.tag },
				),
				unguardedEventStatement({
					kind: 'suspend',
					item: { assetTag: item.tag },
					actor: admin,
					detail: { reason: item.suspend.reason, note: item.suspend.note },
					at: suspendedAt,
				}),
			);
		}
	}

	// Ids first, so an exchanged assignment can point at its replacement.
	const ids = new Map<SeedAssignment, string>(assignments.map((a) => [a, crypto.randomUUID()]));
	const openIdByTag = new Map<string, string>();
	for (const a of assignments) {
		if (a.returnedDaysAgo === undefined) {
			openIdByTag.set(a.tag, ids.get(a) as string);
		}
	}

	for (const a of assignments) {
		const person = people.get(a.user);
		if (!person) {
			throw new Error(`seed: unknown person ${a.user}`);
		}
		const id = ids.get(a) as string;
		const issuedOn = addDays(base, -a.issuedDaysAgo);
		const issuedAt = atOn(issuedOn, minute++);
		const returnedOn = a.returnedDaysAgo === undefined ? null : addDays(base, -a.returnedDaysAgo);
		const returnedAt = returnedOn ? atOn(returnedOn, minute++) : null;
		const replacedBy = a.replacedByTag ? (openIdByTag.get(a.replacedByTag) ?? null) : null;
		const replacement = a.replacedByTag
			? assignments.find((x) => x.tag === a.replacedByTag && x.returnedDaysAgo === undefined)
			: undefined;
		const updatedAt =
			returnedAt ?? (replacement ? atOn(addDays(base, -replacement.issuedDaysAgo), 59) : issuedAt);
		// Who recorded the return: the holder, or the admin who collected it.
		const returner = returnedOn ? (a.returnKind === 'collected' ? admin : person) : null;
		statements.push(
			namedStatement(
				`INSERT INTO assignments (id, item_id, user_id, user_name, user_email, place_id,
					place_name, issued_on, due_on, note, issued_by_id, issued_by_name, returned_on,
					return_kind, returned_by_id, returned_by_name, return_note, pending_return,
					replaced_by, version, created_at, updated_at)
				VALUES (:id, (SELECT id FROM items WHERE asset_tag = :tag), :userId, :userName,
					:userEmail, (SELECT id FROM places WHERE name = :place), :place, :issuedOn, :dueOn,
					:note, :adminId, :adminName, :returnedOn, :returnKind, :returnedById,
					:returnedByName, :returnNote, :pendingReturn, :replacedBy, 1, :createdAt, :updatedAt)`,
				{
					id,
					tag: a.tag,
					userId: person.id,
					userName: person.name,
					userEmail: person.email,
					place: a.place,
					issuedOn,
					dueOn: a.dueDaysAgo === undefined ? null : addDays(base, -a.dueDaysAgo),
					note: a.note ?? null,
					adminId: admin.id,
					adminName: admin.name,
					returnedOn,
					returnKind: returnedOn ? (a.returnKind ?? 'returned') : null,
					returnedById: returner?.id ?? null,
					returnedByName: returner?.name ?? null,
					returnNote: a.returnNote ?? null,
					pendingReturn: replacedBy ? 1 : 0,
					replacedBy,
					createdAt: issuedAt,
					updatedAt,
				},
			),
		);
		statements.push(
			unguardedEventStatement({
				kind: 'issue',
				item: { assetTag: a.tag },
				assignmentId: id,
				subject: { id: person.id, name: person.name },
				actor: admin,
				detail: { place: a.place, issuedOn, note: a.note ?? null },
				at: issuedAt,
			}),
		);
		if (returnedOn && returnedAt) {
			const collected = a.returnKind === 'collected';
			statements.push(
				unguardedEventStatement({
					kind: 'return',
					item: { assetTag: a.tag },
					assignmentId: id,
					subject: { id: person.id, name: person.name },
					actor: collected ? admin : { id: person.id, name: person.name },
					detail: {
						returnKind: collected ? 'collected' : 'returned',
						returnedOn,
						note: a.returnNote ?? null,
					},
					at: returnedAt,
				}),
			);
		}
	}

	await db.batch(statements, 'write');
}
