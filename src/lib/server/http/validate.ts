import { isIsoDate } from '#lib/server/dates.ts';
import {
	AppError,
	ErrorCode,
	type FieldErrors,
	type FieldReason,
	ValidationError,
} from '#lib/server/errors.ts';

// Input readers. JSON bodies are read field by field with a Checker, which
// collects every problem and then throws one ValidationError
// (`validation_failed` + `fields`), so a form can show each message under its
// own field. A body that is not even an object is `invalid_request`.

export type Body = Record<string, unknown>;

/** Narrow an unknown JSON value to a plain object. */
export function asBody(value: unknown): Body {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new AppError(ErrorCode.InvalidRequest);
	}
	return value as Body;
}

function blank(value: unknown): boolean {
	return (
		value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
	);
}

/** A whole number written in digits (`,` separators allowed); NaN otherwise. */
function parseDigits(text: string): number {
	const plain = text.trim().replaceAll(',', '');
	return /^-?\d+$/.test(plain) ? Number(plain) : Number.NaN;
}

/**
 * Reads fields from one body, recording a reason per bad field. Call done()
 * after the last read: it throws if anything was recorded. A nested block
 * (`assignment`) is read with nested(): its fields are named `assignment.userId`
 * and its problems go into the same `errors`, so the one done() reports both.
 */
export class Checker {
	constructor(
		protected readonly body: Body,
		protected readonly prefix = '',
		readonly errors: FieldErrors = {},
	) {}

	/** Record a problem for a field (also usable for business rules). */
	fail(key: string, reason: FieldReason): void {
		this.errors[`${this.prefix}${key}`] ??= reason;
	}

	/** An optional nested block (`assignment`): a reader for it, or null when it is absent. */
	nested(key: string): Checker | null {
		const body = this.block(key);
		return body && new Checker(body, `${this.prefix}${key}.`, this.errors);
	}

	/** The object at `key`; null when absent, or when it is not an object (see notAnObject). */
	protected block(key: string): Body | null {
		const value = this.body[key];
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value !== 'object' || Array.isArray(value)) {
			this.notAnObject(key);
			return null;
		}
		return value as Body;
	}

	/**
	 * A nested block that is not an object. The app's own screens never send
	 * one, so for a JSON API it is a broken request (`invalid_request`).
	 */
	protected notAnObject(_key: string): void {
		throw new AppError(ErrorCode.InvalidRequest);
	}

	/** Trimmed string; '' / absent -> null (or `required`). */
	text(key: string, opts: { max: number; required: true }): string;
	text(key: string, opts: { max: number; required?: false }): string | null;
	text(key: string, opts: { max: number; required?: boolean }): string | null {
		const value = this.body[key];
		if (blank(value)) {
			if (opts.required) {
				this.fail(key, 'required');
				return '';
			}
			return null;
		}
		if (typeof value !== 'string') {
			this.fail(key, 'invalid');
			return opts.required ? '' : null;
		}
		const trimmed = value.trim();
		if (trimmed.length > opts.max) {
			this.fail(key, 'too_long');
		}
		return trimmed;
	}

	/** `YYYY-MM-DD` date; absent -> null (or `required`). */
	date(key: string, opts: { required: true }): string;
	date(key: string, opts?: { required?: false }): string | null;
	date(key: string, opts: { required?: boolean } = {}): string | null {
		const value = this.body[key];
		if (blank(value)) {
			if (opts.required) {
				this.fail(key, 'required');
				return '';
			}
			return null;
		}
		if (!isIsoDate(value)) {
			this.fail(key, 'invalid_date');
			return opts.required ? '' : null;
		}
		return value;
	}

	/** Positive integer id (number or numeric string); absent -> null (or `required`). */
	id(key: string, opts: { required: true }): number;
	id(key: string, opts?: { required?: false }): number | null;
	id(key: string, opts: { required?: boolean } = {}): number | null {
		const value = this.body[key];
		if (blank(value)) {
			if (opts.required) {
				this.fail(key, 'required');
				return 0;
			}
			return null;
		}
		const n = typeof value === 'string' ? Number(value) : value;
		if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
			this.fail(key, 'invalid');
			return opts.required ? 0 : null;
		}
		return n;
	}

	/**
	 * Whole number in [min, max] (a JSON number, or digits in a string with
	 * optional `,` separators); absent -> null (or `required`).
	 */
	int(key: string, opts: { min: number; max?: number; required: true }): number;
	int(key: string, opts: { min: number; max?: number; required?: false }): number | null;
	int(key: string, opts: { min: number; max?: number; required?: boolean }): number | null {
		const value = this.body[key];
		if (blank(value)) {
			if (opts.required) {
				this.fail(key, 'required');
				return 0;
			}
			return null;
		}
		const n = typeof value === 'string' ? parseDigits(value) : value;
		if (
			typeof n !== 'number' ||
			!Number.isSafeInteger(n) ||
			n < opts.min ||
			n > (opts.max ?? Number.MAX_SAFE_INTEGER)
		) {
			this.fail(key, 'invalid');
			return opts.required ? 0 : null;
		}
		return n;
	}

	/** One of a fixed set of values (required). */
	oneOf<T extends string>(key: string, allowed: readonly T[]): T {
		const value = this.body[key];
		if (blank(value)) {
			this.fail(key, 'required');
			return allowed[0];
		}
		if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
			this.fail(key, 'invalid');
			return allowed[0];
		}
		return value as T;
	}

	/** Optional boolean; absent -> null. */
	flag(key: string): boolean | null {
		const value = this.body[key];
		if (value === undefined || value === null) {
			return null;
		}
		if (typeof value !== 'boolean') {
			this.fail(key, 'invalid');
			return null;
		}
		return value;
	}

	/**
	 * The record version a form was loaded with. Not a user field: a missing
	 * or broken one is a client bug, answered with `invalid_request`.
	 */
	version(key = 'version'): number {
		const value = this.body[key];
		if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
			throw new AppError(ErrorCode.InvalidRequest);
		}
		return value;
	}

	/** Throw the collected field errors, if any. */
	done(): void {
		if (Object.keys(this.errors).length > 0) {
			throw new ValidationError({ ...this.errors });
		}
	}
}

/** Parse a positive integer route parameter. */
export function parseIdParam(value: string | undefined): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n <= 0) {
		throw new AppError(ErrorCode.NotFound);
	}
	return n;
}

/** Page / size from a query string. Size is one of 50 / 100 / 200 (DESIGN.md §2). */
export function readPaging(params: URLSearchParams): { page: number; size: number } {
	const size = Number(params.get('size') ?? 50);
	const page = Number(params.get('page') ?? 1);
	return {
		size: [50, 100, 200].includes(size) ? size : 50,
		page: Number.isInteger(page) && page >= 1 ? page : 1,
	};
}

/** Comma-separated list parameter, empty entries dropped. */
export function readList(params: URLSearchParams, key: string): string[] {
	const raw = params.get(key);
	if (!raw) {
		return [];
	}
	return raw
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

/** Sort direction parameter. */
export function readDir(params: URLSearchParams, fallback: 'asc' | 'desc' = 'asc'): 'asc' | 'desc' {
	const dir = params.get('dir');
	return dir === 'asc' || dir === 'desc' ? dir : fallback;
}
