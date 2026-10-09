import { chromium, type FullConfig, type Page } from '@playwright/test';

// Warm up the dev server before the workers start. playwright.config.ts
// `webServer` waits until the API answers, but the screens are compiled (and
// their dependencies bundled by Vite) only when a browser first asks for them.
// In CI every run starts from a clean checkout, so that work happens during
// the first tests, and a page loaded while Vite is still re-bundling can stay
// blank: the first test of each worker then timed out (once, in CI only).
// Here one browser opens every screen once, reloading a screen until it
// renders, so the tests start against a server that has done that work.

/** The screens to open: the menu's, and those reached from them. */
const SCREENS = ['/', '/items', '/members', '/history', '/masters', '/import', '/me'];

/** How long one load of a screen may take to render before it is reloaded. */
const RENDER_TIMEOUT_MS = 15_000;

/** How long the whole warm-up may take. */
const WARM_UP_TIMEOUT_MS = 120_000;

/** Open `path` until the app shell (its navigation) renders, or the deadline passes. */
async function open(page: Page, path: string, deadline: number): Promise<number> {
	let reloads = 0;
	for (;;) {
		try {
			await page.goto(path);
			await page
				.getByRole('navigation')
				.getByRole('link')
				.first()
				.waitFor({ timeout: RENDER_TIMEOUT_MS });
			return reloads;
		} catch (err) {
			if (Date.now() > deadline) {
				throw new Error(`e2e warm-up: ${path} did not render`, { cause: err });
			}
			reloads++;
		}
	}
}

export default async function globalSetup(config: FullConfig): Promise<void> {
	const { baseURL } = config.projects[0].use;
	const started = Date.now();
	const deadline = started + WARM_UP_TIMEOUT_MS;
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage({ baseURL });
		let reloads = 0;
		for (const path of SCREENS) {
			reloads += await open(page, path, deadline);
		}
		// One record of each kind, so the detail screens are compiled too.
		const items = (await (await page.request.get('/api/items')).json()) as {
			rows: { id: number }[];
		};
		const members = (await (await page.request.get('/api/members')).json()) as {
			rows: { id: string }[];
		};
		const details = [
			...items.rows.slice(0, 1).map((r) => `/items/${r.id}`),
			...members.rows.slice(0, 1).map((r) => `/members/${encodeURIComponent(r.id)}`),
		];
		for (const path of details) {
			reloads += await open(page, path, deadline);
		}
		const seconds = ((Date.now() - started) / 1000).toFixed(1);
		console.log(`[e2e warm-up] screens rendered in ${seconds}s (reloads: ${reloads})`);
	} finally {
		await browser.close();
	}
}
