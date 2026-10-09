import type { Environment } from 'vite-plus/test/runtime';

// The environment of `*.svelte.test.ts` (vitest.config.ts): Node, with the
// modules built as for the browser, so runes ($state, $effect) behave as they
// do in the app. There is no DOM: these tests drive state, not components.
export default {
	name: 'runes',
	viteEnvironment: 'client',
	setup() {
		return { teardown() {} };
	},
} satisfies Environment;
