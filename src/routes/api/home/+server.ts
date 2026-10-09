import { getClient } from '#lib/server/db/client.ts';
import { getHome } from '#lib/server/domain/home.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

// The admin home screen in one request.
export const GET: RequestHandler = (event) =>
	handle(async () => ok(await getHome(getClient(), actorOf(event))));
