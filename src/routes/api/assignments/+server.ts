import { issueItem } from '#lib/server/domain/assignments.ts';
import { readIssueInput } from '#lib/server/http/bodies.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

// Issue an item (admin: to anyone; member: to oneself). Exchange when
// `exchangeFrom` is set (admin).
export const POST: RequestHandler = (event) =>
	handle(async () => {
		const input = readIssueInput(await readJson(event.request));
		return ok(await issueItem(getClient(), actorOf(event), input), 201);
	});
