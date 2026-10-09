import type { Client, InStatement } from '@libsql/client';
import { issueStatements } from '#lib/server/domain/assignments.ts';
import type { Actor } from '#lib/server/auth/actor.ts';
import {
	type CsvEncoding,
	type CsvField,
	decodeCsv,
	headerField,
	importTemplateCsv,
	parseCsv,
	REQUIRED_FIELDS,
	unguard,
} from './csv.ts';
import { parseSheetDate, today } from '#lib/server/dates.ts';
import { AppError, CsvError, ErrorCode } from '#lib/server/errors.ts';
import { unguardedEventStatement } from '#lib/server/domain/events.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import {
	type ItemFields,
	isUniqueTagViolation,
	itemInsertStatements,
	registeredAssetTags,
} from '#lib/server/domain/items.ts';
import {
	addMissingMasterStatements,
	listMasters,
	type MasterEntry,
} from '#lib/server/domain/masters.ts';
import { type PeopleState, type Person, peopleByEmail } from '#lib/server/domain/directory.ts';
import { IMPORT_BYTES_MAX, IMPORT_ROWS_MAX, ITEM_LIMITS, MASTER_NAME_MAX } from '#lib/limits.ts';

// CSV import (DESIGN.md §9-H). Stateless: the preview and the import both get
// the file and the options, and the import judges every row again, so what is
// written is what the rules say at that moment.
//
// Row judgments:
// - error (not imported): a required value is missing, a value is too long or
//   not a date, the asset tag is repeated in the file or already registered,
//   an issue date is in the future or a due date is before it, a type / place
//   is deactivated; and the "needs a look" cases below when their option is off.
// - warn (imported as the options say): the holder's email matches nobody
//   (registered unassigned), a type / place is not registered yet (added).
// - ok.
// People are never created: a holder must already be a workspace member.
//
// The steps: readImportFile (bytes -> columns and rows, or the error that
// rejects the whole file), judgeRow (one row against a RowContext; no
// database, so it is tested on its own) and summarize (counts and the names to
// add). plan() reads what the rows are judged against once per file.

export type ImportIssueCode =
	| 'required'
	| 'too_long'
	| 'invalid_date'
	| 'duplicate_in_file'
	| 'duplicate_existing'
	| 'future'
	| 'before_issued'
	| 'member_not_found'
	| 'type_unregistered'
	| 'place_unregistered'
	| 'type_inactive'
	| 'place_inactive';

export type Judgment = 'ok' | 'warn' | 'error';

export interface ImportOptions {
	/** Add types / places that the file names but the lists do not have. */
	autoAddMasters: boolean;
	/** Register rows whose holder email matches nobody as unassigned. */
	unassignUnknown: boolean;
}

export interface ImportIssue {
	field: CsvField;
	code: ImportIssueCode;
	level: 'warn' | 'error';
}

export interface PreviewRow {
	/** File line the row starts on (the header is line 1). */
	line: number;
	judgment: Judgment;
	/** The cells of the recognized columns, trimmed. */
	values: Partial<Record<CsvField, string>>;
	/** The workspace member the holder email matched. */
	holderName: string | null;
	issues: ImportIssue[];
}

export interface ImportColumn {
	header: string;
	/** null: a column the import does not use (ignored). */
	field: CsvField | null;
}

export interface ImportPreview {
	encoding: CsvEncoding;
	columns: ImportColumn[];
	rows: PreviewRow[];
	counts: Record<Judgment, number>;
	/** Whether the member list could be read (holder emails are matched against it). */
	peopleState: PeopleState;
	/** Types / places the import would add (from rows that will be imported). */
	newTypes: string[];
	newPlaces: string[];
}

export type ImportMode = 'all' | 'skip_errors';

export interface ImportResult {
	created: number;
	assigned: number;
	/** Rows left out because they were judged `error` ("skip errors"). */
	excluded: number;
	addedTypes: string[];
	addedPlaces: string[];
	/**
	 * The batch that failed, if one did: rows before it are in, rows from
	 * `fromLine` on are not.
	 */
	failed: { fromLine: number; toLine: number; code: string } | null;
}

