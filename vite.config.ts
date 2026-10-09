import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';

// SvelteKit 3 reads its configuration from the Vite plugin (svelte.config.js is
// no longer supported). adapter-node emits a standalone Node server to build/,
// started with `node build/index.js` (`pnpm start`, and keelson.yaml `command`).
export default defineConfig({
	fmt: {
		useTabs: true,
		singleQuote: true,
		printWidth: 100,
		svelte: true,
		ignorePatterns: [
			'build/**',
			'.svelte-kit/**',
			'.keelson/**',
			'migrations/**',
			'pnpm-lock.yaml',
			'package-lock.json',
		],
	},
	lint: {
		jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
		rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
		options: { typeAware: true, typeCheck: true },
	},
	plugins: lazyPlugins(() => [tailwindcss(), sveltekit({ adapter: adapter() })]),
});
