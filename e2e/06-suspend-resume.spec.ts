import { test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 6. Suspend with a reason -> the ledger's status chip says suspended -> resume
// brings it back.
test('suspend an item with a reason, then resume it', async ({ page, api }) => {
	const tag = uniqueTag('06');
	const item = await api.createItem(tag);
	const ledgerRow = page.getByTestId('item-row').filter({ hasText: tag });

	await page.goto(`/items/${item.id}`);
	await page.getByTestId('item-menu').click();
	await page.getByTestId('item-suspend').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="reason"]').selectOption('broken');
	await dialog.locator('[name="note"]').fill('Screen cracked.');
	await dialog.getByTestId('suspend-submit').click();
	await expect(dialog).toBeHidden();
	await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'suspended');

	await page.goto(`/items?q=${tag}`);
	await expect(ledgerRow.getByTestId('status-chip')).toHaveAttribute('data-status', 'suspended');
	const saved = await api.findItem(tag);
	expect([saved.suspendedReason, saved.suspendedNote]).toEqual(['broken', 'Screen cracked.']);

	await ledgerRow.getByText(tag, { exact: true }).click();
	await page.getByTestId('item-menu').click();
	await page.getByTestId('item-resume').click();
	await expect(page.getByTestId('status-chip').first()).toHaveAttribute(
		'data-status',
		'unassigned',
	);

	await page.goto(`/items?q=${tag}`);
	await expect(ledgerRow.getByTestId('status-chip')).toHaveAttribute('data-status', 'unassigned');
});

// The "more" menu of the item page (ui/Menu.svelte): Escape and a click
// outside close it, and choosing an item closes it with the focus back on its
// button, where the focus returns when the dialog the item opened closes.
test('the item menu closes on Escape, a click outside and a choice', async ({ page, api }) => {
	const item = await api.createItem(uniqueTag('06'));
	await page.goto(`/items/${item.id}`);
	const trigger = page.getByTestId('item-menu');
	const suspend = page.getByTestId('item-suspend');

	await trigger.click();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await expect(suspend).toBeVisible();
	await page.getByTestId('item-title').click();
	await expect(suspend).toBeHidden();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');

	await trigger.focus();
	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await expect(suspend).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(suspend).toBeHidden();
	await expect(trigger).toBeFocused();

	await page.keyboard.press('Enter');
	await page.keyboard.press('Tab');
	await page.keyboard.press('Enter');
	const dialog = openDialog(page);
	await expect(dialog).toBeVisible();
	await expect(suspend).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
});
