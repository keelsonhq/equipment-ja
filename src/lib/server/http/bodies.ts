import type { CorrectInput, IssueInput, ReturnInput } from '#lib/server/domain/assignments.ts';
import {
	type ItemAssignmentInput,
	type ItemFields,
	SUSPEND_REASONS,
	type SuspendReason,
} from '#lib/server/domain/items.ts';
import {
	ASSIGNMENT_ID_MAX,
	CORRECTION_REASON_MAX,
	ISSUE_NOTE_MAX,
	ITEM_LIMITS,
	MASTER_NAME_MAX,
	RETURN_NOTE_MAX,
	SUSPEND_NOTE_MAX,
	USER_ID_MAX,
} from '#lib/limits.ts';
import { asBody, Checker } from './validate.ts';

// JSON request bodies -> business-layer inputs. Every field problem is
// collected and reported at once as `validation_failed` + `fields` (field
// names match the request body keys; nested blocks use `block.key`). Business
// rules (dates in the future, duplicate asset tags, ...) are checked in the
// business layer and reported the same way.

function itemFields(c: Checker): ItemFields {
	return {
		assetTag: c.text('assetTag', { max: ITEM_LIMITS.assetTag, required: true }),
		name: c.text('name', { max: ITEM_LIMITS.name, required: true }),
		typeId: c.id('typeId'),
		serialNo: c.text('serialNo', { max: ITEM_LIMITS.serialNo }),
		purchasedOn: c.date('purchasedOn'),
		storageLocation: c.text('storageLocation', { max: ITEM_LIMITS.storageLocation }),
		note: c.text('note', { max: ITEM_LIMITS.note }),
	};
}

/**
 * Register body: the item fields plus an optional `assignment` block (issue the
 * new item right away). Errors in the block are reported as `assignment.<key>`.
 */
export function readItemCreate(value: unknown): {
	fields: ItemFields;
	assignment: ItemAssignmentInput | null;
} {
	const c = new Checker(asBody(value));
	const fields = itemFields(c);
	const a = c.nested('assignment');
	const assignment: ItemAssignmentInput | null = a && {
		userId: a.text('userId', { max: USER_ID_MAX, required: true }),
		placeId: a.id('placeId', { required: true }),
		issuedOn: a.date('issuedOn', { required: true }),
		dueOn: a.date('dueOn'),
		note: a.text('note', { max: ISSUE_NOTE_MAX }),
	};
	c.done();
	return { fields, assignment };
}

export function readItemEdit(value: unknown): { fields: ItemFields; version: number } {
	const c = new Checker(asBody(value));
	const fields = itemFields(c);
	const version = c.version();
	c.done();
	return { fields, version };
}

export function readIssueInput(value: unknown): IssueInput {
	const c = new Checker(asBody(value));
	const input: IssueInput = {
		itemId: c.id('itemId', { required: true }),
		userId: c.text('userId', { max: USER_ID_MAX }),
		placeId: c.id('placeId', { required: true }),
		issuedOn: c.date('issuedOn', { required: true }),
		dueOn: c.date('dueOn'),
		note: c.text('note', { max: ISSUE_NOTE_MAX }),
		exchangeFrom: c.text('exchangeFrom', { max: ASSIGNMENT_ID_MAX }),
	};
	c.done();
	return input;
}

function suspendFields(c: Checker): { reason: SuspendReason; note: string | null } {
	return {
		reason: c.oneOf('reason', SUSPEND_REASONS),
		note: c.text('note', { max: SUSPEND_NOTE_MAX }),
	};
}

export function readSuspend(value: unknown): { reason: SuspendReason; note: string | null } {
	const c = new Checker(asBody(value));
	const suspend = suspendFields(c);
	c.done();
	return suspend;
}

export function readReturnInput(value: unknown): ReturnInput {
	const c = new Checker(asBody(value));
	const returnedOn = c.date('returnedOn', { required: true });
	const note = c.text('note', { max: RETURN_NOTE_MAX });
	const storageLocation = c.text('storageLocation', { max: ITEM_LIMITS.storageLocation });
	const s = c.nested('suspend');
	const input: ReturnInput = { returnedOn, note, storageLocation, suspend: s && suspendFields(s) };
	c.done();
	return input;
}

export function readCorrectInput(value: unknown): CorrectInput {
	const c = new Checker(asBody(value));
	const input: CorrectInput = {
		issuedOn: c.date('issuedOn', { required: true }),
		returnedOn: c.date('returnedOn'),
		placeId: c.id('placeId', { required: true }),
		reason: c.text('reason', { max: CORRECTION_REASON_MAX, required: true }),
		version: c.version(),
	};
	c.done();
	return input;
}

export function readMasterPatch(value: unknown): { name?: string; active?: boolean } {
	const body = asBody(value);
	const c = new Checker(body);
	const patch: { name?: string; active?: boolean } = {};
	if (body.name !== undefined) {
		patch.name = c.text('name', { max: MASTER_NAME_MAX, required: true });
	}
	const active = c.flag('active');
	if (active !== null) {
		patch.active = active;
	}
	c.done();
	return patch;
}

export function readMasterName(value: unknown): string {
	const c = new Checker(asBody(value));
	const name = c.text('name', { max: MASTER_NAME_MAX, required: true });
	c.done();
	return name;
}
