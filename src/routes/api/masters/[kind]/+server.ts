import { readMasterName } from '#lib/server/http/bodies.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { addMaster, getMasterList, parseMasterKind } from '#lib/server/domain/masters.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () => ok(await getMasterList(getClient(), actorOf(event), event.params.kind)));

export const POST: RequestHandler = (event) =>
	handle(async () => {
		const name = readMasterName(await readJson(event.request));
		return ok(
			await addMaster(getClient(), actorOf(event), parseMasterKind(event.params.kind), name),
			201,
		);
	});
