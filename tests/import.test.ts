import type { Client } from '@libsql/client';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { IMPORT_ROWS_MAX } from '#lib/limits.ts';
import { CSV_COLUMNS, CSV_READONLY_COLUMNS } from '#lib/server/content.ts';
import { decodeCsv, headerField, parseCsv, unguard } from '#lib/server/import/csv.ts';
import { listEvents } from '#lib/server/domain/events.ts';
import {
	type ImportOptions,
	type ImportPreview,
	judgeRow,
	previewImport,
	type RowContext,
	runImport,
} from '#lib/server/import/importer.ts';
import { findItem, listItems } from '#lib/server/domain/items.ts';
import { listMasters, type MasterEntry, updateMaster } from '#lib/server/domain/masters.ts';
import { parseEventQuery, parseItemQuery } from '#lib/server/http/queries.ts';
import * as executeRoute from '../src/routes/api/import/execute/+server.ts';
import * as previewRoute from '../src/routes/api/import/preview/+server.ts';
import * as templateRoute from '../src/routes/api/import/template/+server.ts';
import * as exportRoute from '../src/routes/api/items/export/+server.ts';
import {
	ADMIN,
	cleanupDbs,
	directoryPerson,
	expectError,
	freshDb,
	MEMBER,
	OTHER,
} from './support/harness.ts';
import { addItem, FUTURE, PAST } from './support/helpers.ts';
import { as, call, type Handler } from './support/http.ts';

// CSV import (DESIGN.md §9-H): decoding and parsing, row judgments, the
// import itself, and the HTTP surface. Japanese header labels come from
// content.ts; other non-ASCII text is written with \u escapes.

afterEach(() => {
	cleanupDbs();
	vi.restoreAllMocks();
});

const H = CSV_COLUMNS;
const ON: ImportOptions = { autoAddMasters: true, unassignUnknown: true };
const OFF: ImportOptions = { autoAddMasters: false, unassignUnknown: false };

/** A CSV file (UTF-8 with a BOM, CRLF unless told otherwise). */
function csv(
	rows: string[][],
	opts: { bom?: boolean; eol?: string } = {},
): Uint8Array<ArrayBuffer> {
	const eol = opts.eol ?? '\r\n';
	const text = rows.map((r) => r.join(',')).join(eol) + eol;
	return new TextEncoder().encode((opts.bom === false ? '' : '\uFEFF') + text);
}

