import { listItemAssignments } from '#lib/server/domain/assignments.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await listItemAssignments(getClient(), actorOf(event), parseIdParam(event.params.id))),
	);
