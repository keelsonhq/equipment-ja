import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite-plus';

// Tests exercise the server-side business layer and the API handlers directly
// (no browser, no network, no API keys). They do not need the SvelteKit Vite
// plugin: `#lib/*` resolves through package.json subpath imports. The Svelte
// plugin compiles components, so a test can render one on the server
// (`render` from svelte/server) and check its markup.
export default defineConfig({
	plugins: [svelte({ configFile: false })],
	test: {
		// Each test file builds its own temporary database; run files in
		// isolation so process-wide singletons (DB client, caches) never leak.
		isolate: true,
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					environment: 'node',
					include: ['tests/**/*.test.ts'],
					exclude: ['tests/**/*.svelte.test.ts'],
				},
			},
			{
				// Screen state written with runes (src/lib/state/*.svelte.ts): the
				// browser build of Svelte, where $effect runs.
				extends: true,
				resolve: { conditions: ['browser'] },
				test: {
					name: 'runes',
					environment: './tests/support/runes-environment.ts',
					include: ['tests/**/*.svelte.test.ts'],
				},
			},
		],
	},
});
