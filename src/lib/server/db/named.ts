import type { InStatement, InValue } from '@libsql/client';

// Named SQL parameters (`:name`). A local SQLite file ignores named arguments
// that the statement does not use, but the remote libSQL protocol rejects
// them. Every statement that takes an args object therefore goes through
// bindNamed, which passes exactly the names the SQL uses.
//
// Which form a statement uses:
// - Positional `?` when the statement takes at most three values, each used
//   once, all written in the statement's own text (`WHERE id = ?`).
// - Named, through namedStatement, otherwise: four or more values, a value used
//   more than once, or values that come with a part of the SQL (a shared
//   fragment such as the item status's `:today`, an optional condition, an IN
//   list). Each part brings its own names, so nothing depends on the order the
//   values were added in.

export type NamedArgs = Record<string, InValue>;

// `:name` not preceded by another `:` or a word character (so `a::b` casts and
// `x:y` inside identifiers are not taken for parameters).
const NAME_RE = /(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)/g;

/** The `:name` parameters a statement uses (string literals are skipped). */
export function namesIn(sql: string): Set<string> {
	const withoutLiterals = sql.replace(/'(?:[^']|'')*'/g, "''");
	const names = new Set<string>();
	for (const match of withoutLiterals.matchAll(NAME_RE)) {
		names.add(match[1]);
	}
	return names;
}

/**
 * Narrow `args` to the names `sql` uses. Throws when the SQL uses a name that
 * `args` does not provide (a bug in the caller, caught before the query runs).
 */
export function bindNamed(sql: string, args: NamedArgs): NamedArgs {
	const bound: NamedArgs = {};
	for (const name of namesIn(sql)) {
		if (!Object.hasOwn(args, name)) {
			throw new Error(`missing named SQL argument :${name}`);
		}
		bound[name] = args[name];
	}
	return bound;
}

/** A statement whose named args are narrowed by bindNamed. */
export function namedStatement(sql: string, args: NamedArgs): InStatement {
	return { sql, args: bindNamed(sql, args) };
}

/**
 * The parameters of an `IN (...)` list: `:name0, :name1, …`, each value added
 * to `args` under its name.
 */
export function namedList(name: string, values: readonly InValue[], args: NamedArgs): string {
	return values
		.map((value, i) => {
			args[`${name}${i}`] = value;
			return `:${name}${i}`;
		})
		.join(', ');
}
