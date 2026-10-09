import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { getMe } from '#lib/server/domain/people.ts';
import type { RequestHandler } from './$types';

// The caller's own holdings and ledger. Available to every signed-in user.
export const GET: RequestHandler = (event) =>
	handle(async () => ok(await getMe(getClient(), actorOf(event))));
