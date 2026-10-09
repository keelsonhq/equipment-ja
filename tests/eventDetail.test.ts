import { describe, expect, it } from 'vite-plus/test';
import { type DetailLabels, detailLines } from '#lib/components/events/eventDetail.ts';

// An event's detail as display lines (src/lib/components/events/eventDetail.ts):
// values print as String() prints them, empty ones as the "empty" label, and
// the words come from the caller's labels (English here: no CJK in tests).

const LABELS: DetailLabels = {
	fields: {
		note: 'Note',
		typeId: 'Type',
		place: 'Place',
		fileName: 'File',
		created: 'Created',
		assigned: 'Issued',
		excluded: 'Excluded',
		addedTypes: 'Added types',
	},
	reasons: { broken: 'Broken' },
	returnKinds: { collected: 'Collected by an admin' },
	exchange: 'Issued in an exchange',
	arrow: ' -> ',
	separator: ': ',
	empty: '(none)',
};

describe('detailLines', () => {
	it('prints the changes of an edit, empty values as the empty label', () => {
		const changes = { note: ['', 'Cracked'], typeId: [3, null], active: [true, false] };
		expect(detailLines('edit', { changes }, LABELS)).toEqual([
			'Note: (none) -> Cracked',
			'Type: 3 -> (none)',
			'active: true -> false',
		]);
	});

	it('prints the facts of an import, numbers and zero included, lists joined', () => {
		const detail = {
			fileName: 'items.csv',
			created: 12,
			assigned: 0,
			excluded: 1,
			addedTypes: ['Tablet', 'Monitor'],
			addedPlaces: [],
			failedFromLine: null,
		};
		expect(detailLines('import', detail, LABELS)).toEqual([
			'File: items.csv',
			'Created: 12',
			'Issued: 0',
			'Excluded: 1',
			'Added types: Tablet / Monitor',
		]);
	});

	it('names what the label tables know and keeps the code of what they do not', () => {
		expect(detailLines('suspend', { reason: 'broken', note: '' }, LABELS)).toEqual([
			'reason: Broken',
		]);
		expect(detailLines('return', { returnKind: 'collected', note: 'Box' }, LABELS)).toEqual([
			'Collected by an admin',
			'Note: Box',
		]);
		expect(detailLines('return', { returnKind: 'lost_in_post' }, LABELS)).toEqual(['lost_in_post']);
		expect(detailLines('issue', { exchangeFrom: 'a-1', place: 'Office' }, LABELS)).toEqual([
			'Issued in an exchange',
			'Place: Office',
		]);
		expect(detailLines('issue', null, LABELS)).toEqual([]);
	});
});
