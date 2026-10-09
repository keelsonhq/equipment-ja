import type { Client } from '@libsql/client';
import { migrate } from '#lib/server/db/migrate.ts';
import { localSampleDataRequested } from './env.ts';
import { ensureDefaultMasters, seedSampleDataIfEmpty } from '#lib/server/domain/seed.ts';

// Startup work, run once per process (and per client in tests): apply the
// migrations, insert the default item types / usage places into empty lists,
// and, in local development only, load the sample ledger into an empty database.
// A failure here must stop the server from starting (hooks.server.ts init).
const ready = new WeakMap<Client, Promise<void>>();

export function ensureReady(db: Client): Promise<void> {
	let pending = ready.get(db);
	if (!pending) {
		pending = (async () => {
			await migrate(db);
			await ensureDefaultMasters(db);
			if (localSampleDataRequested()) {
				await seedSampleDataIfEmpty(db);
			}
		})();
		// A failed start must be retried on the next request, not cached.
		pending.catch(() => ready.delete(db));
		ready.set(db, pending);
	}
	return pending;
}
