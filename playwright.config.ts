import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests of the main happy paths (`pnpm e2e`, not part of `pnpm check`).
// They drive `pnpm dev` (scripts/dev.mjs) behind `keelson dev serve` (the
// roster's admin by default; X-Keelson-Dev-As names another roster user) on a
// port of its own, against a fresh temporary database per run. They need the
// Keelson CLI (v0.6.11 or later): without it the run stops here. The
// tests start once the API answers (`webServer.url`) and e2e/global-setup.ts has
// opened every screen once (the dev server compiles them on first use).
// AGENTS.md has the layout and the rules (no Japanese in e2e sources).

if (spawnSync('keelson', ['dev', 'serve', '--check'], { stdio: 'ignore' }).status !== 0) {
	throw new Error(
		'pnpm e2e needs the Keelson CLI v0.6.11 or later (keelson dev serve): ' +
			'curl -fsSL https://keelson.dev/install.sh | sh',
	);
}

const PORT = Number(process.env.E2E_PORT ?? 5190);
const BASE_URL = `http://localhost:${PORT}`;

// One temporary directory per run for the database and the file store. Every
// worker loads this file too: the first load records the directory in the
// environment, which the workers inherit, so it is created once per run.
process.env.E2E_RUN_DIR ??= mkdtempSync(join(tmpdir(), 'template-e2e-'));
const RUN_DIR = process.env.E2E_RUN_DIR;

export default defineConfig({
	testDir: 'e2e',
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 4,
	timeout: 30_000,
	expect: { timeout: 10_000 },
	reporter: process.env.CI ? 'list' : [['list'], ['html', { open: 'never' }]],
	globalSetup: './e2e/global-setup.ts',
	globalTeardown: './e2e/global-teardown.ts',
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		locale: 'ja-JP',
		timezoneId: 'Asia/Tokyo',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `${JSON.stringify(process.execPath)} scripts/dev.mjs --port ${PORT}`,
		// Ready once the API answers: the server has migrated the database and
		// loaded the samples (the first request does). The page shell alone ("/")
		// answers before any of that.
		url: `${BASE_URL}/api/me`,
		// Never attach to a server started elsewhere: it would have another database.
		reuseExistingServer: false,
		timeout: 60_000,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
		env: {
			LOCAL_DB_URL: `file:${join(RUN_DIR, 'e2e.db')}`,
			LOCAL_SAMPLE_DATA: '1',
			KEELSON_FILES_DIR: join(RUN_DIR, 'files'),
			// Blank out anything a developer's .env or shell may point at (a remote
			// database, a deploy URL that disables local development, the SDK's
			// local mode).
			KEELSON_DB_URL: '',
			KEELSON_DB_AUTH_TOKEN: '',
			TURSO_DATABASE_URL: '',
			TURSO_AUTH_TOKEN: '',
			KEELSON_APP_URL: '',
			KEELSON_LOCAL_MODE: '',
			// The app's day boundary is the browser's (timezoneId above).
			APP_TIME_ZONE: 'Asia/Tokyo',
		},
	},
});
