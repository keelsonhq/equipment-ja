import * as assignments from '#lib/server/domain/assignments.ts';
import * as items from '#lib/server/domain/items.ts';
import * as masters from '#lib/server/domain/masters.ts';
import * as people from '#lib/server/domain/people.ts';
import { AppError, ErrorCode } from '#lib/server/errors.ts';
import {
	ISSUE_NOTE_MAX,
	ITEM_LIMITS,
	MASTER_NAME_MAX,
	MCP_LIST_LIMIT,
	PERSON_REF_MAX,
	RETURN_NOTE_MAX,
	SEARCH_MAX,
	SUSPEND_NOTE_MAX,
} from '#lib/limits.ts';
import { resolveAll, ToolArgs } from './args.ts';
import { resolvePersonRef } from './people.ts';
import {
	masterByName,
	openAssignmentByTag,
	placeOrFirst,
	typeFilter,
	withArgNames,
} from './refs.ts';
import type { McpToolContext } from './registry.ts';

// The AI assistant (MCP) tools, one function per tool, named after it
// (issue_item -> issueItem). Each one reads its arguments, resolves names
// (asset tag, person, type, place) and calls the business layer (domain/),
// which keeps doing every authorization and integrity check — no SQL here.
// The domain modules are imported whole (`assignments.issueItem`), so a tool
// and the business function it calls can share a name.
//
// Items are named by asset tag: items.getItemByTag checks the admin (admin
// tools), items.loadItemByTag does not (tools members may use; the business
// call that follows decides what they may do).
//
// Results are small on purpose: list rows carry the essentials only, long
// text is cut, and lists stop at MCP_LIST_LIMIT with `total` and `truncated`.
// Argument limits come from src/lib/limits.ts (keelson.yaml declares the same
// `maxLength`; tests/mcp-manifest.test.ts checks them).

/** Longest note / suspension detail a tool returns (a longer one is cut and ends in "..."). */
export const TEXT_MAX = 200;

/** Assignments get_item returns, newest first. */
const RECENT_ASSIGNMENTS = 5;

/** The `asset_tag` argument of the tools that act on one item. */
function assetTag(c: ToolArgs): string {
	return c.text('asset_tag', { max: ITEM_LIMITS.assetTag, required: true });
}

// --- Result shapes -----------------------------------------------------------

