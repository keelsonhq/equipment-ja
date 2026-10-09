import { readSuspend } from '#lib/server/http/bodies.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { suspendItem } from '#lib/server/domain/items.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	handle(async () => {
		const { reason, note } = readSuspend(await readJson(event.request));
		return ok(
			await suspendItem(getClient(), actorOf(event), parseIdParam(event.params.id), reason, note),
		);
	});
