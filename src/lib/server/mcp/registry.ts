import type { Client } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import type { Body } from '#lib/server/http/validate.ts';
import * as tools from './tools.ts';

// The AI assistant (MCP) tool registry. The platform gateway speaks MCP and
// OAuth; the app only answers POST /api/mcp/<tool> with JSON. Every tool is
// declared in two places that must agree (tests/mcp-manifest.test.ts checks it):
// keelson.yaml `mcp.tools` (what the model sees: description, input schema,
// access, permission) and MCP_TOOLS below (what runs).

export interface McpToolContext {
	db: Client;
	actor: Actor;
	/**
	 * The tool arguments (the request body). The gateway checks them against
	 * the input schema, but local preview and the tests do not go through it:
	 * a tool checks every argument itself (ToolArgs in args.ts).
	 */
	args: Body;
}

export interface McpTool {
	/** `read` tools are listed as read-only; `write` tools need the write scope. */
	access: 'read' | 'write';
	/** `manage`: admins only (also enforced by the business layer itself). */
	permission: 'view' | 'manage';
	run(ctx: McpToolContext): Promise<unknown>;
}

export const MCP_TOOLS: Record<string, McpTool> = {
	find_items: { access: 'read', permission: 'manage', run: tools.findItems },
	find_available_items: { access: 'read', permission: 'view', run: tools.findAvailableItems },
	get_item: { access: 'read', permission: 'manage', run: tools.getItem },
	my_items: { access: 'read', permission: 'view', run: tools.myItems },
	member_items: { access: 'read', permission: 'manage', run: tools.memberItems },
	list_masters: { access: 'read', permission: 'view', run: tools.listMasters },
	register_item: { access: 'write', permission: 'manage', run: tools.registerItem },
	issue_item: { access: 'write', permission: 'manage', run: tools.issueItem },
	take_item: { access: 'write', permission: 'view', run: tools.takeItem },
	return_item: { access: 'write', permission: 'view', run: tools.returnItem },
	suspend_item: { access: 'write', permission: 'manage', run: tools.suspendItem },
	resume_item: { access: 'write', permission: 'manage', run: tools.resumeItem },
};

/** The tool called `name`, or null (never an inherited key such as `constructor`). */
export function mcpTool(name: string): McpTool | null {
	return Object.hasOwn(MCP_TOOLS, name) ? MCP_TOOLS[name] : null;
}
