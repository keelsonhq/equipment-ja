import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	issueBody,
	issueChecks,
	issueFieldNames,
	type IssueValues,
	newIssue,
} from '#lib/components/assignments/issueForm.ts';
import { check } from '#lib/forms.ts';
import type { Person } from '#lib/server/domain/directory.ts';
import { masters } from '#lib/state/masters.svelte.ts';

// The issue inputs shared by the issue dialog and "issue on registration":
// the default place, the client-side checks, the fields the block shows and
// the request body. The register form nests them under `assignment.`.

const TODAY = '2025-06-01';
const PERSON: Person = {
	id: 'u-1',
	name: 'Sato',
	email: 'sato@example.com',
	imageUrl: null,
};

function place(id: number, active: boolean) {
	return { id, name: `Place ${id}`, active, sortOrder: id, usage: 0 };
}

function values(overrides: Partial<IssueValues> = {}): IssueValues {
	return { ...newIssue(TODAY), person: PERSON, placeId: '2', ...overrides };
}

afterEach(() => {
	masters.places = [];
});

describe('newIssue', () => {
	it('starts at the first active place, issued today, nobody chosen', () => {
		masters.places = [place(1, false), place(2, true), place(3, true)];
		expect(newIssue(TODAY)).toEqual({
			person: null,
			placeId: '2',
			issuedOn: TODAY,
			dueOn: '',
			note: '',
		});
	});

	it('leaves the place empty when none is active', () => {
		masters.places = [place(1, false)];
		expect(newIssue(TODAY).placeId).toBe('');
	});
});

describe('issueChecks', () => {
	it('passes complete inputs', () => {
		expect(check(issueChecks(values({ dueOn: '2025-07-01' }), TODAY))).toEqual({});
	});

	it('asks for the person only when it is chosen here', () => {
		expect(check(issueChecks(values({ person: null }), TODAY))).toEqual({ userId: 'required' });
		expect(check(issueChecks(values({ person: null }), TODAY, { pickPerson: false }))).toEqual({});
	});

	it('checks the place and the dates', () => {
		expect(
			check(issueChecks(values({ placeId: '', issuedOn: '', dueOn: '2025-05-01' }), TODAY)),
		).toEqual({ placeId: 'required', issuedOn: 'required' });
		expect(
			check(issueChecks(values({ issuedOn: '2025-06-02', dueOn: '2025-06-01' }), TODAY)),
		).toEqual({ issuedOn: 'future', dueOn: 'before_issued' });
	});

	it('names the fields with the block prefix', () => {
		expect(
			check(issueChecks(values({ person: null, placeId: '' }), TODAY, { prefix: 'assignment.' })),
		).toEqual({ 'assignment.userId': 'required', 'assignment.placeId': 'required' });
	});
});

describe('issueFieldNames', () => {
	it('lists the fields the block shows', () => {
		expect(issueFieldNames()).toEqual(['userId', 'placeId', 'issuedOn', 'dueOn', 'note']);
		expect(issueFieldNames({ pickPerson: false })).toEqual([
			'placeId',
			'issuedOn',
			'dueOn',
			'note',
		]);
		expect(issueFieldNames({ prefix: 'assignment.' })).toEqual([
			'assignment.userId',
			'assignment.placeId',
			'assignment.issuedOn',
			'assignment.dueOn',
			'assignment.note',
		]);
	});
});

describe('issueBody', () => {
	it('sends the place as a number and an empty due date as null', () => {
		expect(issueBody(values({ note: 'Spare' }))).toEqual({
			placeId: 2,
			issuedOn: TODAY,
			dueOn: null,
			note: 'Spare',
		});
		expect(issueBody(values({ dueOn: '2025-07-01' })).dueOn).toBe('2025-07-01');
	});
});
