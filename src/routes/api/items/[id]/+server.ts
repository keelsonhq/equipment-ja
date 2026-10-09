import { readItemEdit } from '#lib/server/http/bodies.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { getItem, updateItem } from '#lib/server/domain/items.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () => ok(await getItem(getClient(), actorOf(event), parseIdParam(event.params.id))));

export const PATCH: RequestHandler = (event) =>
	handle(async () => {
		const { fields, version } = readItemEdit(await readJson(event.request));
		return ok(
			await updateItem(getClient(), actorOf(event), parseIdParam(event.params.id), version, fields),
		);
	});
