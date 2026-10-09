import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { resolveActor } from '#lib/server/auth/actor.ts';
import { getClient } from '#lib/server/db/client.ts';
import { ErrorCode, errorResponse } from '#lib/server/errors.ts';
import { ensureReady } from '#lib/server/ready.ts';

// Prepare the database before the first request is served: migrations and the
// default types / places, and the sample ledger in local development only
// (ready.ts).
export const init: ServerInit = async () => {
	await ensureReady(getClient());
};

/**
 * Authentication for the API. Every /api/* request needs a trusted identity
 * (the gateway's headers, read by the identity SDK) or gets 401.
 *
 * The page shell itself carries no data (the app renders client-side and reads
 * everything through /api), so it is served without an identity — the platform
 * still requires a login before any request reaches the app.
 */
export const handle: Handle = async ({ event, resolve }) => {
	if (!event.url.pathname.startsWith('/api/')) {
		return resolve(event);
	}
	await ensureReady(getClient());
	const actor = await resolveActor(
		event.request.headers,
		event.url.pathname.startsWith('/api/mcp/'),
	);
	if (!actor) {
		return errorResponse(ErrorCode.Unauthorized);
	}
	event.locals.actor = actor;
	return resolve(event);
};