function hex(value: string): Uint8Array<ArrayBuffer> {
	return new Uint8Array(value.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
}

async function firstType(db: Client): Promise<string> {
	return (await listMasters(db)).types[0].name;
}

function codesOf(preview: ImportPreview, line: number): string[] {
	return preview.rows.find((r) => r.line === line)?.issues.map((i) => i.code) ?? [];
}

function judgmentOf(preview: ImportPreview, line: number): string | undefined {
	return preview.rows.find((r) => r.line === line)?.judgment;
}

describe('decoding and parsing', () => {
	it('reads UTF-8 with a BOM, quoted commas, quotes and line breaks', () => {
		const bytes = csv([
			[H.assetTag, H.name, H.note],
			['PC-1', '"Laptop, 14in"', '"say ""hi"""'],
			['PC-2', 'Dock', '"two\r\nlines"'],
			['PC-3', 'Mouse', ''],
		]);
		const { text, encoding } = decodeCsv(bytes);
		expect(encoding).toBe('utf-8');
		const records = parseCsv(text);
		expect(records.map((r) => r.line)).toEqual([1, 2, 3, 5]);
		expect(records[0].cells[0]).toBe(H.assetTag);
		expect(records[1].cells).toEqual(['PC-1', 'Laptop, 14in', 'say "hi"']);
		expect(records[2].cells).toEqual(['PC-2', 'Dock', 'two\r\nlines']);
	});

	it('reads UTF-8 without a BOM and LF line ends, dropping blank lines', () => {
		const bytes = csv(
			[[H.assetTag, H.name], ['PC-1', 'Laptop'], [',', ''], [''], ['PC-2', 'Dock']],
			{ bom: false, eol: '\n' },
		);
		const records = parseCsv(decodeCsv(bytes).text);
		expect(records.map((r) => [r.line, r.cells[0]])).toEqual([
			[1, H.assetTag],
			[2, 'PC-1'],
			[5, 'PC-2'],
		]);
	});

	it('falls back to Shift_JIS', () => {
		// "<asset tag>,<name>,<type>\r\nPC-1,<laptop>,\r\n" saved as Shift_JIS.
		const bytes = hex(
			'8ac7979d94d48d862c95a8956996bc2c8eed97de0d0a50432d312c836d815b836750432c0d0a',
		);
		const { text, encoding } = decodeCsv(bytes);
		expect(encoding).toBe('shift_jis');
		const records = parseCsv(text);
		expect(records[0].cells).toEqual([H.assetTag, H.name, H.typeName]);
		expect(records[1].cells).toEqual([
			'PC-1',
			`${String.fromCodePoint(0x30ce, 0x30fc, 0x30c8)}PC`,
			'',
		]);
		// Vendor characters of the Windows code page decode too.
		expect(decodeCsv(hex('eee08bb48740')).text).toBe(String.fromCodePoint(0x9ad9, 0x6a4b, 0x2460));
	});

	it('reports an unclosed quote at the line it opens', async () => {
		const text = `${H.assetTag},${H.name}\r\nPC-1,ok\r\nPC-2,"broken\r\nPC-3,x\r\n`;
		await expectError(() => parseCsv(text), { status: 400, code: 'csv_unclosed_quote', line: 3 });
	});

	it('maps headers (a trailing * is ignored) and undoes the formula guard', () => {
		expect(headerField(`${H.assetTag}*`)).toBe('assetTag');
		expect(headerField(` ${H.name} `)).toBe('name');
		expect(headerField(CSV_READONLY_COLUMNS.status)).toBeNull();
		expect(unguard("'=SUM(A1)")).toBe('=SUM(A1)');
		expect(unguard("'plain")).toBe("'plain");
	});

	it('also ignores a trailing full-width asterisk, and only one asterisk', () => {
		const fullWidth = String.fromCodePoint(0xff0a);
		expect(headerField(`${H.assetTag}${fullWidth}`)).toBe('assetTag');
		expect(headerField(` ${H.name} ${fullWidth} `)).toBe('name');
		expect(headerField(`${H.name}**`)).toBeNull();
	});
});

describe('preview judgments', () => {
	it('rejects missing values, duplicates and bad dates', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-OLD');
		const preview = await previewImport(
			db,
			ADMIN,
			csv([
				[H.assetTag, H.name, H.purchasedOn],
				['PC-1', 'Laptop', '2025/4/1'],
				['PC-2', '', ''],
				['PC-3', 'Dock', '2025-13-01'],
				['PC-OLD', 'Old', ''],
				['PC-5', 'A', ''],
				['PC-5', 'B', ''],
				['', 'No tag', ''],
			]),
			ON,
		);
		expect(judgmentOf(preview, 2)).toBe('ok');
		expect(codesOf(preview, 3)).toEqual(['required']);
		expect(codesOf(preview, 4)).toEqual(['invalid_date']);
		expect(codesOf(preview, 5)).toEqual(['duplicate_existing']);
		expect(codesOf(preview, 6)).toEqual(['duplicate_in_file']);
		expect(codesOf(preview, 7)).toEqual(['duplicate_in_file']);
		expect(codesOf(preview, 8)).toEqual(['required']);
		expect(preview.counts).toEqual({ ok: 1, warn: 0, error: 6 });
		expect(preview.encoding).toBe('utf-8');
	});

	it('treats an unknown holder as "needs a look" or as an error, by option', async () => {
		const db = await freshDb();
		const file = csv([
			[H.assetTag, H.name, H.holderEmail],
			['PC-1', 'Laptop', 'MEMBER@example.com'],
			['PC-2', 'Laptop', 'nobody@example.com'],
		]);
		const on = await previewImport(db, ADMIN, file, ON);
		expect(judgmentOf(on, 2)).toBe('ok');
		expect(on.rows[0].holderName).toBe(MEMBER.name);
		expect(judgmentOf(on, 3)).toBe('warn');
		expect(codesOf(on, 3)).toEqual(['member_not_found']);
		const off = await previewImport(db, ADMIN, file, OFF);
		expect(judgmentOf(off, 3)).toBe('error');
	});

	it('adds unregistered types and places, or rejects them, by option', async () => {
		const db = await freshDb();
		const file = csv([
			[H.assetTag, H.name, H.typeName, H.holderEmail, H.placeName],
			['PC-1', 'Tablet', 'Tablet', 'member@example.com', 'Satellite office'],
			['PC-2', 'Tablet', 'Tablet', '', 'Ignored without a holder'],
		]);
		const on = await previewImport(db, ADMIN, file, ON);
		expect(codesOf(on, 2)).toEqual(['type_unregistered', 'place_unregistered']);
		expect(judgmentOf(on, 2)).toBe('warn');
		expect(codesOf(on, 3)).toEqual(['type_unregistered']);
		expect(on.newTypes).toEqual(['Tablet']);
		expect(on.newPlaces).toEqual(['Satellite office']);
		const off = await previewImport(db, ADMIN, file, OFF);
		expect(off.counts).toEqual({ ok: 0, warn: 0, error: 2 });
		expect(off.newTypes).toEqual([]);
	});

	it('rejects deactivated types, future issue dates and due dates before issue', async () => {
		const db = await freshDb();
		const { types } = await listMasters(db);
		await updateMaster(db, ADMIN, 'types', types[1].id, { active: false });
		const preview = await previewImport(
			db,
			ADMIN,
			csv([
				[H.assetTag, H.name, H.typeName, H.holderEmail, H.issuedOn, H.dueOn],
				['PC-1', 'A', types[1].name, '', '', ''],
				['PC-2', 'B', '', 'member@example.com', FUTURE, ''],
				['PC-3', 'C', '', 'member@example.com', '2025-04-10', '2025/4/1'],
				['PC-4', 'D', '', 'member@example.com', '2025/4/10', '2025/5/1'],
			]),
			ON,
		);
		expect(codesOf(preview, 2)).toEqual(['type_inactive']);
		expect(codesOf(preview, 3)).toEqual(['future']);
		expect(codesOf(preview, 4)).toEqual(['before_issued']);
		expect(judgmentOf(preview, 5)).toBe('ok');
	});

	it('refuses files without the required columns, empty files and too many rows', async () => {
		const db = await freshDb();
		await expectError(previewImport(db, ADMIN, csv([[H.name], ['Laptop']]), ON), {
			status: 400,
			code: 'csv_missing_columns',
			line: 1,
		});
		await expectError(previewImport(db, ADMIN, new Uint8Array(), ON), {
			status: 400,
			code: 'csv_empty',
		});
		await expectError(previewImport(db, ADMIN, csv([[H.assetTag, H.name]]), ON), {
			status: 400,
			code: 'csv_no_rows',
		});
		const many = Array.from({ length: IMPORT_ROWS_MAX + 1 }, (_, i) => [`T-${i}`, 'x']);
		await expectError(previewImport(db, ADMIN, csv([[H.assetTag, H.name], ...many]), ON), {
			status: 400,
			code: 'csv_too_many_rows',
		});
	});
});

