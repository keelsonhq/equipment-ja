import { describe, expect, it } from 'vite-plus/test';
import { ApiError } from '#lib/api.ts';
import { dateProblem, splitError } from '#lib/forms.ts';

// splitError: field errors the form shows stay on their fields; any other
// field error becomes the general error. dateProblem: the one check every date
// input of the dialogs makes.

const failed = (fields: Record<string, string>) =>
	new ApiError(422, 'validation_failed', fields, null);

describe('splitError', () => {
	it('keeps the reasons of the fields the form shows', () => {
		expect(splitError(failed({ name: 'required', note: 'too_long' }), ['name', 'note'])).toEqual({
			fields: { name: 'required', note: 'too_long' },
			general: null,
		});
	});

	it('turns an error on a field the form does not show into validation_failed', () => {
		expect(splitError(failed({ name: 'required', userId: 'not_found' }), ['name'])).toEqual({
			fields: { name: 'required' },
			general: 'validation_failed',
		});
	});

	it('uses the code the caller gives for a hidden field, nested or not', () => {
		const hidden = { userId: 'member_not_found', itemId: 'item_not_found' };
		expect(splitError(failed({ userId: 'not_found' }), ['name'], hidden).general).toBe(
			'member_not_found',
		);
		expect(splitError(failed({ 'assignment.itemId': 'invalid' }), [], hidden).general).toBe(
			'item_not_found',
		);
		expect(splitError(failed({ placeId: 'required' }), [], hidden).general).toBe(
			'validation_failed',
		);
	});

	it('passes other failures through as their code', () => {
		expect(splitError(new ApiError(409, 'item_already_assigned'), ['name'])).toEqual({
			fields: {},
			general: 'item_already_assigned',
		});
		expect(splitError(new TypeError('offline'), []).general).toBe('network_error');
	});
});

describe('dateProblem', () => {
	const TODAY = '2025-06-10';
	const ISSUED = '2025-06-01';

	it.each([
		// An issue date: required, not in the future.
		['2025-06-10', { today: TODAY }, false],
		['2025-06-11', { today: TODAY }, 'future'],
		['', { today: TODAY }, 'required'],
		// A return date: also not before the issue date.
		['2025-06-01', { today: TODAY, notBefore: ISSUED }, false],
		['2025-05-31', { today: TODAY, notBefore: ISSUED }, 'before_issued'],
		['2025-06-11', { today: TODAY, notBefore: ISSUED }, 'future'],
		['', { today: TODAY, notBefore: ISSUED }, 'required'],
		// No issue date yet (empty, or no item chosen): only the other checks.
		['2025-05-31', { today: TODAY, notBefore: '' }, false],
		['2025-05-31', { today: TODAY, notBefore: null }, false],
		['2025-05-31', { today: TODAY, notBefore: undefined }, false],
		// A due date: optional, may be in the future, not before the issue date.
		['', { optional: true, notBefore: ISSUED }, false],
		['2026-01-01', { optional: true, notBefore: ISSUED }, false],
		['2025-05-31', { optional: true, notBefore: ISSUED }, 'before_issued'],
	] as const)('%s with %o -> %s', (value, opts, expected) => {
		expect(dateProblem(value, opts)).toBe(expected);
	});
});
