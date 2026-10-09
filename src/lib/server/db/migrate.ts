import { resolve } from 'node:path';
import type { Client } from '@libsql/client';
import { runMigrations } from '../../../../scripts/migrate.mjs';

// Server-side entry to the shared migration runner (scripts/migrate.mjs). The
// schema lives only in migrations/*.sql; never write DDL in application code.
//
// The directory is resolved from the working directory, not from this file:
// in the built server this module is bundled under build/, while the SQL files
// stay in migrations/ at the app root (the platform, `pnpm start`, `pnpm dev`
// and the tests all run from the app root).
export function migrationsDir(): string {
	return resolve(process.cwd(), 'migrations');
}

/** Apply pending migrations. Throws (and the server must not start) on failure. */
export async function migrate(db: Client): Promise<void> {
	await runMigrations(db, migrationsDir(), {
		log: (line: string) => console.log(line),
	});
}
