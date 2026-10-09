import { getClient } from '#lib/server/db/client.ts';
import { handle, ok } from '#lib/server/http/handler.ts';
import { listAvailableItems } from '#lib/server/domain/items.ts';
import { parseAvailableQuery } from '#lib/server/http/queries.ts';
import type { RequestHandler } from './$types';

// Items any signed-in user may assign to themselves (limited columns).
export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await listAvailableItems(getClient(), parseAvailableQuery(event.url.searchParams))),
	);
