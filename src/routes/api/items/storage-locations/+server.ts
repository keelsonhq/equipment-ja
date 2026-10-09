import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { listStorageLocations } from '#lib/server/domain/items.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () => ok(await listStorageLocations(getClient(), actorOf(event))));
