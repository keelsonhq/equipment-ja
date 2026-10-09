import { readItemCreate } from '#lib/server/http/bodies.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { createItem, listItems } from '#lib/server/domain/items.ts';
import { parseItemQuery } from '#lib/server/http/queries.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await listItems(getClient(), actorOf(event), parseItemQuery(event.url.searchParams))),
	);

export const POST: RequestHandler = (event) =>
	handle(async () => {
		const { fields, assignment } = readItemCreate(await readJson(event.request));
		return ok(await createItem(getClient(), actorOf(event), fields, assignment), 201);
	});
