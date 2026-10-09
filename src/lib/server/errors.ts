// Stable error codes. The API never returns human-facing text: the frontend
// resolves each code to a message (src/lib/messages.ts). A new code goes in
// three places: its group below, STATUS (its HTTP status) and a message there;
// the type checker reports a missing status or message.

/**
 * Codes of the parts an app built from this template keeps as they are:
 * authentication and request shape, people (Directory API), attachments, CSV
 * import and the AI assistant tools.
 */
const COMMON_CODES = {
	Unauthorized: 'unauthorized',
	ForbiddenManageRequired: 'forbidden_manage_required',
	InvalidRequest: 'invalid_request',
	/** Input problems tied to fields: the body carries `fields` (see ValidationError). */
	ValidationFailed: 'validation_failed',
	UnsupportedMediaType: 'unsupported_media_type',
	NotFound: 'not_found',
	MemberNotFound: 'member_not_found',
	PeopleUnconfigured: 'people_unconfigured',
	PeopleUnavailable: 'people_unavailable',
	AttachmentNotFound: 'attachment_not_found',
	AttachmentTooLarge: 'attachment_too_large',
	AttachmentTypeUnsupported: 'attachment_type_unsupported',
	AttachmentLimitReached: 'attachment_limit_reached',
	AttachmentStorageFailed: 'attachment_storage_failed',
	// CSV import: file-level problems (the body may carry the file `line`).
	CsvTooLarge: 'csv_too_large',
	CsvTooManyRows: 'csv_too_many_rows',
	CsvEncodingUnknown: 'csv_encoding_unknown',
	CsvUnclosedQuote: 'csv_unclosed_quote',
	CsvEmpty: 'csv_empty',
	CsvNoRows: 'csv_no_rows',
	CsvMissingColumns: 'csv_missing_columns',
	CsvDuplicateColumn: 'csv_duplicate_column',
	ImportHasErrors: 'import_has_errors',
	ImportNothingToImport: 'import_nothing_to_import',
	/** POST /api/mcp/<tool> for a tool the app does not have. */
	McpToolNotFound: 'mcp_tool_not_found',
	InternalError: 'internal_error',
} as const;

/** Codes of this app's own records and rules (items, assignments, types, places). */
const APP_CODES = {
	AssignmentNotOwned: 'assignment_not_owned',
	/** A correction that changes nothing. */
	NothingChanged: 'nothing_changed',
	ItemNotFound: 'item_not_found',
	/** MCP return_item: the item is not held by anyone. */
	ItemNotAssigned: 'item_not_assigned',
	ItemAlreadyAssigned: 'item_already_assigned',
	ItemSuspended: 'item_suspended',
	ItemNotSuspended: 'item_not_suspended',
	ItemVersionConflict: 'item_version_conflict',
	AssignmentNotFound: 'assignment_not_found',
	AssignmentAlreadyReturned: 'assignment_already_returned',
	AssignmentPeriodOverlap: 'assignment_period_overlap',
	AssignmentVersionConflict: 'assignment_version_conflict',
	PlaceNotFound: 'place_not_found',
	TypeNotFound: 'type_not_found',
} as const;

export const ErrorCode = { ...COMMON_CODES, ...APP_CODES } as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** The HTTP status of each code: a code always answers with the same status. */
const STATUS: Record<ErrorCode, number> = {
	// Common
	unauthorized: 401,
	forbidden_manage_required: 403,
	invalid_request: 400,
	validation_failed: 422,
	unsupported_media_type: 415,
	not_found: 404,
	member_not_found: 404,
	people_unconfigured: 409,
	people_unavailable: 503,
	attachment_not_found: 404,
	attachment_too_large: 413,
	attachment_type_unsupported: 415,
	attachment_limit_reached: 409,
	attachment_storage_failed: 502,
	csv_too_large: 413,
	csv_too_many_rows: 400,
	csv_encoding_unknown: 400,
	csv_unclosed_quote: 400,
	csv_empty: 400,
	csv_no_rows: 400,
	csv_missing_columns: 400,
	csv_duplicate_column: 400,
	import_has_errors: 409,
	import_nothing_to_import: 400,
	mcp_tool_not_found: 404,
	internal_error: 500,
	// This app
	assignment_not_owned: 403,
	nothing_changed: 400,
	item_not_found: 404,
	item_not_assigned: 409,
	item_already_assigned: 409,
	item_suspended: 409,
	item_not_suspended: 409,
	item_version_conflict: 409,
	assignment_not_found: 404,
	assignment_already_returned: 409,
	assignment_period_overlap: 409,
	assignment_version_conflict: 409,
	place_not_found: 404,
	type_not_found: 404,
};

/** A business-rule failure: a stable code and its HTTP status (STATUS). */
export class AppError extends Error {
	readonly status: number;
	readonly code: ErrorCode;

	constructor(code: ErrorCode) {
		super(code);
		this.name = 'AppError';
		this.status = STATUS[code];
		this.code = code;
	}
}

/** A CSV file problem, at a line of the file when there is one (`line`). */
export class CsvError extends AppError {
	readonly line: number | null;

	constructor(code: ErrorCode, line: number | null = null) {
		super(code);
		this.name = 'CsvError';
		this.line = line;
	}
}

/**
 * Why a field was rejected, in the parts an app built from this template
 * keeps: request shape, uniqueness, lookups, and person references.
 */
type CommonReason =
	| 'required'
	| 'too_long'
	| 'invalid'
	| 'invalid_date'
	| 'taken'
	| 'not_found'
	/** A person reference (MCP `person`) that matches more than one person. */
	| 'ambiguous';

/** Why a field was rejected by this app's own rules (issue and return dates). */
type AppReason = 'future' | 'before_issued';

/**
 * Why a field was rejected. The frontend turns (field, reason) into a message
 * shown under that field (src/lib/messages.ts).
 */
export type FieldReason = CommonReason | AppReason;

export type FieldErrors = Record<string, FieldReason>;

/**
 * Lists that help fix rejected input, sent next to `fields` (MCP tools only):
 * the people an ambiguous `person` could mean, and the valid names of a type
 * or place that was not found. Data, never prose.
 */
export interface ValidationExtra {
	candidates?: { id: string; name: string; email: string | null }[];
	choices?: Record<string, string[]>;
}

/**
 * Input that failed validation, tied to fields:
 * `{ "error": "validation_failed", "fields": { "assetTag": "taken" } }`.
 */
export class ValidationError extends AppError {
	readonly fields: FieldErrors;
	readonly extra: ValidationExtra;

	constructor(fields: FieldErrors, extra: ValidationExtra = {}) {
		super(ErrorCode.ValidationFailed);
		this.name = 'ValidationError';
		this.fields = fields;
		this.extra = extra;
	}
}

/**
 * JSON error body `{ "error": "<code>" }` with the code's status and no-store
 * caching, plus `fields` (validation, with any ValidationExtra lists) or
 * `line` (a CSV file line) when there are any.
 */
export function errorResponse(
	code: ErrorCode,
	extra: { fields?: FieldErrors; line?: number } & ValidationExtra = {},
): Response {
	return new Response(JSON.stringify({ error: code, ...extra }), {
		status: STATUS[code],
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}