function cut(text: string | null): string | null {
	return text !== null && text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}...` : text;
}

function listOf<T>(rows: T[], total: number): { items: T[]; total: number; truncated: boolean } {
	return { items: rows, total, truncated: total > rows.length };
}

/** One ledger row. */
function itemRow(v: items.ItemView) {
	return {
		id: v.id,
		asset_tag: v.assetTag,
		name: v.name,
		type: v.typeName,
		status: v.status,
		holder: v.holder?.name ?? null,
		issued_on: v.issuedOn,
		due_on: v.dueOn,
		storage_location: v.storageLocation,
	};
}

/** One assignment (hand-over of an item to a person). */
function assignmentRow(a: assignments.AssignmentView) {
	return {
		asset_tag: a.assetTag,
		item_name: a.itemName,
		person: a.userName,
		email: a.userEmail,
		place: a.placeName,
		issued_on: a.issuedOn,
		due_on: a.dueOn,
		pending_return: a.pendingReturn,
		returned_on: a.returnedOn,
		return_kind: a.returnKind,
	};
}

/** One item a person holds now. */
function holdingRow(h: people.Holding) {
	return {
		asset_tag: h.assetTag,
		name: h.itemName,
		type: h.typeName,
		status: h.status,
		place: h.placeName,
		issued_on: h.issuedOn,
		due_on: h.dueOn,
	};
}

// --- Read tools --------------------------------------------------------------

/** find_items (admin): the ledger, filtered. */
export async function findItems({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const q = c.text('q', { max: SEARCH_MAX });
	const statuses = c.values('status', items.ITEM_STATUSES);
	const typeRef = c.text('type', { max: MASTER_NAME_MAX });
	const holderRef = c.text('holder', { max: PERSON_REF_MAX });
	const limit = c.limit();
	c.done();
	const [type, holder] = await resolveAll([
		() => typeFilter(db, typeRef),
		() =>
			holderRef === null
				? null
				: resolvePersonRef(db, actor, holderRef, { field: 'holder', scope: 'records' }),
	]);
	const page = await items.listItems(db, actor, {
		q,
		statuses,
		typeId: type?.id ?? null,
		noType: false,
		held: false,
		placeId: null,
		memberId: holder?.id ?? null,
		ids: [],
		sort: 'tag',
		dir: 'asc',
		page: 1,
		size: limit,
	});
	return listOf(page.rows.map(itemRow), page.total);
}

/** find_available_items (anyone): items free to take, member-safe columns only. */
export async function findAvailableItems({ db, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const q = c.text('q', { max: SEARCH_MAX });
	const typeRef = c.text('type', { max: MASTER_NAME_MAX });
	const limit = c.limit();
	c.done();
	const type = await typeFilter(db, typeRef);
	const page = await items.listAvailableItems(db, {
		q,
		typeId: type?.id ?? null,
		page: 1,
		size: limit,
	});
	return listOf(
		page.rows.map((r) => ({
			id: r.id,
			asset_tag: r.assetTag,
			name: r.name,
			type: r.typeName,
			storage_location: r.storageLocation,
		})),
		page.total,
	);
}

/** get_item (admin): one item, its current holder and the latest assignments. */
export async function getItem({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const tag = assetTag(c);
	c.done();
	const item = await items.getItemByTag(db, actor, tag);
	const ledger = await assignments.listItemAssignments(db, actor, item.id);
	return {
		id: item.id,
		asset_tag: item.assetTag,
		name: item.name,
		type: item.typeName,
		serial_no: item.serialNo,
		purchased_on: item.purchasedOn,
		storage_location: item.storageLocation,
		note: cut(item.note),
		status: item.status,
		suspended_reason: item.suspendedReason,
		suspended_detail: cut(item.suspendedNote),
		holder: item.holder
			? {
					person: item.holder.name,
					email: item.holder.email,
					place: item.placeName,
					issued_on: item.issuedOn,
					due_on: item.dueOn,
					pending_return: item.pendingReturn,
				}
			: null,
		recent_assignments: ledger.slice(0, RECENT_ASSIGNMENTS).map(assignmentRow),
		assignment_count: ledger.length,
	};
}

/** my_items (anyone): what the caller holds now. */
export async function myItems({ db, actor }: McpToolContext) {
	const me = await people.getMe(db, actor);
	return {
		person: { name: me.person.name, email: me.person.email },
		...listOf(me.holdings.slice(0, MCP_LIST_LIMIT.max).map(holdingRow), me.holdings.length),
	};
}

/** member_items (admin): what one person holds now (former members too). */
export async function memberItems({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const ref = c.text('person', { max: PERSON_REF_MAX, required: true });
	c.done();
	const person = await resolvePersonRef(db, actor, ref, { field: 'person', scope: 'records' });
	const page = await people.getMember(db, actor, person.id);
	return {
		person: {
			id: page.person.id,
			name: page.person.name,
			email: page.person.email,
			membership: page.person.membership,
		},
		...listOf(page.holdings.slice(0, MCP_LIST_LIMIT.max).map(holdingRow), page.holdings.length),
	};
}

/** list_masters (anyone): the names `type` and `place` accept. */
export async function listMasters({ db }: McpToolContext) {
	const { types, places } = await masters.listMasters(db);
	return {
		types: types.filter((t) => t.active).map((t) => t.name),
		places: places.filter((p) => p.active).map((p) => p.name),
	};
}

// --- Write tools -------------------------------------------------------------

/** register_item (admin): one new item, optionally issued in the same transaction. */
export async function registerItem({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const fields = {
		assetTag: assetTag(c),
		name: c.text('name', { max: ITEM_LIMITS.name, required: true }),
		serialNo: c.text('serial_no', { max: ITEM_LIMITS.serialNo }),
		purchasedOn: c.date('purchased_on'),
		storageLocation: c.text('storage_location', { max: ITEM_LIMITS.storageLocation }),
		note: c.text('note', { max: ITEM_LIMITS.note }),
	};
	const typeRef = c.text('type', { max: MASTER_NAME_MAX });
	const a = c.nested('assign_to');
	const assign = a && {
		personRef: a.text('person', { max: PERSON_REF_MAX, required: true }),
		placeRef: a.text('place', { max: MASTER_NAME_MAX }),
		issuedOn: a.dateOrToday('issued_on'),
		dueOn: a.date('due_on'),
		note: a.text('note', { max: ISSUE_NOTE_MAX }),
	};
	c.done();
	const lists = await masters.listMasters(db);
	const [type, place, person] = await resolveAll([
		() =>
			typeRef === null ? null : masterByName(lists.types, typeRef, 'type', { activeOnly: true }),
		() => (assign ? placeOrFirst(lists.places, assign.placeRef, 'assign_to.place') : null),
		() =>
			assign
				? resolvePersonRef(db, actor, assign.personRef, {
						field: 'assign_to.person',
						scope: 'members',
					})
				: null,
	]);
	const item = await withArgNames(() =>
		items.createItem(
			db,
			actor,
			{ ...fields, typeId: type?.id ?? null },
			assign && person && place
				? {
						userId: person.id,
						placeId: place.id,
						issuedOn: assign.issuedOn,
						dueOn: assign.dueOn,
						note: assign.note,
					}
				: null,
		),
	);
	return { item: itemRow(item) };
}

/** issue_item (admin): hand an item to a person, or exchange one they hold. */
export async function issueItem({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const tag = assetTag(c);
	const personRef = c.text('person', { max: PERSON_REF_MAX, required: true });
	const placeRef = c.text('place', { max: MASTER_NAME_MAX });
	const issuedOn = c.dateOrToday('issued_on');
	const dueOn = c.date('due_on');
	const note = c.text('note', { max: ISSUE_NOTE_MAX });
	const exchangeTag = c.text('exchange_for', { max: ITEM_LIMITS.assetTag });
	c.done();
	const [place, person, exchangeFrom] = await resolveAll([
		async () => placeOrFirst((await masters.listMasters(db)).places, placeRef, 'place'),
		() => resolvePersonRef(db, actor, personRef, { field: 'person', scope: 'members' }),
		() => (exchangeTag === null ? null : openAssignmentByTag(db, exchangeTag, 'exchange_for')),
	]);
	const item = await items.getItemByTag(db, actor, tag);
	const assignment = await withArgNames(() =>
		assignments.issueItem(db, actor, {
			itemId: item.id,
			userId: person.id,
			placeId: place.id,
			issuedOn,
			dueOn,
			note,
			exchangeFrom,
		}),
	);
	return { assignment: assignmentRow(assignment), exchanged_for: exchangeTag };
}

/** take_item (anyone): assign a free item to oneself. */
export async function takeItem({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const tag = assetTag(c);
	const placeRef = c.text('place', { max: MASTER_NAME_MAX });
	const issuedOn = c.dateOrToday('issued_on');
	const dueOn = c.date('due_on');
	const note = c.text('note', { max: ISSUE_NOTE_MAX });
	c.done();
	const place = placeOrFirst((await masters.listMasters(db)).places, placeRef, 'place');
	const item = await items.loadItemByTag(db, tag);
	const assignment = await withArgNames(() =>
		assignments.issueItem(db, actor, {
			itemId: item.id,
			userId: null,
			placeId: place.id,
			issuedOn,
			dueOn,
			note,
			exchangeFrom: null,
		}),
	);
	return { assignment: assignmentRow(assignment) };
}

/**
 * return_item (anyone): record the return of an item. The business layer
 * decides who may: the holder for their own item, an admin for anyone's.
 */
export async function returnItem({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const tag = assetTag(c);
	const returnedOn = c.dateOrToday('returned_on');
	const note = c.text('note', { max: RETURN_NOTE_MAX });
	const storageLocation = c.text('storage_location', { max: ITEM_LIMITS.storageLocation });
	const needsRepair = c.flag('needs_repair') === true;
	c.done();
	const item = await items.loadItemByTag(db, tag);
	const assignmentId = item.assignmentId;
	if (assignmentId === null) {
		throw new AppError(ErrorCode.ItemNotAssigned);
	}
	const assignment = await withArgNames(() =>
		assignments.returnAssignment(db, actor, assignmentId, {
			returnedOn,
			note,
			storageLocation,
			// "Needs repair" suspends the item as under repair (the return dialog's default).
			suspend: needsRepair ? { reason: 'repair', note: null } : null,
		}),
	);
	return { assignment: assignmentRow(assignment), suspended: needsRepair };
}

/** suspend_item (admin): take an item out of use (repair, broken, lost, other). */
export async function suspendItem({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const tag = assetTag(c);
	const reason = c.oneOf('reason', items.SUSPEND_REASONS);
	const detail = c.text('detail', { max: SUSPEND_NOTE_MAX });
	c.done();
	const item = await items.getItemByTag(db, actor, tag);
	return { item: itemRow(await items.suspendItem(db, actor, item.id, reason, detail)) };
}

/** resume_item (admin): put a suspended item back into use. */
export async function resumeItem({ db, actor, args }: McpToolContext) {
	const c = new ToolArgs(args);
	const tag = assetTag(c);
	c.done();
	const item = await items.getItemByTag(db, actor, tag);
	return { item: itemRow(await items.resumeItem(db, actor, item.id)) };
}
