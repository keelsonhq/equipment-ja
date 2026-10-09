// Database migrations: numbered SQL files in migrations/, applied in order,
// forward only, each recorded in the schema_migrations ledger with its sha256.
//
// One implementation, two entry points:
//   - CLI: `node scripts/migrate.mjs` (keelson.yaml `db.migrate`, run once per
//     deploy before traffic moves to the new revision; also handy locally).
//   - Server startup: src/lib/server/db/migrate.ts imports runMigrations, so
//     local dev, tests and every container are migrated before serving.
//
// Only the Node standard library and @libsql/client. The CLI does not depend
// on the build output (build/), so it runs in a fresh deploy image.
//
// File rules (the migration rules in CUSTOMIZE.md §3):
//   - name: NNNN_slug.sql (4 digits, lowercase slug), applied in name order
//   - a statement ends with ";" at the end of a line; "--" comment lines are
//     ignored; no ";" inside a statement (so no triggers)
//   - an applied file must never be edited: its checksum would no longer match
//     and every start fails with migration_checksum_mismatch
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Default location of the migration files. */
export const MIGRATIONS_DIR = join(APP_ROOT, 'migrations');

const NAME_RE = /^(\d{4})_[a-z0-9_]+\.sql$/;
const BUSY_RETRIES = 5;

/** A migration failure with a stable code (the process must not start). */
export class MigrationError extends Error {
	/**
	 * @param {'migration_checksum_mismatch' | 'migration_failed' | 'migration_invalid_name'} code
	 * @param {string} message
	 * @param {unknown} [cause]
	 */
	constructor(code, message, cause) {
		super(`${code}: ${message}`, cause === undefined ? undefined : { cause });
		this.name = 'MigrationError';
		this.code = code;
	}
}

/**
 * Split a migration file into statements: drop "--" comment lines, then cut
 * at every ";" that ends a line. Empty pieces are skipped.
 * @param {string} text
 * @returns {string[]}
 */
export function splitStatements(text) {
	const code = text
		.split(/\r?\n/)
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n');
	return code
		.split(/;[ \t]*$/m)
		.map((s) => s.trim())
		.filter((s) => s !== '');
}

/**
 * The migration files in `dir`, sorted, with their checksums.
 * @param {string} dir
 * @returns {{ version: string; file: string; sql: string; checksum: string }[]}
 */
export function readMigrations(dir) {
	const names = readdirSync(dir)
		.filter((name) => name.endsWith('.sql'))
		.sort();
	const seen = new Set();
	return names.map((name) => {
		const match = NAME_RE.exec(name);
		if (!match) {
			throw new MigrationError(
				'migration_invalid_name',
				`${name} (expected NNNN_slug.sql, e.g. 0002_add_warranty.sql)`,
			);
		}
		if (seen.has(match[1])) {
			throw new MigrationError('migration_invalid_name', `duplicate number ${match[1]} (${name})`);
		}
		seen.add(match[1]);
		const bytes = readFileSync(join(dir, name));
		return {
			version: basename(name, '.sql'),
			file: name,
			sql: bytes.toString('utf8'),
			checksum: createHash('sha256').update(bytes).digest('hex'),
		};
	});
}

/** @param {unknown} err */
function isBusy(err) {
	const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
	return /SQLITE_BUSY|database is locked/i.test(text);
}

/** @param {number} ms */
function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import('@libsql/client').Client} client
 * @param {string} version
 * @returns {Promise<string | null>} the recorded checksum, or null
 */
async function recordedChecksum(client, version) {
	const res = await client.execute({
		sql: 'SELECT checksum FROM schema_migrations WHERE version = ?',
		args: [version],
	});
	const row = res.rows[0];
	// The column is TEXT NOT NULL.
	return row ? /** @type {string} */ (row.checksum) : null;
}

/**
 * Apply every pending migration in `dir`, in name order. Each file and its
 * ledger row are written in ONE transaction. Already-applied files are
 * skipped; an applied file whose content changed stops everything.
 *
 * Safe to run concurrently (web and cron containers): a busy database is
 * retried with a short backoff, and a migration another process applied in
 * the meantime is recognised from the ledger and skipped.
 *
 * @param {import('@libsql/client').Client} client
 * @param {string} [dir]
 * @param {{ log?: (line: string) => void }} [opts]
 * @returns {Promise<{ applied: string[]; skipped: string[] }>}
 */
export async function runMigrations(client, dir = MIGRATIONS_DIR, opts = {}) {
	const log = opts.log ?? (() => {});
	await client.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version    TEXT PRIMARY KEY,
		checksum   TEXT NOT NULL,
		applied_at TEXT NOT NULL
	)`);
	const applied = [];
	const skipped = [];

	for (const migration of readMigrations(dir)) {
		const done = await recordedChecksum(client, migration.version);
		if (done !== null) {
			if (done !== migration.checksum) {
				throw new MigrationError(
					'migration_checksum_mismatch',
					`${migration.file} was changed after it was applied. Applied files must not be edited; add a new migration instead.`,
				);
			}
			skipped.push(migration.version);
			continue;
		}

		const statements = [
			...splitStatements(migration.sql),
			{
				sql: 'INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)',
				args: [migration.version, migration.checksum, new Date().toISOString()],
			},
		];
		for (let attempt = 0; ; attempt++) {
			try {
				await client.batch(statements, 'write');
				applied.push(migration.version);
				log(`[migrate] applied ${migration.file}`);
				break;
			} catch (err) {
				// Another process may have applied it while we waited or failed.
				const now = await recordedChecksum(client, migration.version).catch(() => null);
				if (now === migration.checksum) {
					skipped.push(migration.version);
					break;
				}
				if (isBusy(err) && attempt < BUSY_RETRIES) {
					await sleep(50 * 2 ** attempt);
					continue;
				}
				throw new MigrationError(
					'migration_failed',
					`${migration.file}: ${err?.message ?? err}`,
					err,
				);
			}
		}
	}
	return { applied, skipped };
}

/**
 * Database settings: the platform's KEELSON_DB_URL / KEELSON_DB_AUTH_TOKEN (or
 * the legacy aliases), else LOCAL_DB_URL, else the local file ./local.db. The
 * server uses this function too (src/lib/server/env.ts dbConfig), so the CLI
 * and the app always open the same database.
 * @param {Record<string, string | undefined>} env
 */
export function dbConfigFromEnv(env = process.env) {
	/** @param {string} name */
	const read = (name) => {
		const value = env[name];
		return value === undefined || value.trim() === '' ? undefined : value.trim();
	};
	const url = read('KEELSON_DB_URL') ?? read('TURSO_DATABASE_URL');
	if (url) {
		return { url, authToken: read('KEELSON_DB_AUTH_TOKEN') ?? read('TURSO_AUTH_TOKEN') };
	}
	return { url: read('LOCAL_DB_URL') ?? 'file:./local.db' };
}

async function main() {
	const client = createClient(dbConfigFromEnv());
	try {
		const { applied, skipped } = await runMigrations(client, MIGRATIONS_DIR, {
			log: (line) => console.log(line),
		});
		console.log(`[migrate] done: ${applied.length} applied, ${skipped.length} already applied`);
	} catch (err) {
		console.error(`[migrate] ${err instanceof Error ? err.message : String(err)}`);
		process.exitCode = 1;
	} finally {
		client.close();
	}
}

// Run as a CLI only when invoked directly (`node scripts/migrate.mjs`); importing
// must not touch a database. Both sides are real paths: Node resolves symlinks
// in import.meta.url but not in argv[1] (macOS /tmp is one).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
