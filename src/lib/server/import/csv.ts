import {
	CSV_COLUMNS,
	CSV_READONLY_COLUMNS,
	CSV_TEMPLATE_EXAMPLES,
	STATUS_LABELS,
	SUSPEND_REASON_LABELS,
} from '#lib/server/content.ts';
import { CsvError, ErrorCode } from '#lib/server/errors.ts';
import type { ItemView } from '#lib/server/domain/items.ts';

// CSV in and out. The export, the import template and the import share one
// column set (content.ts CSV_COLUMNS), so a file exported here can be edited
// and imported again; the export's read-only columns come last and the import
// ignores columns it does not know.
//
// Output: UTF-8 with a BOM and CRLF line ends, so spreadsheet software opens
// Japanese text correctly. Input: UTF-8 (with or without a BOM) or Shift_JIS
// (what spreadsheet software in Japanese saves by default), CRLF or LF.

export type CsvField = keyof typeof CSV_COLUMNS;
export const CSV_FIELDS = Object.keys(CSV_COLUMNS) as CsvField[];

/** Fields the import cannot do without. */
export const REQUIRED_FIELDS: readonly CsvField[] = ['assetTag', 'name'];

// --- Output -------------------------------------------------------------------

// A leading = + - @ (or tab / CR) would be evaluated as a formula when the file
// is opened, so such cells get a leading apostrophe (and lose it on import).
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number | null): string {
	if (value === null) {
		return '';
	}
	const text = String(value);
	const safe = FORMULA_START.test(text) ? `'${text}` : text;
	return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(rows: (string | number | null)[][]): string {
	return `\uFEFF${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

export function itemsToCsv(rows: ItemView[]): string {
	const header = [...Object.values(CSV_COLUMNS), ...Object.values(CSV_READONLY_COLUMNS)];
	const body = rows.map((r) => {
		const values: Record<CsvField, string | null> = {
			assetTag: r.assetTag,
			name: r.name,
			typeName: r.typeName,
			serialNo: r.serialNo,
			purchasedOn: r.purchasedOn,
			storageLocation: r.storageLocation,
			note: r.note,
			holderEmail: r.holder?.email ?? null,
			placeName: r.placeName,
			issuedOn: r.issuedOn,
			dueOn: r.dueOn,
		};
		return [
			...CSV_FIELDS.map((f) => values[f]),
			STATUS_LABELS[r.status],
			r.suspendedReason ? SUSPEND_REASON_LABELS[r.suspendedReason] : null,
			r.holder?.name ?? null,
			r.updatedAt,
		];
	});
	return toCsv([header, ...body]);
}

/** The import template: the header (required columns marked `*`) + examples. */
export function importTemplateCsv(): string {
	const header = CSV_FIELDS.map((f) =>
		REQUIRED_FIELDS.includes(f) ? `${CSV_COLUMNS[f]}*` : CSV_COLUMNS[f],
	);
	const examples = CSV_TEMPLATE_EXAMPLES.map((row) => CSV_FIELDS.map((f) => row[f] || null));
	return toCsv([header, ...examples]);
}

// --- Input --------------------------------------------------------------------

export type CsvEncoding = 'utf-8' | 'shift_jis';

/**
 * Bytes -> text. A BOM means UTF-8; otherwise the bytes are read as strict
 * UTF-8 and, if that fails, as Shift_JIS.
 */
export function decodeCsv(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
		return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8' };
	}
	try {
		return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
	} catch {
		// Not UTF-8: try Shift_JIS below.
	}
	try {
		return {
			text: new TextDecoder('shift_jis', { fatal: true }).decode(bytes),
			encoding: 'shift_jis',
		};
	} catch {
		throw new CsvError(ErrorCode.CsvEncodingUnknown);
	}
}

/** One record and the file line it starts on (1 = the header line). */
export interface CsvRecord {
	line: number;
	cells: string[];
}

/**
 * RFC 4180 records: comma-separated, `"` quoting with `""` as an escaped
 * quote, quoted cells may span lines; CRLF, LF or CR line ends. Records whose
 * cells are all empty (blank lines, `,,,`) are dropped.
 */
export function parseCsv(text: string): CsvRecord[] {
	const records: CsvRecord[] = [];
	let cells: string[] = [];
	let value = '';
	let quoted = false;
	let line = 1;
	let start = 1;
	let quoteLine = 1;
	const endRecord = () => {
		cells.push(value);
		if (cells.some((c) => c !== '')) {
			records.push({ line: start, cells });
		}
		cells = [];
		value = '';
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					value += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) {
					line++;
				}
				value += ch;
			}
			continue;
		}
		if (ch === '"' && value === '') {
			quoted = true;
			quoteLine = line;
		} else if (ch === ',') {
			cells.push(value);
			value = '';
		} else if (ch === '\r' || ch === '\n') {
			if (ch === '\r' && text[i + 1] === '\n') {
				i++;
			}
			endRecord();
			line++;
			start = line;
		} else {
			value += ch;
		}
	}
	if (quoted) {
		throw new CsvError(ErrorCode.CsvUnclosedQuote, quoteLine);
	}
	if (value !== '' || cells.length > 0) {
		endRecord();
	}
	return records;
}

/** Undo the export's formula guard: `'=...` -> `=...`. */
export function unguard(value: string): string {
	return value.length > 1 && value[0] === "'" && FORMULA_START.test(value.slice(1))
		? value.slice(1)
		: value;
}

// The full-width asterisk, built from its code point: no CJK in code, and a
// `\u` escape can be turned into the character itself by tools that rewrite
// the file.
const FULLWIDTH_ASTERISK = String.fromCodePoint(0xff0a);

/** Header cell -> field: trimmed, a trailing `*` (or full-width one) ignored. */
export function headerField(header: string): CsvField | null {
	let label = header.trim();
	if (label.endsWith('*') || label.endsWith(FULLWIDTH_ASTERISK)) {
		label = label.slice(0, -1).trim();
	}
	return CSV_FIELDS.find((f) => CSV_COLUMNS[f] === label) ?? null;
}
