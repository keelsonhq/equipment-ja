import type { Client } from '@libsql/client';
import {
	type AssignmentView,
	listPersonAssignments,
	withUserDirectoryInfo,
} from './assignments.ts';
import type { Actor } from '#lib/server/auth/actor.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { today } from '#lib/server/dates.ts';
import { AppError, ErrorCode } from '#lib/server/errors.ts';
import { num, str, strOrNull } from '#lib/server/db/rows.ts';
import {
	byName,
	imageUrlOf,
	issuablePeople,
	type Membership,
	membershipOf,
	type PeopleState,
	type Person,
	type PersonSummary,
	peopleIndex,
} from './directory.ts';

// People as the screens see them: the employee picker's search, the members
// screen (everyone with their holding counts) and a person's page. Who the
// people are (the directory, the index) is directory.ts.

// The picker's rows are directory people; the screens import the type from here.
export type { Person };

/** Employee picker candidates (GET /api/members/search). */
export interface PeopleSearch {
	state: PeopleState;
	items: Person[];
}

/**
 * Employee picker search (admin): members whose name or email contains `q`.
 * When the directory is not set up, `state` tells the UI to show the setup
 * guidance instead — the app never invents people of its own.
 */
export async function searchPeople(actor: Actor, q: string, limit = 20): Promise<PeopleSearch> {
	requireAdmin(actor);
	const { state, people } = await issuablePeople(actor);
	const term = q.trim().toLowerCase();
	const items = people
		.filter(
			(p) =>
				term === '' ||
				p.name.toLowerCase().includes(term) ||
				(p.email ?? '').toLowerCase().includes(term),
		)
		.slice(0, limit);
	return { state, items };
}

// --- Members screen ----------------------------------------------------------

export const MEMBER_SORTS = ['name', 'email', 'assigned', 'pending', 'updated'] as const;
export type MemberSort = (typeof MEMBER_SORTS)[number];

export interface MemberRow {
	id: string;
	name: string;
	email: string | null;
	imageUrl: string | null;
	membership: Membership;
	assigned: number;
	pending: number;
	lastActivity: string | null;
}

interface RecordStats {
	name: string;
	email: string | null;
	assigned: number;
	pending: number;
	lastActivity: string | null;
}

async function recordStats(db: Client): Promise<Map<string, RecordStats>> {
	const res = await db.execute(`SELECT a.user_id,
			(SELECT b.user_name FROM assignments b WHERE b.user_id = a.user_id
				ORDER BY b.issued_on DESC, b.created_at DESC LIMIT 1) AS user_name,
			(SELECT b.user_email FROM assignments b WHERE b.user_id = a.user_id
				ORDER BY b.issued_on DESC, b.created_at DESC LIMIT 1) AS user_email,
			SUM(CASE WHEN a.returned_on IS NULL AND a.pending_return = 0 THEN 1 ELSE 0 END) AS assigned,
			SUM(CASE WHEN a.returned_on IS NULL AND a.pending_return = 1 THEN 1 ELSE 0 END) AS pending,
			MAX(a.updated_at) AS last_activity
		FROM assignments a GROUP BY a.user_id`);
	const out = new Map<string, RecordStats>();
	for (const r of res.rows) {
		out.set(str(r, 'user_id'), {
			name: str(r, 'user_name'),
			email: strOrNull(r, 'user_email'),
			assigned: num(r, 'assigned'),
			pending: num(r, 'pending'),
			lastActivity: strOrNull(r, 'last_activity'),
		});
	}
	return out;
}

/** One page of the members screen (GET /api/members). */
export interface MemberList {
	rows: MemberRow[];
	total: number;
	state: PeopleState;
}

export interface MemberQuery {
	q: string | null;
	holdingOnly: boolean;
	sort: MemberSort;
	dir: 'asc' | 'desc';
	page: number;
	size: number;
}

// Every directory member plus everyone who appears only in
// the records, with their holding counts.
async function memberRows(db: Client): Promise<{ state: PeopleState; rows: MemberRow[] }> {
	const [index, stats] = await Promise.all([peopleIndex(), recordStats(db)]);
	const rows = new Map<string, MemberRow>();
	for (const p of index.people) {
		const s = stats.get(p.id);
		rows.set(p.id, {
			id: p.id,
			name: p.name,
			email: p.email,
			imageUrl: p.imageUrl,
			membership: 'member',
			assigned: s?.assigned ?? 0,
			pending: s?.pending ?? 0,
			lastActivity: s?.lastActivity ?? null,
		});
	}
	for (const [id, s] of stats) {
		if (rows.has(id)) {
			continue;
		}
		rows.set(id, {
			id,
			name: s.name,
			email: s.email,
			imageUrl: null,
			membership: membershipOf(index, id),
			assigned: s.assigned,
			pending: s.pending,
			lastActivity: s.lastActivity,
		});
	}
	return { state: index.state, rows: [...rows.values()] };
}

