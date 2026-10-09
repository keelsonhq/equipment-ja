import { holderFor, test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 4. "Return" on a ledger row -> record the return -> the item's assignment
// ledger shows the seal (collected: an admin recorded someone else's return)
// and the return date.
test('record a return from the ledger row', async ({ page, api }) => {
	const tag = uniqueTag('04');
	const item = await api.createItem(tag);
	await api.issue(item.id, holderFor('04').id);

	await page.goto(`/items?q=${tag}`);
	// The dialog's default return date is the server's "today" read at page load.
	const { today } = await api.session();
	const row = page.getByTestId('item-row').filter({ hasText: tag });
	await expect(row.getByTestId('status-chip')).toHaveAttribute('data-status', 'assigned');
	await row.getByTestId('row-return').click();
	const dialog = openDialog(page);
	await dialog.getByTestId('return-submit').click();
	await expect(dialog).toBeHidden();
	await expect(row.getByTestId('status-chip')).toHaveAttribute('data-status', 'unassigned');

	await row.getByText(tag, { exact: true }).click();
	await expect(page).toHaveURL(`/items/${item.id}`);
	const ledger = page.getByTestId('ledger-row');
	await expect(ledger).toHaveCount(1);
	await expect(ledger.getByTestId('seal')).toHaveAttribute('data-kind', 'collected');
	await expect(ledger.getByTestId('ledger-returned-on')).toHaveText(today);
});
