// The inputs of an issue as a form holds them, shared by the issue dialog and
// "issue on registration" in the register form (IssueFields.svelte draws
// them): the starting values, the client-side checks, the fields the block
// shows and the request body. The register form nests them under `assignment.`.

import type { Person } from '#lib/server/domain/people.ts';
import { dateProblem } from '#lib/forms.ts';
import { masters } from '#lib/state/masters.svelte.ts';

/** The issue inputs as the dialog holds them (form values, so strings). */
export interface IssueValues {
	person: Person | null;
	placeId: string;
	issuedOn: string;
	dueOn: string;
	note: string;
}

/**
 * Where the block sits in its form. `prefix`: the field names' block
 * (`assignment.` when nested in the register form). `pickPerson`: the
 * person is chosen here (false when the screen fixed it).
 */
export interface IssueBlock {
	prefix?: string;
	pickPerson?: boolean;
}

/** Places offered for a new issue; the first is the default. */
export function activePlaces() {
	return masters.places.filter((p) => p.active);
}

/** Fresh inputs: nobody chosen, the first active place, issued `today`. */
export function newIssue(today: string): IssueValues {
	const place = activePlaces()[0];
	return {
		person: null,
		placeId: place ? String(place.id) : '',
		issuedOn: today,
		dueOn: '',
		note: '',
	};
}

/** The client-side checks (DESIGN.md §8.6), for `check()` of forms.ts. */
export function issueChecks(
	values: IssueValues,
	today: string,
	{ prefix = '', pickPerson = true }: IssueBlock = {},
): Record<string, string | false> {
	const { person, placeId, issuedOn, dueOn } = values;
	return {
		[`${prefix}userId`]: pickPerson && !person && 'required',
		[`${prefix}placeId`]: placeId === '' && 'required',
		[`${prefix}issuedOn`]: dateProblem(issuedOn, { today }),
		[`${prefix}dueOn`]: dateProblem(dueOn, { optional: true, notBefore: issuedOn }),
	};
}

/** The fields the block shows, for `splitError()` of forms.ts. */
export function issueFieldNames({ prefix = '', pickPerson = true }: IssueBlock = {}): string[] {
	return [...(pickPerson ? ['userId'] : []), 'placeId', 'issuedOn', 'dueOn', 'note'].map(
		(name) => `${prefix}${name}`,
	);
}

/** The request body's issue part (the person is the dialog's to send). */
export function issueBody(values: IssueValues) {
	return {
		placeId: Number(values.placeId),
		issuedOn: values.issuedOn,
		dueOn: values.dueOn || null,
		note: values.note,
	};
}
