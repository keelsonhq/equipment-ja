import { type Client, createClient } from '@libsql/client';
import { dbConfig } from '#lib/server/env.ts';

// One process-wide libSQL client. The API is async. A write is one `batch()`
// (one atomic transaction) or one statement, so no interactive transaction
// ever holds a connection across awaits.
let client: Client | undefined;

/** The process-wide libSQL client, created on first use. */
export function getClient(): Client {
	if (!client) {
		client = createClient(dbConfig());
	}
	return client;
}

/** Replace the client (tests). Closes the previous one. */
export function setClientForTest(next: Client): void {
	client?.close();
	client = next;
}
