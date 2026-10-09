import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { listMembersPage } from '#lib/server/domain/people.ts';
import { parseMemberQuery } from '#lib/server/http/queries.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(
			await listMembersPage(getClient(), actorOf(event), parseMemberQuery(event.url.searchParams)),
		),
	);
