import type { Actor } from '#lib/server/auth/actor.ts';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			/** The authenticated caller; set by hooks.server.ts for /api/* routes. */
			actor?: Actor;
		}
	}
}