/** Rows per transaction when importing. */
export const IMPORT_BATCH_ROWS = 100;

/** A row's item: the item fields, with the type still a name (its id is looked up on import). */
type ImportItem = Omit<ItemFields, 'typeId'> & { typeName: string | null };

/** A data row of the file: its line and the trimmed cells of the recognized columns. */
export interface FileRow {
	line: number;
	values: Partial<Record<CsvField, string>>;
}

/** A judged row: what the preview shows, plus what the import writes. */
export interface PlannedRow extends PreviewRow {
	item: ImportItem;
	/** The hand-over to record when the holder matched a member and the row allows it. */
	issue: { person: Person; placeName: string; issuedOn: string; dueOn: string | null } | null;
}

interface Plan {
	preview: ImportPreview;
	rows: PlannedRow[];
}

// --- Reading the file ----------------------------------------------------------

/** Bytes -> the columns and the data rows, or the CsvError that rejects the whole file. */
export function readImportFile(bytes: Uint8Array): {
	encoding: CsvEncoding;
	columns: ImportColumn[];
	rows: FileRow[];
} {
	if (bytes.length > IMPORT_BYTES_MAX) {
		throw new CsvError(ErrorCode.CsvTooLarge);
	}
	const { text, encoding } = decodeCsv(bytes);
	const records = parseCsv(text);
	if (records.length === 0) {
		throw new CsvError(ErrorCode.CsvEmpty);
	}
	const [header, ...data] = records;
	const columns: ImportColumn[] = header.cells.map((h) => ({
		header: h.trim(),
		field: headerField(h),
	}));
	const mapped = columns.map((c) => c.field).filter((f): f is CsvField => f !== null);
	if (new Set(mapped).size !== mapped.length) {
		throw new CsvError(ErrorCode.CsvDuplicateColumn, header.line);
	}
	if (REQUIRED_FIELDS.some((f) => !mapped.includes(f))) {
		throw new CsvError(ErrorCode.CsvMissingColumns, header.line);
	}
	if (data.length === 0) {
		throw new CsvError(ErrorCode.CsvNoRows);
	}
	if (data.length > IMPORT_ROWS_MAX) {
		throw new CsvError(ErrorCode.CsvTooManyRows);
	}
	const rows = data.map((record) => {
		const values: FileRow['values'] = {};
		columns.forEach((c, i) => {
			if (c.field) {
				values[c.field] = unguard((record.cells[i] ?? '').trim());
			}
		});
		return { line: record.line, values };
	});
	return { encoding, columns, rows };
}

// --- Judging one row -------------------------------------------------------------

/** What every row of one file is judged against (read once per file). */
export interface RowContext {
	options: ImportOptions;
	/** Today in APP_TIME_ZONE: the default issue date, and the latest one allowed. */
	today: string;
	/** Item types and usage places by name. */
	types: Map<string, MasterEntry>;
	places: Map<string, MasterEntry>;
	/** The place of an issue whose row names none: the first active place. */
	defaultPlace: string | null;
	/** The people one may issue to, by lower-cased email. */
	people: Map<string, Person>;
	/** Asset tags already registered. */
	registered: Set<string>;
	/** How many rows of the file carry each asset tag. */
	tagCounts: Map<string, number>;
}

const TEXT_LIMITS: Partial<Record<CsvField, number>> = {
	...ITEM_LIMITS,
	typeName: MASTER_NAME_MAX,
	placeName: MASTER_NAME_MAX,
};

const MASTER_ISSUES = {
	typeName: { unregistered: 'type_unregistered', inactive: 'type_inactive' },
	placeName: { unregistered: 'place_unregistered', inactive: 'place_inactive' },
} as const;

/** One row's cells, read with the checks every column shares; problems collect in `issues`. */
class RowReader {
	readonly values: FileRow['values'];
	readonly issues: ImportIssue[] = [];