describe('judging one row (no database)', () => {
	function entry(id: number, name: string, active = true): MasterEntry {
		return { id, name, active, sortOrder: id, usage: 0 };
	}

	function context(overrides: Partial<RowContext> = {}): RowContext {
		return {
			options: ON,
			today: '2025-06-01',
			types: new Map([
				['Laptop', entry(1, 'Laptop')],
				['Retired', entry(2, 'Retired', false)],
			]),
			places: new Map([
				['Office', entry(1, 'Office')],
				['Closed', entry(2, 'Closed', false)],
			]),
			defaultPlace: 'Office',
			people: new Map([['member@example.com', directoryPerson(MEMBER)]]),
			registered: new Set(['PC-OLD']),
			tagCounts: new Map([
				['PC-1', 1],
				['PC-OLD', 1],
			]),
			...overrides,
		};
	}

	it('issues to a matched holder, at the first active place and today by default', () => {
		const row = judgeRow(
			{
				line: 2,
				values: {
					assetTag: 'PC-1',
					name: 'Laptop',
					typeName: 'Laptop',
					holderEmail: 'MEMBER@example.com',
				},
			},
			context(),
		);
		expect(row).toMatchObject({ line: 2, judgment: 'ok', holderName: MEMBER.name, issues: [] });
		expect(row.item).toMatchObject({ assetTag: 'PC-1', name: 'Laptop', typeName: 'Laptop' });
		expect(row.issue).toMatchObject({ placeName: 'Office', issuedOn: '2025-06-01', dueOn: null });
		expect(row.issue?.person.id).toBe(MEMBER.id);
	});

	it('reports every problem of a row in column order, with its level', () => {
		const row = judgeRow(
			{
				line: 3,
				values: {
					assetTag: 'PC-OLD',
					name: '',
					typeName: 'Unknown',
					purchasedOn: 'soon',
					holderEmail: 'member@example.com',
					placeName: 'Closed',
					issuedOn: '2025/7/1',
					dueOn: '2025-06-15',
				},
			},
			context(),
		);
		expect(row.issues).toEqual([
			{ field: 'name', code: 'required', level: 'error' },
			{ field: 'assetTag', code: 'duplicate_existing', level: 'error' },
			{ field: 'typeName', code: 'type_unregistered', level: 'warn' },
			{ field: 'purchasedOn', code: 'invalid_date', level: 'error' },
			{ field: 'placeName', code: 'place_inactive', level: 'error' },
			{ field: 'issuedOn', code: 'future', level: 'error' },
			{ field: 'dueOn', code: 'before_issued', level: 'error' },
		]);
		expect(row.judgment).toBe('error');
	});

	it('reads the place and dates only when the holder matched', () => {
		const values = { assetTag: 'PC-1', name: 'Laptop', placeName: 'Nowhere', issuedOn: 'bad' };
		const nobody = judgeRow(
			{ line: 2, values: { ...values, holderEmail: 'x@example.com' } },
			context(),
		);
		expect(nobody.issues).toEqual([
			{ field: 'holderEmail', code: 'member_not_found', level: 'warn' },
		]);
		expect(nobody).toMatchObject({ judgment: 'warn', holderName: null, issue: null });
		const off = judgeRow(
			{ line: 2, values: { ...values, holderEmail: 'x@example.com' } },
			context({ options: OFF }),
		);
		expect(off.judgment).toBe('error');
	});

	it('needs a place when the row names none and every place is deactivated', () => {
		const row = judgeRow(
			{ line: 2, values: { assetTag: 'PC-1', name: 'Laptop', holderEmail: 'member@example.com' } },
			context({ defaultPlace: null }),
		);
		expect(row.issues).toEqual([{ field: 'placeName', code: 'required', level: 'error' }]);
		expect(row).toMatchObject({ holderName: MEMBER.name, issue: null });
	});

	it('refuses a deactivated type even when missing names may be added', () => {
		const row = judgeRow(
			{ line: 2, values: { assetTag: 'PC-1', name: 'Laptop', typeName: 'Retired' } },
			context(),
		);
		expect(row.issues).toEqual([{ field: 'typeName', code: 'type_inactive', level: 'error' }]);
	});
});

