import type { Row, Value } from '@libsql/client';

// libSQL rows are loosely typed. These readers coerce one column at a time so
// the mapping code reads as a list of fields. A column the SELECT does not
// return is a bug in the query, so reading one throws instead of giving a
// default (NULL values are read as usual).

// Text of a non-null value, as String() gives it. No column read as text holds
// a BLOB (ArrayBuffer); one would read as its object tag, "[object ArrayBuffer]".
function text(v: Exclude<Value, null>): string {
	return v instanceof ArrayBuffer ? Object.prototype.toString.call(v) : String(v);
}

// The value of `key`; throws when the row has no such column.
function value(row: Row, key: string): Value {
	const v = row[key];
	if (v === undefined) {
		throw new Error(`column "${key}" is not in the query result`);
	}
	return v;
}

export function str(row: Row, key: string): string {
	const v = value(row, key);
	return v === null ? '' : text(v);
}

export function strOrNull(row: Row, key: string): string | null {
	const v = value(row, key);
	return v === null ? null : text(v);
}

export function num(row: Row, key: string): number {
	const v = value(row, key);
	return v === null ? 0 : Number(v);
}

export function numOrNull(row: Row, key: string): number | null {
	const v = value(row, key);
	return v === null ? null : Number(v);
}

export function bool(row: Row, key: string): boolean {
	return Number(value(row, key) ?? 0) === 1;
}
