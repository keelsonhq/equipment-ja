import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, requireJsonBody } from '#lib/server/http/handler.ts';
import { resumeItem } from '#lib/server/domain/items.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	handle(async () => {
		await requireJsonBody(event.request);
		return ok(await resumeItem(getClient(), actorOf(event), parseIdParam(event.params.id)));
	});