describe('running the import', () => {
	it('registers rows, issues the ones with a known holder, and logs it', async () => {
		const db = await freshDb();
		const type = await firstType(db);
		const result = await runImport(
			db,
			ADMIN,
			csv([
				[`${H.assetTag}*`, `${H.name}*`, H.typeName, H.holderEmail, H.issuedOn],
				['PC-1', 'Laptop', type, 'member@example.com', PAST],
				['PC-2', 'Laptop', type, '', ''],
				['PC-3', 'Tablet', 'Tablet', 'nobody@example.com', ''],
			]),
			'ledger.csv',
			ON,
			'all',
		);
		expect(result).toEqual({
			created: 3,
			assigned: 1,
			excluded: 0,
			addedTypes: ['Tablet'],
			addedPlaces: [],
			failed: null,
		});
		const held = await listItems(db, ADMIN, parseItemQuery(new URLSearchParams('held=1')));
		expect(held.rows.map((r) => [r.assetTag, r.holder?.userId, r.issuedOn])).toEqual([
			['PC-1', MEMBER.id, PAST],
		]);
		const all = await listItems(db, ADMIN, parseItemQuery(new URLSearchParams()));
		expect(all.rows.find((r) => r.assetTag === 'PC-3')?.typeName).toBe('Tablet');

		const events = await listEvents(db, ADMIN, parseEventQuery(new URLSearchParams('size=200')));
		const kinds = events.rows.map((e) => e.kind);
		expect(kinds.filter((k) => k === 'create')).toHaveLength(3);
		expect(kinds.filter((k) => k === 'issue')).toHaveLength(1);
		const log = events.rows.find((e) => e.kind === 'import');
		expect(log?.detail).toMatchObject({
			fileName: 'ledger.csv',
			created: 3,
			assigned: 1,
			excluded: 0,
		});
	});

	it('issues with today and the first place when the file leaves them empty', async () => {
		const db = await freshDb();
		await runImport(
			db,
			ADMIN,
			csv([
				[H.assetTag, H.name, H.holderEmail],
				['PC-1', 'Laptop', OTHER.email ?? ''],
			]),
			null,
			ON,
			'all',
		);
		const row = (await listItems(db, ADMIN, parseItemQuery(new URLSearchParams()))).rows[0];
		const { places } = await listMasters(db);
		expect(row.holder?.userId).toBe(OTHER.id);
		expect(row.placeName).toBe(places[0].name);
		expect(row.issuedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('refuses "import all" while error rows remain, and can skip them', async () => {
		const db = await freshDb();
		const file = csv([
			[H.assetTag, H.name],
			['PC-1', 'Laptop'],
			['PC-2', ''],
		]);
		await expectError(runImport(db, ADMIN, file, null, ON, 'all'), {
			status: 409,
			code: 'import_has_errors',
		});
		expect((await listItems(db, ADMIN, parseItemQuery(new URLSearchParams()))).total).toBe(0);
		const result = await runImport(db, ADMIN, file, null, ON, 'skip_errors');
		expect(result).toMatchObject({ created: 1, assigned: 0, excluded: 1, failed: null });
	});

	it('commits in batches of 100 rows and reports where a failing batch starts', async () => {
		const db = await freshDb();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await db.execute(
			"CREATE TRIGGER fail_tag BEFORE INSERT ON items WHEN NEW.asset_tag = 'B-0120' BEGIN SELECT RAISE(ABORT, 'boom'); END",
		);
		const rows = Array.from({ length: 150 }, (_, i) => [
			`B-${String(i + 1).padStart(4, '0')}`,
			'x',
		]);
		const result = await runImport(
			db,
			ADMIN,
			csv([[H.assetTag, H.name], ...rows]),
			null,
			ON,
			'all',
		);
		expect(result.created).toBe(100);
		// Row 101 is on line 102 (the header is line 1).
		expect(result.failed).toEqual({ fromLine: 102, toLine: 151, code: 'internal_error' });
		expect((await listItems(db, ADMIN, parseItemQuery(new URLSearchParams()))).total).toBe(100);
		expect(await findItem(db, 101)).toBeNull();
	});
});

describe('HTTP', () => {
	it.each([
		['GET /api/import/template', templateRoute.GET, 'GET', '/api/import/template'],
		['POST /api/import/preview', previewRoute.POST, 'POST', '/api/import/preview'],
		['POST /api/import/execute', executeRoute.POST, 'POST', '/api/import/execute'],
	] as const)('%s answers 403 to members', async (_label, handler, method, path) => {
		await freshDb();
		const res = await call(handler as Handler, method, path, {
			headers: { ...as(MEMBER), 'content-type': 'application/octet-stream' },
			body:
				method === 'POST'
					? csv([
							[H.assetTag, H.name],
							['PC-1', 'x'],
						])
					: undefined,
		});
		expect(res.status).toBe(403);
		expect(res.body).toEqual({ error: 'forbidden_manage_required' });
	});

	it('serves the template: BOM, header with required marks, two examples', async () => {
		await freshDb();
		const res = await call(templateRoute.GET, 'GET', '/api/import/template', {
			headers: as(ADMIN),
		});
		expect(res.status).toBe(200);
		const bytes = new Uint8Array(await res.res.arrayBuffer());
		expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const lines = new TextDecoder().decode(bytes).trimEnd().split('\r\n');
		expect(lines).toHaveLength(3);
		expect(lines[0].split(',').slice(0, 2)).toEqual([`${H.assetTag}*`, `${H.name}*`]);
	});

	it('previews over HTTP and returns file errors with their line', async () => {
		await freshDb();
		const okRes = await call(previewRoute.POST, 'POST', '/api/import/preview', {
			headers: { ...as(ADMIN), 'content-type': 'application/octet-stream' },
			body: csv([
				[H.assetTag, H.name],
				['PC-1', 'x'],
			]),
		});
		expect(okRes.status).toBe(200);
		expect((okRes.body as ImportPreview).counts).toEqual({ ok: 1, warn: 0, error: 0 });

		const bad = await call(previewRoute.POST, 'POST', '/api/import/preview', {
			headers: { ...as(ADMIN), 'content-type': 'application/octet-stream' },
			body: new TextEncoder().encode(`${H.assetTag},${H.name}\r\nPC-1,"x\r\n`),
		});
		expect(bad.status).toBe(400);
		expect(bad.body).toEqual({ error: 'csv_unclosed_quote', line: 2 });

		const json = await call(previewRoute.POST, 'POST', '/api/import/preview', {
			headers: as(ADMIN),
			json: {},
		});
		expect(json.status).toBe(415);
	});

	it('exports the import columns first, so an export imports again', async () => {
		const db = await freshDb();
		await addItem(db, 'PC-1', { note: '-starts with a minus' });
		const exported = await call(exportRoute.GET, 'GET', '/api/items/export', {
			headers: as(ADMIN),
		});
		const bytes = new Uint8Array(await exported.res.arrayBuffer());
		const header = new TextDecoder().decode(bytes).split('\r\n')[0].split(',');
		expect(header).toEqual([...Object.values(CSV_COLUMNS), ...Object.values(CSV_READONLY_COLUMNS)]);

		const target = await freshDb();
		const result = await runImport(target, ADMIN, bytes, 'export.csv', ON, 'all');
		expect(result.created).toBe(1);
		const row = (await listItems(target, ADMIN, parseItemQuery(new URLSearchParams()))).rows[0];
		expect(row.note).toBe('-starts with a minus');
	});
});
