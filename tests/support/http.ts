import type { RequestEvent } from '@sveltejs/kit';
import { handle as hook } from '../../src/hooks.server.ts';
import * as mcpRoute from '../../src/routes/api/mcp/[tool]/+server.ts';

// Calls a +server.ts handler through the real `handle` hook (authentication),
// exactly as in the built server, without opening a port. The environment the
// hook reads (local preview or not) is harness.ts `freshDb`'s.

// Route handlers are typed per route; `never` accepts any of them.
export type Handler = (event: never) => Response | Promise<Response>;

export interface CallOptions {
	headers?: Record<string, string>;
	json?: unknown;
	body?: BodyInit;
	params?: Record<string, string>;
}

/** What a handler answered: the status, the body (JSON parsed, or text) and the response. */
export interface CallResult {
	status: number;
	body: unknown;
	res: Response;
}

export async function call(
	handler: Handler | undefined,
	method: string,
	path: string,
	opts: CallOptions = {},
): Promise<CallResult> {
	if (!handler) {
		throw new Error(`no ${method} handler for ${path}`);
	}
	const url = new URL(`http://app.test${path}`);
	const headers = new Headers(opts.headers);
	let body = opts.body;
	if (opts.json !== undefined) {
		headers.set('content-type', 'application/json');
		body = JSON.stringify(opts.json);
	}
	const request = new Request(url, { method, headers, body });
	const event = {
		request,
		url,
		params: opts.params ?? {},
		locals: {},
		route: { id: null },
	} as unknown as RequestEvent;
	const res = await hook({ event, resolve: async (e) => handler(e as never) });
	const type = res.headers.get('content-type') ?? '';
	const raw = res.clone();
	const parsed = type.includes('application/json') ? await res.json() : await res.text();
	return { status: res.status, body: parsed, res: raw };
}

/** Someone the trusted gateway headers can name. */
export interface Caller {
	id: string;
	name: string;
	email: string | null;
	isAdmin: boolean;
}

/** Trusted gateway headers for a caller. */
export function as(actor: Caller) {
	return {
		'x-keelson-user-id': actor.id,
		'x-keelson-user-name': actor.name,
		'x-keelson-user-email': actor.email ?? '',
		'x-keelson-user-app-perms': actor.isAdmin ? 'view,manage' : 'view',
	};
}

/**
 * Call an AI assistant tool (POST /api/mcp/<name>) the way the platform's MCP
 * gateway does: the arguments as the JSON body, trusted headers and the MCP
 * markers.
 */
export function callTool(name: string, args: unknown, actor: Caller): Promise<CallResult> {
	return call(mcpRoute.POST, 'POST', `/api/mcp/${name}`, {
		headers: {
			...as(actor),
			'x-keelson-auth-source': 'mcp',
			'x-keelson-mcp-tool': name,
			'x-request-id': 'req-test',
		},
		json: args,
		params: { tool: name },
	});
}
