import type { Client, InArgs, InStatement, TransactionMode } from '@libsql/client';
import { namesIn } from '#lib/server/db/named.ts';

// A libSQL client wrapper that is as strict about named arguments as the
// remote libSQL protocol: an args object must provide exactly the `:name`
// parameters the SQL uses. A local SQLite file silently ignores extra names,
// so without this the tests would pass while production answers 500.

type BatchStatement = InStatement | [string, InArgs?];

/** Throw when named `args` do not match the parameters `sql` uses. */
export function checkNamedArgs(sql: string, args: InArgs | undefined): void {
	if (args === undefined || Array.isArray(args)) {
		return;
	}
	const used = namesIn(sql);
	const extra = Object.keys(args).filter((name) => !used.has(name));
	const missing = [...used].filter((name) => !Object.hasOwn(args, name));
	if (extra.length > 0 || missing.length > 0) {
		throw new Error(
			`named SQL arguments do not match the statement (remote libSQL rejects this): ` +
				`unused [${extra.join(', ')}] missing [${missing.join(', ')}] in: ${sql.slice(0, 120)}`,
		);
	}
}

function checkStatement(stmt: BatchStatement): void {
	if (typeof stmt === 'string') {
		return;
	}
	if (Array.isArray(stmt)) {
		checkNamedArgs(stmt[0], stmt[1]);
		return;
	}
	checkNamedArgs(stmt.sql, stmt.args);
}

/**
 * Wrap `client` so execute / batch enforce the remote named-argument rule. A
 * violation is returned as a rejected promise (as the remote client would),
 * not thrown synchronously, so every statement of a Promise.all is checked.
 */
export function strictClient(client: Client): Client {
	return new Proxy(client, {
		get(target, prop) {
			if (prop === 'execute') {
				return (stmt: InStatement, args?: InArgs) => {
					try {
						if (typeof stmt === 'string') {
							checkNamedArgs(stmt, args);
						} else {
							checkStatement(stmt);
						}
					} catch (err) {
						return Promise.reject(err);
					}
					return typeof stmt === 'string' && args !== undefined
						? target.execute(stmt, args)
						: target.execute(stmt);
				};
			}
			if (prop === 'batch') {
				return (stmts: BatchStatement[], mode?: TransactionMode) => {
					try {
						for (const stmt of stmts) {
							checkStatement(stmt);
						}
					} catch (err) {
						return Promise.reject(err);
					}
					return target.batch(stmts, mode);
				};
			}
			const value = Reflect.get(target, prop, target);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}
