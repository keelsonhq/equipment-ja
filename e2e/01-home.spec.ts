import { test } from './support/app.ts';
import { expect } from './support/harness.ts';

// 1. Home: the stock per type, the items that need action and the latest
// history are drawn, and the menu has the five admin entries + my page (in any
// order: DESIGN.md §11 lets an app reorder its menu).
test('home shows stock, attention and recent history with the admin menu', async ({
	page,
	api,
}) => {
	// Every active type has a stock row, with items or not. Read before the page
	// loads: other scenarios only add types meanwhile.
	const activeTypes = (await api.masters()).types.filter((t) => t.active).length;
	await page.goto('/');

	const links = page.getByRole('navigation').getByRole('link');
	await expect(links).toHaveCount(6);
	const hrefs = await links.evaluateAll((els) => els.map((el) => el.getAttribute('href')));
	expect(new Set(hrefs)).toEqual(
		new Set(['/', '/items', '/members', '/history', '/masters', '/me']),
	);

	// The sample ledger has overdue / pending / suspended items, and history.
	await expect(page.getByTestId('home-stock').getByTestId('stock-row').first()).toBeVisible();
	expect(await page.getByTestId('stock-row').count()).toBeGreaterThanOrEqual(activeTypes);
	await expect(
		page.getByTestId('home-attention').getByTestId('attention-row').first(),
	).toBeVisible();
	const attention = page.getByTestId('attention-row');
	expect(await attention.count()).toBeLessThanOrEqual(10);
	await expect(page.getByTestId('home-recent').getByTestId('event-row').first()).toBeVisible();
	expect(
		await page.getByTestId('home-recent').getByTestId('event-row').count(),
	).toBeLessThanOrEqual(10);
});
