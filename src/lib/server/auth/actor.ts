// Caller identity. The platform gateway is the only source of truth: it
// authenticates the user and injects the X-Keelson-User-* headers, which the
// identity SDK's getRequestUser reads. Locally the same headers come from
// `keelson dev serve`, or, without the CLI, the SDK's local mode answers with
// the roster's admin (scripts/dev.mjs). The app has no local auth of its own.

import { getRequestUser, IdentityError } from '@keelsonhq/identity';

/** The authenticated caller, resolved once per request. */
export interface Actor {
	/** X-Keelson-User-Id — the stable user key stored in records. */
	id: string;
	/** Display name: name header -> email -> shortened id. Never empty. */
	name: string;
	email: string | null;
	/** `manage` grant in X-Keelson-User-App-Perms. */
	isAdmin: boolean;
	/**
	 * Set when the call came through the platform's MCP gateway (an AI
	 * assistant). Recorded in the history detail; never changes what is allowed.
	 */
	source?: 'mcp';
}

// Set by the gateway on calls it makes for an MCP client (POST /api/mcp/*).
const H_AUTH_SOURCE = 'x-keelson-auth-source';

/** name -> email -> shortened id, never empty. */
export function displayNameOf(
	name: string | undefined,
	email: string | undefined,
	id: string,
): string {
	return name ?? email ?? (id.length > 8 ? id.slice(0, 8) : id);
}

/**
 * The caller of a request, or null without a trusted identity (the caller
 * answers 401). `toolPath`: the request is to the AI assistant's tool path
 * (POST /api/mcp/*); only there does the gateway's MCP mark become `source`.
 */
export async function resolveActor(headers: Headers, toolPath = false): Promise<Actor | null> {
	let user;
	try {
		user = await getRequestUser({ headers });
	} catch (err) {
		if (err instanceof IdentityError) {
			return null;
		}
		throw err;
	}
	const actor: Actor = {
		id: user.id,
		name: displayNameOf(user.name ?? undefined, user.email ?? undefined, user.id),
		email: user.email,
		isAdmin: user.perms.includes('manage'),
	};
	if (toolPath && headers.get(H_AUTH_SOURCE)?.trim().toLowerCase() === 'mcp') {
		actor.source = 'mcp';
	}
	return actor;
}
