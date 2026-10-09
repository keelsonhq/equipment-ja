import { afterEach, describe, expect, it } from 'vite-plus/test';
import { resolveActor } from '#lib/server/auth/actor.ts';

afterEach(() => {
	delete process.env.KEELSON_LOCAL_MODE;
	delete process.env.KEELSON_LOCAL_USERS_FILE;
});

describe('resolveActor', () => {
	it('reads the gateway headers and the manage grant', async () => {
		const actor = await resolveActor(
			new Headers({ 'X-Keelson-User-Id': 'u1', 'X-Keelson-User-App-Perms': 'view,manage' }),
		);
		expect(actor).toMatchObject({ id: 'u1', isAdmin: true });
		const member = await resolveActor(
			new Headers({ 'X-Keelson-User-Id': 'u2', 'X-Keelson-User-App-Perms': 'view' }),
		);
		expect(member).toMatchObject({ id: 'u2', isAdmin: false });
	});

	it('answers null without the gateway headers', async () => {
		expect(await resolveActor(new Headers())).toBeNull();
		// The old local-preview headers mean nothing.
		expect(
			await resolveActor(new Headers({ 'X-Dev-User-Id': 'dev', 'X-Dev-User-App-Perms': 'manage' })),
		).toBeNull();
	});

	it("marks an MCP call only on the tool path, from the gateway's header", async () => {
		const mcp = new Headers({ 'X-Keelson-User-Id': 'u1', 'X-Keelson-Auth-Source': 'MCP' });
		expect((await resolveActor(mcp, true))?.source).toBe('mcp');
		expect((await resolveActor(mcp))?.source).toBeUndefined();
		expect(
			(await resolveActor(new Headers({ 'X-Keelson-User-Id': 'u1' }), true))?.source,
		).toBeUndefined();
	});

	it('falls back name -> email -> short id for the display name', async () => {
		const byEmail = await resolveActor(
			new Headers({ 'X-Keelson-User-Id': 'u2', 'X-Keelson-User-Email': 'a@example.com' }),
		);
		expect(byEmail?.name).toBe('a@example.com');
		const byId = await resolveActor(new Headers({ 'X-Keelson-User-Id': '0123456789abcdef' }));
		expect(byId?.name).toBe('01234567');
	});

	it('re-decodes a UTF-8 name that arrives as Latin-1', async () => {
		const original = `Sato ${String.fromCodePoint(0x4f50, 0x85e4)}`;
		const asLatin1 = Buffer.from(original, 'utf8').toString('latin1');
		const actor = await resolveActor(
			new Headers({ 'X-Keelson-User-Id': 'u3', 'X-Keelson-User-Name': asLatin1 }),
		);
		expect(actor?.name).toBe(original);
	});

	it("is the roster's admin in the SDK local mode (pnpm dev without the CLI)", async () => {
		process.env.KEELSON_LOCAL_MODE = '1';
		process.env.KEELSON_LOCAL_USERS_FILE = 'seed-data/dev-users.json';
		const actor = await resolveActor(new Headers());
		expect(actor).toMatchObject({ id: 'sample-yamaguchi', isAdmin: true });
	});
});
