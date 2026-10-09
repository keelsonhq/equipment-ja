import {
	appendFileSync,
	copyFileSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { migrationsDir } from '#lib/server/db/migrate.ts';
import { str } from '#lib/server/db/rows.ts';
import { MigrationError, runMigrations, splitStatements } from '../scripts/migrate.mjs';
import { strictClient } from './support/strict-client.ts';

// The migration runner (scripts/migrate.mjs), used by the CLI and at startup.

const dirs: string[] = [];
const clients: Client[] = [];

afterEach(() => {
	for (const c of clients.splice(0)) {
		c.close();
	}
	for (const d of dirs.splice(0)) {
		rmSync(d, { recursive: true, force: true });
	}
});

function memoryDb(): Client {
	const c = strictClient(createClient({ url: ':memory:' }));
	clients.push(c);
	return c;
}

/** Copy shipped migration files into `dir` (a later release adding them). */
function copyMigrations(dir: string, files: string[]): void {
	for (const f of files) {
		copyFileSync(join(migrationsDir(), f), join(dir, f));
	}
}

/** A temporary migrations directory holding a copy of the given files. */
function tempMigrations(files: string[]): string {
	const dir = mkdtempSync(join(tmpdir(), 'equipment-migrations-'));
	dirs.push(dir);
	copyMigrations(dir, files);
	return dir;
}

async function names(db: Client, type: 'table' | 'index'): Promise<string[]> {
	const res = await db.execute({
		sql: "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
		args: [type],
	});
	return res.rows.map((r) => str(r, 'name'));
}

async function ledger(db: Client) {
	const res = await db.execute(
		'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version',
	);
	return res.rows.map((r) => ({ ...r }));
}

// Every migration shipped in migrations/, in order. Read from the directory so
// that adding a migration (CUSTOMIZE.md §3) needs no change here.
const ALL = readdirSync(migrationsDir())
	.filter((f) => f.endsWith('.sql'))
	.sort()
	.map((f) => f.replace(/\.sql$/, ''));

describe('runMigrations', () => {
	it('applies every migration to an empty database', async () => {
		const db = memoryDb();
		const result = await runMigrations(db, migrationsDir());
		expect(result.applied).toEqual(ALL);
		// At least these; a later migration may add more.
		expect(await names(db, 'table')).toEqual(
			expect.arrayContaining([
				'assignments',
				'attachments',
				'events',
				'item_types',
				'items',
				'places',
				'schema_migrations',
			]),
		);
		expect(await names(db, 'index')).toEqual(
			expect.arrayContaining([
				'idx_assignments_item',
				'idx_assignments_user',
				'idx_attachments_item',
				'idx_events_at',
				'idx_events_item',
				'idx_events_subject',
				'idx_items_name',
				'idx_items_type',
				'ux_assignments_open_item',
			]),
		);
	});

	it('is a no-op the second time', async () => {
		const db = memoryDb();
		await runMigrations(db, migrationsDir());
		const before = await ledger(db);
		const again = await runMigrations(db, migrationsDir());
		expect(again).toEqual({ applied: [], skipped: ALL });
		expect(await ledger(db)).toEqual(before);
	});

	it('stops with migration_checksum_mismatch when an applied file was edited', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql']);
		await runMigrations(db, dir);
		appendFileSync(join(dir, '0001_init.sql'), '\n-- edited after it was applied\n');
		const run = runMigrations(db, dir);
		await expect(run).rejects.toBeInstanceOf(MigrationError);
		await expect(run).rejects.toMatchObject({
			code: 'migration_checksum_mismatch',
			message: expect.stringContaining('0001_init.sql'),
		});
	});

	it('adds a column to a database migrated with an older set of files', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql']);
		await runMigrations(db, dir);
		// A later release ships a new migration; the existing database gets it.
		writeFileSync(
			join(dir, '0002_add_column.sql'),
			'-- Warranty end date (optional).\nALTER TABLE items ADD COLUMN warranty_until TEXT;\n',
		);
		const result = await runMigrations(db, dir);
		expect(result).toEqual({ applied: ['0002_add_column'], skipped: ['0001_init'] });
		const columns = await db.execute('PRAGMA table_info(items)');
		expect(columns.rows.map((r) => str(r, 'name'))).toContain('warranty_until');
		expect((await ledger(db)).map((r) => r.version)).toEqual(['0001_init', '0002_add_column']);
	});

	it('records 0001 on a database created before migrations existed', async () => {
		const db = memoryDb();
		// The pre-migration server created these tables (and app_state) itself.
		await db.execute(
			'CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_tag TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type_id INTEGER, serial_no TEXT, purchased_on TEXT, storage_location TEXT, note TEXT, suspended_reason TEXT, suspended_note TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
		);
		await db.execute(
			'CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)',
		);
		await db.execute(
			"INSERT INTO items (asset_tag, name, created_at, updated_at) VALUES ('PC-1', 'Laptop', 't', 't')",
		);
		const result = await runMigrations(db, migrationsDir());
		expect(result.applied).toEqual(ALL);
		const items = await db.execute('SELECT COUNT(*) AS n FROM items');
		expect(Number(items.rows[0].n)).toBe(1);
		// app_state is left alone (neither used nor dropped).
		expect(await names(db, 'table')).toContain('app_state');
	});

	it('rolls back a failing migration and records nothing', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql']);
		writeFileSync(
			join(dir, '0002_broken.sql'),
			'CREATE TABLE extra (id INTEGER);\nALTER TABLE no_such_table ADD COLUMN x TEXT;\n',
		);
		await expect(runMigrations(db, dir)).rejects.toMatchObject({ code: 'migration_failed' });
		expect(await names(db, 'table')).not.toContain('extra');
		expect((await ledger(db)).map((r) => r.version)).toEqual(['0001_init']);
	});

	it('lets two processes migrate the same database at once', async () => {
		const dir = tempMigrations([]);
		const url = `file:${join(dir, 'shared.db')}`;
		const a = strictClient(createClient({ url }));
		const b = strictClient(createClient({ url }));
		clients.push(a, b);
		const [ra, rb] = await Promise.all([
			runMigrations(a, migrationsDir()),
			runMigrations(b, migrationsDir()),
		]);
		expect([...ra.applied, ...rb.applied].sort()).toEqual(ALL);
		expect([...ra.skipped, ...rb.skipped].sort()).toEqual(ALL);
		expect((await ledger(a)).map((r) => r.version)).toEqual(ALL);
	});

	it('0002 keeps every event in order and accepts the import kind', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql']);
		await runMigrations(db, dir);
		// Same timestamp: only the insertion order (rowid) tells them apart.
		for (const id of ['e-3', 'e-1', 'e-2']) {
			await db.execute({
				sql: `INSERT INTO events (id, at, kind, actor_id, actor_name)
					VALUES (?, '2025-01-01T00:00:00.000Z', 'create', 'u', 'U')`,
				args: [id],
			});
		}
		// Only 0001 and 0002, so a later migration does not change what is applied.
		copyMigrations(dir, ['0002_import_event.sql']);
		const result = await runMigrations(db, dir);
		expect(result).toEqual({ applied: ['0002_import_event'], skipped: ['0001_init'] });
		const rows = await db.execute('SELECT id FROM events ORDER BY at, rowid');
		expect(rows.rows.map((r) => str(r, 'id'))).toEqual(['e-3', 'e-1', 'e-2']);
		await db.execute(
			"INSERT INTO events (id, at, kind, actor_id, actor_name) VALUES ('e-4', 't', 'import', 'u', 'U')",
		);
		await expect(
			db.execute(
				"INSERT INTO events (id, at, kind, actor_id, actor_name) VALUES ('e-5', 't', 'nope', 'u', 'U')",
			),
		).rejects.toThrow(/CHECK/);
		expect(await names(db, 'index')).toEqual(
			expect.arrayContaining(['idx_events_at', 'idx_events_item', 'idx_events_subject']),
		);
		expect(await names(db, 'table')).not.toContain('events_new');
	});

	it('0003 rewrites the type ids of past edits as names', async () => {
		const db = memoryDb();
		const dir = tempMigrations(['0001_init.sql', '0002_import_event.sql']);
		await runMigrations(db, dir);
		await db.execute(
			"INSERT INTO item_types (id, name, created_at, updated_at) VALUES (1, 'Laptop', 't', 't'), (3, 'Phone', 't', 't')",
		);
		// An edit as recorded before 0003: the type by id (9 is no longer in item_types).
		const details = {
			'e-1': { changes: { name: ['A', 'B'], typeId: [1, 3] }, source: 'mcp' },
			'e-2': { changes: { typeId: [null, 9] } },
			'e-3': { changes: { note: [null, 'x'] } },
		};
		for (const [id, detail] of Object.entries(details)) {
			await db.execute({
				sql: `INSERT INTO events (id, at, kind, actor_id, actor_name, detail)
					VALUES (?, 't', 'edit', 'u', 'U', ?)`,
				args: [id, JSON.stringify(detail)],
			});
		}
		copyMigrations(dir, ['0003_history_type_names.sql']);
		await runMigrations(db, dir);
		const rows = await db.execute('SELECT id, detail FROM events ORDER BY id');
		expect(rows.rows.map((r) => JSON.parse(str(r, 'detail')))).toEqual([
			{ changes: { name: ['A', 'B'], type: ['Laptop', 'Phone'] }, source: 'mcp' },
			{ changes: { type: [null, null] } },
			{ changes: { note: [null, 'x'] } },
		]);
	});

	it('rejects a badly named file', async () => {
		const db = memoryDb();
		const dir = tempMigrations([]);
		writeFileSync(join(dir, '2_Add Column.sql'), 'SELECT 1;\n');
		await expect(runMigrations(db, dir)).rejects.toMatchObject({ code: 'migration_invalid_name' });
	});
});

describe('splitStatements', () => {
	it('splits at a semicolon that ends a line and drops comment lines', () => {
		const sql =
			'-- a comment; with a semicolon;\nCREATE TABLE a (\n  x TEXT\n);\n\nCREATE INDEX i ON a (x);  \n-- tail\n';
		expect(splitStatements(sql)).toEqual([
			'CREATE TABLE a (\n  x TEXT\n)',
			'CREATE INDEX i ON a (x)',
		]);
	});
});
