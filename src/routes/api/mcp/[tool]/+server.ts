import { requireAdmin } from '#lib/server/auth/guard.ts';
import { getClient } from '#lib/server/db/client.ts';
import { AppError, ErrorCode } from '#lib/server/errors.ts';
import { actorOf, handle, ok, readJson } from '#lib/server/http/handler.ts';
import { asBody } from '#lib/server/http/validate.ts';
import { mcpTool } from '#lib/server/mcp/registry.ts';
import type { RequestHandler } from './$types';

// AI assistant tool calls. The platform's MCP gateway turns a tools/call into
// POST /api/mcp/<tool> with the arguments as the JSON body and the usual
// trusted identity headers; this path is not reachable any other way. A 2xx
// body goes back to the model as the result, and so does a 4xx body (the
// stable error code, `fields` and any `candidates` / `choices`). The actor
// carries `source: 'mcp'` when the gateway marked the call (hooks.server.ts).
export const POST: RequestHandler = (event) => {
	const name = event.params.tool;
	// The user sees only the gateway's request id: it goes into the log line of
	// an unexpected failure, next to the tool.
	const requestId = event.request.headers.get('x-request-id') ?? '-';
	return handle(async () => {
		const tool = mcpTool(name);
		if (!tool) {
			throw new AppError(ErrorCode.McpToolNotFound);
		}
		const actor = actorOf(event);
		if (tool.permission === 'manage') {
			requireAdmin(actor);
		}
		const args = asBody(await readJson(event.request));
		return ok(await tool.run({ db: getClient(), actor, args }));
	}, `mcp ${name}, request id ${requestId}`);
};
