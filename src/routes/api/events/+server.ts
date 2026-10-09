import { getClient } from '#lib/server/db/client.ts';
import { listEvents } from '#lib/server/domain/events.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { parseEventQuery } from '#lib/server/http/queries.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await listEvents(getClient(), actorOf(event), parseEventQuery(event.url.searchParams))),
	);
