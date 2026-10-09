import { today } from '#lib/server/dates.ts';
import { type FieldErrors, ValidationError, type ValidationExtra } from '#lib/server/errors.ts';
import { Checker } from '#lib/server/http/validate.ts';
import { MCP_LIST_LIMIT } from '#lib/limits.ts';

// Reading AI assistant (MCP) tool arguments. Nothing here is particular to this
// app (its names and records are in refs.ts). Same rules as the JSON API bodies
// (http/bodies.ts): problems are collected per argument and reported at once
// as `validation_failed` + `fields`, keyed by the argument names the model
// sent.
//
// The gateway checks the arguments against keelson.yaml's input schema, but
// calls that do not come through it (local preview, the tests) are not
// checked: a tool reads every argument with ToolArgs as if nothing had been.
//
// A tool reads its arguments in two steps: the plain values (ToolArgs, then
// done()), then the lookups (resolveAll), so every lookup gets a well-formed
// value and all lookup problems are reported together.

/** A Checker with the argument shapes the tools use. */
export class ToolArgs extends Checker {
	/** List size (`limit`): MCP_LIST_LIMIT's default; a larger value than its max is capped. */
	limit(key = 'limit'): number {
		const value = this.body[key];
		if (value === undefined || value === null) {
			return MCP_LIST_LIMIT.default;
		}
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
			this.fail(key, 'invalid');
			return MCP_LIST_LIMIT.default;
		}
		return Math.min(value, MCP_LIST_LIMIT.max);
	}

	/** Optional list of allowed values; absent -> []. Duplicates are dropped. */
	values<T extends string>(key: string, allowed: readonly T[]): T[] {
		const value = this.body[key];
		if (value === undefined || value === null) {
			return [];
		}
		if (
			!Array.isArray(value) ||
			value.some((v) => typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
		) {
			this.fail(key, 'invalid');
			return [];
		}
		return [...new Set(value as T[])];
	}

	/** `YYYY-MM-DD`; omitted -> today in APP_TIME_ZONE. */
	dateOrToday(key: string): string {
		return this.date(key) ?? today();
	}

	/** An optional nested object (`assign_to`), read as tool arguments too. */
	override nested(key: string): ToolArgs | null {
		const body = this.block(key);
		return body && new ToolArgs(body, `${this.prefix}${key}.`, this.errors);
	}

	/**
	 * A nested block that is not an object: the model can fix that, so it is
	 * an `invalid` argument rather than a broken request.
	 */
	protected override notAnObject(key: string): void {
		this.fail(key, 'invalid');
	}
}

type Lookup = () => unknown;
type Resolved<T extends readonly Lookup[]> = {
	-readonly [K in keyof T]: T[K] extends () => infer R ? Awaited<R> : never;
};

/**
 * Run lookups whose failures belong to arguments (ValidationError) and report
 * every failure at once, `fields` and extra lists merged. Any other error
 * (e.g. `people_unavailable`) is thrown as is. A single lookup needs none of
 * this: await it.
 */
export async function resolveAll<T extends readonly Lookup[]>(
	lookups: readonly [...T],
): Promise<Resolved<T>> {
	const settled = await Promise.allSettled(lookups.map(async (lookup) => lookup()));
	const fields: FieldErrors = {};
	const extra: ValidationExtra = {};
	for (const result of settled) {
		if (result.status === 'fulfilled') {
			continue;
		}
		const err: unknown = result.reason;
		if (!(err instanceof ValidationError)) {
			throw err;
		}
		Object.assign(fields, err.fields);
		extra.candidates ??= err.extra.candidates;
		if (err.extra.choices) {
			extra.choices = { ...extra.choices, ...err.extra.choices };
		}
	}
	if (Object.keys(fields).length > 0) {
		throw new ValidationError(fields, extra);
	}
	return settled.map((r) => (r.status === 'fulfilled' ? r.value : null)) as Resolved<T>;
}

/** How names typed by people compare: width, case and spaces do not matter. */
export function normalizeName(value: string): string {
	return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}