	constructor(values: FileRow['values']) {
		this.values = values;
	}

	add(field: CsvField, code: ImportIssueCode, level: 'warn' | 'error' = 'error'): void {
		this.issues.push({ field, code, level });
	}

	/** The cell, or null when empty; `too_long` past the column's limit. */
	text(field: CsvField): string | null {
		const v = this.values[field] ?? '';
		const max = TEXT_LIMITS[field];
		if (max !== undefined && v.length > max) {
			this.add(field, 'too_long');
		}
		return v === '' ? null : v;
	}

	/** A date cell as YYYY-MM-DD (spreadsheet forms too), or null when empty or unreadable. */
	date(field: CsvField): string | null {
		const v = this.values[field] ?? '';
		if (v === '') {
			return null;
		}
		const parsed = parseSheetDate(v);
		if (!parsed) {
			this.add(field, 'invalid_date');
		}
		return parsed;
	}
}

// A name the lists or the members do not have: a warning when its option lets
// the row in anyway, an error otherwise.
function missingLevel(optionOn: boolean): 'warn' | 'error' {
	return optionOn ? 'warn' : 'error';
}

// A type / place name: one the list does not have yet is added or refused as
// the option says; a deactivated one is refused.
function checkMasterName(
	row: RowReader,
	field: keyof typeof MASTER_ISSUES,
	entry: MasterEntry | undefined,
	ctx: RowContext,
): void {
	if (!entry) {
		row.add(field, MASTER_ISSUES[field].unregistered, missingLevel(ctx.options.autoAddMasters));
	} else if (!entry.active) {
		row.add(field, MASTER_ISSUES[field].inactive);
	}
}

// The item columns. The asset tag must be new, and once in the file.
function readItem(row: RowReader, ctx: RowContext): ImportItem {
	const assetTag = row.text('assetTag');
	const name = row.text('name');
	for (const f of REQUIRED_FIELDS) {
		if (!row.values[f]) {
			row.add(f, 'required');
		}
	}
	if (assetTag && (ctx.tagCounts.get(assetTag) ?? 0) > 1) {
		row.add('assetTag', 'duplicate_in_file');
	}
	if (assetTag && ctx.registered.has(assetTag)) {
		row.add('assetTag', 'duplicate_existing');
	}
	const typeName = row.text('typeName');
	if (typeName) {
		checkMasterName(row, 'typeName', ctx.types.get(typeName), ctx);
	}
	return {
		assetTag: assetTag ?? '',
		name: name ?? '',
		typeName,
		serialNo: row.text('serialNo'),
		purchasedOn: row.date('purchasedOn'),
		storageLocation: row.text('storageLocation'),
		note: row.text('note'),
	};
}

// The holder columns. When the email matches a member the item is issued in
// the same step, so only then are the place and the dates read.
function readHolder(
	row: RowReader,
	ctx: RowContext,
): { person: Person; issue: PlannedRow['issue'] } | null {
	const email = (row.values.holderEmail ?? '').toLowerCase();
	if (!email) {
		return null;
	}
	const person = ctx.people.get(email);
	if (!person) {
		row.add('holderEmail', 'member_not_found', missingLevel(ctx.options.unassignUnknown));
		return null;
	}
	const placeName = row.text('placeName') ?? ctx.defaultPlace;
	if (row.values.placeName) {
		checkMasterName(row, 'placeName', ctx.places.get(row.values.placeName), ctx);
	}
	const issuedOn = row.values.issuedOn ? row.date('issuedOn') : ctx.today;
	const dueOn = row.date('dueOn');
	if (issuedOn && issuedOn > ctx.today) {
		row.add('issuedOn', 'future');
	}
	if (issuedOn && dueOn && dueOn < issuedOn) {
		row.add('dueOn', 'before_issued');
	}
	if (!placeName) {
		// No place given and every place is deactivated.
		row.add('placeName', 'required');
		return { person, issue: null };
	}
	return { person, issue: issuedOn ? { person, placeName, issuedOn, dueOn } : null };
}

