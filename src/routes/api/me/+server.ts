import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { getSession } from '#lib/server/auth/session.ts';
import { imageUrlOf, peopleIndex } from '#lib/server/domain/directory.ts';
import type { RequestHandler } from './$types';

// Who the caller is, with their directory profile image (one cached index read).
export const GET: RequestHandler = (event) =>
	handle(async () => {
		const actor = actorOf(event);
		return ok(getSession(actor, imageUrlOf(await peopleIndex(), actor.id)));
	});
