import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { parse } from 'yaml';
import { MCP_LIST_LIMIT } from '#lib/limits.ts';
import { MCP_TOOLS } from '#lib/server/mcp/registry.ts';
import { ADMIN, cleanupDbs, freshDb } from './support/harness.ts';
import { callTool } from './support/http.ts';

// The AI assistant (MCP) tools as keelson.yaml declares them to the platform:
// the declarations agree with the registry (src/lib/server/mcp/registry.ts),
// stay within the platform limits, and each declared maxLength is the limit
// the tool enforces. What the tools do is tests/mcp.test.ts.

afterEach(cleanupDbs);

interface Schema {
	type: string;
	description?: string;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: boolean;
	enum?: string[];
	format?: string;
	maxLength?: number;
	minimum?: number;
	maximum?: number;
}

interface ManifestTool {
	name: string;
	description: string;
	access: string;
	permission?: string;
	input: Schema;
}

const manifest = parse(readFileSync(new URL('../keelson.yaml', import.meta.url), 'utf8')) as {
	mcp: { enabled: boolean; instructions: string; tools: ManifestTool[] };
};

/** Length as the platform counts it: Unicode code points (Python len, Go runes). */
function codePoints(text: string): number {
	return Array.from(text).length;
}

/** Every free-text argument (a string without `enum` / `format`), by its path in the input. */
function textArgs(schema: Schema, path: string[] = []): [string[], Schema][] {
	const out: [string[], Schema][] = [];
	for (const [key, child] of Object.entries(schema.properties ?? {})) {
		if (child.type === 'object') {
			out.push(...textArgs(child, [...path, key]));
		} else if (child.type === 'string' && !child.enum && !child.format) {
			out.push([[...path, key], child]);
		}
	}
	return out;
}

/** Arguments with `value` at `path` (`['assign_to', 'person']` -> `{ assign_to: { person } }`). */
function argsAt(path: string[], value: string): Record<string, unknown> {
	return path.reduceRight<unknown>((inner, key) => ({ [key]: inner }), value) as Record<
		string,
		unknown
	>;
}

/** Every object schema in `schema`, with its path. */
function objectSchemas(schema: Schema, path: string): [string, Schema][] {
	const out: [string, Schema][] = schema.type === 'object' ? [[path, schema]] : [];
	for (const [key, child] of Object.entries(schema.properties ?? {})) {
		out.push(...objectSchemas(child, `${path}.${key}`));
	}
	return out;
}

/** The field reasons of a tool's answer (none for a result or a bare error code). */
async function fieldReasons(name: string, args: unknown): Promise<Record<string, string>> {
	const { body } = await callTool(name, args, ADMIN);
	return (body as { fields?: Record<string, string> }).fields ?? {};
}

describe('keelson.yaml mcp block', () => {
	const tools = manifest.mcp.tools;

	it('is enabled and within the platform limits', () => {
		expect(manifest.mcp.enabled).toBe(true);
		expect(tools.length).toBeGreaterThan(0);
		expect(tools.length).toBeLessThanOrEqual(40);
		expect(codePoints(manifest.mcp.instructions)).toBeLessThanOrEqual(4096);
		for (const t of tools) {
			expect(t.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
			expect(codePoints(t.description)).toBeLessThanOrEqual(1024);
		}
		expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
	});

	it('declares exactly the registry tools, with the same access and permission', () => {
		expect(new Set(tools.map((t) => t.name))).toEqual(new Set(Object.keys(MCP_TOOLS)));
		for (const t of tools) {
			const impl = MCP_TOOLS[t.name];
			expect({ name: t.name, access: t.access, permission: t.permission ?? 'view' }).toEqual({
				name: t.name,
				access: impl.access,
				permission: impl.permission,
			});
		}
	});

	it('has object inputs whose required arguments exist and are described', () => {
		for (const t of tools) {
			expect(t.input.type).toBe('object');
			for (const [path, schema] of objectSchemas(t.input, t.name)) {
				const props = Object.keys(schema.properties ?? {});
				for (const key of schema.required ?? []) {
					expect(props, `${path} requires ${key}`).toContain(key);
				}
				expect(schema.additionalProperties, `${path} additionalProperties`).toBe(false);
				for (const [key, child] of Object.entries(schema.properties ?? {})) {
					expect(child.description, `${path}.${key} description`).toBeTruthy();
				}
			}
		}
	});

	it('bounds every free-text argument and every list size', () => {
		for (const t of tools) {
			for (const [path, schema] of textArgs(t.input)) {
				expect(schema.maxLength, `${t.name}.${path.join('.')} maxLength`).toBeGreaterThan(0);
			}
			const limit = t.input.properties?.limit;
			if (limit) {
				expect([limit.minimum, limit.maximum], `${t.name}.limit`).toEqual([1, MCP_LIST_LIMIT.max]);
			}
		}
	});
});

// Each declared maxLength is the limit the tool itself enforces, which it reads
// from src/lib/limits.ts: one character more is `too_long`, the limit is not.
describe('keelson.yaml maxLength', () => {
	it('is the length limit each tool enforces (src/lib/limits.ts)', async () => {
		await freshDb();
		for (const t of manifest.mcp.tools) {
			for (const [path, schema] of textArgs(t.input)) {
				const field = path.join('.');
				const max = schema.maxLength ?? 0;
				const over = await fieldReasons(t.name, argsAt(path, 'x'.repeat(max + 1)));
				expect(over[field], `${t.name}.${field} with ${max + 1} chars`).toBe('too_long');
				const at = await fieldReasons(t.name, argsAt(path, 'x'.repeat(max)));
				expect(at[field], `${t.name}.${field} with ${max} chars`).not.toBe('too_long');
			}
		}
	});
});