function judgmentOf(issues: ImportIssue[]): Judgment {
	if (issues.some((i) => i.level === 'error')) {
		return 'error';
	}
	return issues.length > 0 ? 'warn' : 'ok';
}

/** Judge one row: its issues and judgment, the item to register and the hand-over to record. */
export function judgeRow({ line, values }: FileRow, ctx: RowContext): PlannedRow {
	const row = new RowReader(values);
	const item = readItem(row, ctx);
	const holder = readHolder(row, ctx);
	return {
		line,
		judgment: judgmentOf(row.issues),
		values,
		holderName: holder?.person.name ?? null,
		issues: row.issues,
		item,
		issue: holder?.issue ?? null,
	};
}

// --- The whole file ----------------------------------------------------------------

function byName(entries: MasterEntry[]): Map<string, MasterEntry> {
	return new Map(entries.map((e) => [e.name, e]));
}

function countTags(rows: FileRow[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const r of rows) {
		const tag = r.values.assetTag ?? '';
		if (tag) {
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}
	return counts;
}

/** Rows per judgment, and the types / places the rows that will be imported add. */
function summarize(rows: PlannedRow[]): Pick<ImportPreview, 'counts' | 'newTypes' | 'newPlaces'> {
	const counts: Record<Judgment, number> = { ok: 0, warn: 0, error: 0 };
	const newTypes = new Set<string>();
	const newPlaces = new Set<string>();
	for (const r of rows) {
		counts[r.judgment]++;
		if (r.judgment === 'error') {
			continue;
		}
		for (const i of r.issues) {
			if (i.code === 'type_unregistered' && r.item.typeName) {
				newTypes.add(r.item.typeName);
			}
			if (i.code === 'place_unregistered' && r.issue) {
				newPlaces.add(r.issue.placeName);
			}
		}
	}
	return { counts, newTypes: [...newTypes], newPlaces: [...newPlaces] };
}

/** Read the file and judge every row (admin). */
async function plan(
	db: Client,
	actor: Actor,
	bytes: Uint8Array,
	options: ImportOptions,
): Promise<Plan> {
	requireAdmin(actor);
	const file = readImportFile(bytes);
	const [masters, people, registered] = await Promise.all([
		listMasters(db),
		peopleByEmail(actor),
		registeredAssetTags(
			db,
			file.rows.map((r) => r.values.assetTag ?? ''),
		),
	]);
	const ctx: RowContext = {
		options,
		today: today(),
		types: byName(masters.types),
		places: byName(masters.places),
		defaultPlace: masters.places.find((p) => p.active)?.name ?? null,
		people: people.byEmail,
		registered,
		tagCounts: countTags(file.rows),
	};
	const rows = file.rows.map((r) => judgeRow(r, ctx));
	const { counts, newTypes, newPlaces } = summarize(rows);
	return {
		preview: {
			encoding: file.encoding,
			columns: file.columns,
			rows: rows.map(({ line, judgment, values, holderName, issues }) => ({
				line,
				judgment,
				values,
				holderName,
				issues,
			})),
			counts,
			peopleState: people.state,
			newTypes,
			newPlaces,
		},
		rows,
	};
}

/** The file to fill in (admin): the header and two example rows. */
export function importTemplate(actor: Actor): string {
	requireAdmin(actor);
	return importTemplateCsv();
}

/** Judge a file without writing anything (admin). */
export async function previewImport(
	db: Client,
	actor: Actor,
	bytes: Uint8Array,
	options: ImportOptions,
): Promise<ImportPreview> {
	return (await plan(db, actor, bytes, options)).preview;
}

// --- Writing -----------------------------------------------------------------------

/** The ids the rows' type and place names stand for, once the missing ones are added. */
interface MasterRefs {
	typeIds: Map<string, number>;
	places: Map<string, { id: number; name: string }>;
}

// One row's statements: the item (+ its `create` event) and, when the holder
// matched, the issue (+ its `issue` event).
function rowStatements(
	row: PlannedRow,
	refs: MasterRefs,
	actor: Actor,
): { statements: InStatement[]; assigned: boolean } {
	const { typeName, ...fields } = row.item;
	const typeId = typeName ? (refs.typeIds.get(typeName) ?? null) : null;
	const statements = itemInsertStatements({ ...fields, typeId }, actor);
	const place = row.issue ? refs.places.get(row.issue.placeName) : undefined;
	if (!row.issue || !place) {
		return { statements, assigned: false };
	}
	const { person, issuedOn, dueOn } = row.issue;
	const issue = {
		id: crypto.randomUUID(),
		person: { id: person.id, name: person.name, email: person.email },
		place,
		issuedOn,
		dueOn,
		note: null,
		exchangeFrom: null,
		actor,
	};
	statements.push(...issueStatements(issue, { assetTag: fields.assetTag }));
	return { statements, assigned: true };
}

/**
 * Import a file (admin). `all` requires no `error` rows; `skip_errors` leaves
 * them out. Missing types / places are added first, then the rows go in
 * batches of IMPORT_BATCH_ROWS, each one transaction (item + `create` event,
 * and the issue + `issue` event when the holder matched). A failing batch stops
 * the import; the result says where. One `import` event records the counts.
 */
export async function runImport(
	db: Client,
	actor: Actor,
	bytes: Uint8Array,
	fileName: string | null,
	options: ImportOptions,
	mode: ImportMode,
): Promise<ImportResult> {
	const { preview, rows } = await plan(db, actor, bytes, options);
	if (mode === 'all' && preview.counts.error > 0) {
		throw new AppError(ErrorCode.ImportHasErrors);
	}
	const todo = rows.filter((r) => r.judgment !== 'error');
	if (todo.length === 0) {
		throw new AppError(ErrorCode.ImportNothingToImport);
	}

	if (preview.newTypes.length > 0 || preview.newPlaces.length > 0) {
		await db.batch(
			[
				...addMissingMasterStatements('types', preview.newTypes),
				...addMissingMasterStatements('places', preview.newPlaces),
			],
			'write',
		);
	}
	const masters = await listMasters(db);
	const refs: MasterRefs = {
		typeIds: new Map(masters.types.map((t) => [t.name, t.id])),
		places: new Map(masters.places.map((p) => [p.name, { id: p.id, name: p.name }])),
	};

	const result: ImportResult = {
		created: 0,
		assigned: 0,
		excluded: rows.length - todo.length,
		addedTypes: preview.newTypes,
		addedPlaces: preview.newPlaces,
		failed: null,
	};
	for (let i = 0; i < todo.length; i += IMPORT_BATCH_ROWS) {
		const chunk = todo.slice(i, i + IMPORT_BATCH_ROWS);
		const written = chunk.map((r) => rowStatements(r, refs, actor));
		try {
			await db.batch(
				written.flatMap((w) => w.statements),
				'write',
			);
		} catch (err) {
			const duplicate = isUniqueTagViolation(err);
			if (!duplicate) {
				console.error('[import] batch failed', err);
			}
			result.failed = {
				fromLine: chunk[0].line,
				toLine: chunk[chunk.length - 1].line,
				code: duplicate ? 'duplicate_existing' : ErrorCode.InternalError,
			};
			break;
		}
		result.created += chunk.length;
		result.assigned += written.filter((w) => w.assigned).length;
	}

	await db.execute(
		unguardedEventStatement({
			kind: 'import',
			item: null,
			actor,
			detail: {
				fileName,
				created: result.created,
				assigned: result.assigned,
				excluded: result.excluded,
				addedTypes: result.addedTypes,
				addedPlaces: result.addedPlaces,
				failedFromLine: result.failed?.fromLine ?? null,
			},
		}),
	);
	return result;
}