/**
 * The members screen (admin): every directory member plus everyone who appears
 * in the records, with their holding counts. Paged in memory — a workspace
 * directory is at most a few thousand people.
 */
export async function listMembersPage(
	db: Client,
	actor: Actor,
	query: MemberQuery,
): Promise<MemberList> {
	requireAdmin(actor);
	const { state, rows } = await memberRows(db);
	const term = query.q?.trim().toLowerCase() ?? '';
	const list = rows.filter(
		(r) =>
			(!query.holdingOnly || r.assigned + r.pending > 0) &&
			(term === '' ||
				r.name.toLowerCase().includes(term) ||
				(r.email ?? '').toLowerCase().includes(term)),
	);
	const sign = query.dir === 'desc' ? -1 : 1;
	const compare: Record<MemberSort, (a: MemberRow, b: MemberRow) => number> = {
		name: byName,
		email: (a, b) => (a.email ?? '').localeCompare(b.email ?? ''),
		assigned: (a, b) => a.assigned - b.assigned,
		pending: (a, b) => a.pending - b.pending,
		updated: (a, b) => (a.lastActivity ?? '').localeCompare(b.lastActivity ?? ''),
	};
	list.sort((a, b) => sign * compare[query.sort](a, b) || byName(a, b));
	const start = (query.page - 1) * query.size;
	return {
		rows: list.slice(start, start + query.size),
		total: list.length,
		state,
	};
}

/**
 * Everyone the members screen lists, in name order and without paging (admin):
 * the AI assistant looks up people who appear only in the records too.
 */
export async function allPeople(
	db: Client,
	actor: Actor,
): Promise<{ state: PeopleState; people: PersonSummary[] }> {
	requireAdmin(actor);
	const { state, rows } = await memberRows(db);
	return { state, people: rows.sort(byName) };
}

/** A currently held item on a person's page (two-tier table, DESIGN.md §9-C). */
export interface Holding {
	assignmentId: string;
	itemId: number;
	assetTag: string;
	itemName: string;
	typeName: string | null;
	placeName: string | null;
	issuedOn: string;
	dueOn: string | null;
	status: 'assigned' | 'pending_return' | 'overdue' | 'suspended';
	suspendedReason: string | null;
	pendingReturn: boolean;
	version: number;
}

function holdingsOf(ledger: AssignmentView[]): Holding[] {
	const todayDate = today();
	return ledger
		.filter((a) => a.returnedOn === null)
		.map((a) => ({
			assignmentId: a.id,
			itemId: a.itemId,
			assetTag: a.assetTag,
			itemName: a.itemName,
			typeName: a.typeName,
			placeName: a.placeName,
			issuedOn: a.issuedOn,
			dueOn: a.dueOn,
			status: a.suspendedReason
				? 'suspended'
				: a.pendingReturn
					? 'pending_return'
					: a.dueOn !== null && a.dueOn < todayDate
						? 'overdue'
						: 'assigned',
			suspendedReason: a.suspendedReason,
			pendingReturn: a.pendingReturn,
			version: a.version,
		}));
}

export interface PersonPage {
	person: {
		id: string;
		name: string;
		email: string | null;
		imageUrl: string | null;
		membership: Membership;
	};
	holdings: Holding[];
	ledger: AssignmentView[];
}

/** Another person's page (admin only). */
export async function getMember(db: Client, actor: Actor, userId: string): Promise<PersonPage> {
	requireAdmin(actor);
	const [index, ledger] = await Promise.all([peopleIndex(), listPersonAssignments(db, userId)]);
	const person = index.byId.get(userId);
	if (!person && ledger.length === 0 && userId !== actor.id) {
		throw new AppError(ErrorCode.MemberNotFound);
	}
	const latest = ledger[0];
	return {
		person: {
			id: userId,
			name: person?.name ?? latest?.userName ?? (userId === actor.id ? actor.name : userId),
			email: person?.email ?? latest?.userEmail ?? (userId === actor.id ? actor.email : null),
			imageUrl: imageUrlOf(index, userId),
			membership: userId === actor.id ? 'member' : membershipOf(index, userId),
		},
		holdings: holdingsOf(ledger),
		ledger: withUserDirectoryInfo(index, ledger),
	};
}

/** The caller's own page: anyone may read their own holdings and ledger. */
export async function getMe(db: Client, actor: Actor): Promise<PersonPage> {
	const [index, ledger] = await Promise.all([peopleIndex(), listPersonAssignments(db, actor.id)]);
	return {
		person: {
			id: actor.id,
			name: actor.name,
			email: actor.email,
			imageUrl: imageUrlOf(index, actor.id),
			membership: 'member',
		},
		holdings: holdingsOf(ledger),
		ledger: withUserDirectoryInfo(index, ledger),
	};
}
