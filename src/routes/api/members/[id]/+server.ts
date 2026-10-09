import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { getMember } from '#lib/server/domain/people.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () => ok(await getMember(getClient(), actorOf(event), event.params.id)));
