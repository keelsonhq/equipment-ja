import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vite-plus/test';
import {
	bindNamed,
	type NamedArgs,
	namedList,
	namedStatement,
	namesIn,
} from '#lib/server/db/named.ts';
import { strictClient } from './support/strict-client.ts';

describe('bindNamed', () => {
	it('keeps only the names the SQL uses', () => {
		const sql = 'SELECT * FROM items WHERE type_id = :typeId LIMIT :limit';
		expect(bindNamed(sql, { typeId: 3, limit: 50, today: '2026-01-01' })).toEqual({
			typeId: 3,
			limit: 50,
		});
	});

	it('returns an empty object when the SQL uses no names', () => {
		expect(bindNamed('SELECT COUNT(*) AS n FROM items', { today: '2026-01-01' })).toEqual({});
	});

	it('binds a repeated name once and keeps null values', () => {
		const sql = 'SELECT 1 WHERE a LIKE :q OR b LIKE :q OR c = :c';
		expect(bindNamed(sql, { q: '%x%', c: null })).toEqual({ q: '%x%', c: null });
	});

	it('throws when the SQL uses a name the args do not provide', () => {
		expect(() => bindNamed('SELECT 1 WHERE id = :id', {})).toThrow(/:id/);
	});

	it('ignores colons inside string literals and casts', () => {
		const sql = "SELECT ':notParam', '10:30', x::text FROM t WHERE id = :id0 AND y = ':also''not'";
		expect([...namesIn(sql)]).toEqual(['id0']);
	});

	it('builds a statement with narrowed args', () => {
		expect(namedStatement('SELECT :a', { a: 1, b: 2 })).toEqual({
			sql: 'SELECT :a',
			args: { a: 1 },
		});
	});

	it('names each value of an IN list and adds it to the args', () => {
		const args: NamedArgs = { q: 'x' };
		expect(namedList('kind', ['issue', 'return'], args)).toBe(':kind0, :kind1');
		expect(args).toEqual({ q: 'x', kind0: 'issue', kind1: 'return' });
	});
});

describe('strict test client', () => {
	it('rejects named args the SQL does not use, like remote libSQL', async () => {
		const db = strictClient(createClient({ url: ':memory:' }));
		await expect(
			db.execute({ sql: 'SELECT COUNT(*) AS n FROM sqlite_master', args: { today: 'x' } }),
		).rejects.toThrow(/unused \[today\]/);
		await expect(db.batch([{ sql: 'SELECT :a', args: { a: 1, b: 2 } }], 'read')).rejects.toThrow(
			/unused \[b\]/,
		);
		const ok = await db.execute({ sql: 'SELECT :a AS a', args: { a: 1 } });
		expect(Number(ok.rows[0].a)).toBe(1);
		db.close();
	});
});
