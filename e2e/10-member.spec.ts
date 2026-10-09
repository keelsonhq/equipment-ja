import { test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 10. A general user (perms `view`): no admin menu -> take an available item
// on my page -> return it -> the admin API answers 403.
test('a general user takes an item, returns it, and cannot use admin APIs', async ({
	memberPage: page,
	api,
}) => {
	const tag = uniqueTag('10');
	await api.createItem(tag);

	await page.goto('/');
	await expect(page).toHaveURL('/me');
	const links = page.getByRole('navigation').getByRole('link');
	await expect(links).toHaveCount(1);
	await expect(links).toHaveAttribute('href', '/me');

	await page.getByTestId('search-input').fill(tag);
	const available = page.getByTestId('available-row').filter({ hasText: tag });
	await available.getByTestId('claim-item').click();
	const dialog = openDialog(page);
	await dialog.getByTestId('issue-submit').click();
	await expect(dialog).toBeHidden();
	const held = page.getByTestId('holding-row').filter({ hasText: tag });
	await expect(held.getByTestId('status-chip')).toHaveAttribute('data-status', 'assigned');
	await expect(available).toHaveCount(0);

	await held.getByTestId('holding-return').click();
	await openDialog(page).getByTestId('return-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(held).toHaveCount(0);
	// After a return my page shows my ledger: returned by me, so "returned".
	const ledger = page.getByTestId('ledger-row').filter({ hasText: tag });
	await expect(ledger.getByTestId('seal')).toHaveAttribute('data-kind', 'returned');

	// The same browser (same identity headers) is refused by the admin APIs.
	const refused = await page.evaluate(async () => {
		const answers = [];
		for (const path of ['/api/home', '/api/items', '/api/import/template']) {
			const res = await fetch(path);
			answers.push({ status: res.status, body: await res.json() });
		}
		return answers;
	});
	expect(refused).toEqual(
		Array.from({ length: 3 }, () => ({
			status: 403,
			body: { error: 'forbidden_manage_required' },
		})),
	);
});
