import { readMasterPatch } from '#lib/server/http/bodies.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { parseMasterKind, updateMaster } from '#lib/server/domain/masters.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = (event) =>
	handle(async () => {
		const patch = readMasterPatch(await readJson(event.request));
		await updateMaster(
			getClient(),
			actorOf(event),
			parseMasterKind(event.params.kind),
			parseIdParam(event.params.id),
			patch,
		);
		return ok({ ok: true });
	});
