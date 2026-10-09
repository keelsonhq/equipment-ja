import { correctAssignment } from '#lib/server/domain/assignments.ts';
import { readCorrectInput } from '#lib/server/http/bodies.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) =>
	handle(async () => {
		const input = readCorrectInput(await readJson(event.request));
		return ok(await correctAssignment(getClient(), actorOf(event), event.params.id, input));
	});
