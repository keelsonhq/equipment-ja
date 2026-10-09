import type { Page } from '@playwright/test';
import { test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// The type options of the register dialog, opened from the ledger.
async function registerTypeOptions(page: Page, name: string) {
	await page.goto('/items');
	await page.getByTestId('item-register').click();
	const dialog = openDialog(page);
	const option = dialog.locator('select[name="typeId"] option').filter({ hasText: name });
	return { dialog, option };
}

// 7. Add an item type in the masters screen -> it is offered by the register
// dialog -> rename it.
test('add an item type, use it in the register dialog, rename it', async ({ page }) => {
	const base = uniqueTag('07');
	const name = `${base}-TYPE`;
	const renamed = `${base}-KIND`;

	await page.goto('/masters');
	await page.getByTestId('master-add-name').fill(name);
	await page.getByTestId('master-add').click();
	await expect(page.getByTestId('master-row').filter({ hasText: name })).toHaveCount(1);

	let { dialog, option } = await registerTypeOptions(page, name);
	await expect(option).toHaveCount(1);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();

	await page.goto('/masters');
	await page
		.getByTestId('master-row')
		.filter({ hasText: name })
		.getByTestId('master-rename')
		.click();
	await page.getByTestId('master-edit-name').fill(renamed);
	await page.getByTestId('master-save').click();
	await expect(page.getByTestId('master-row').filter({ hasText: renamed })).toHaveCount(1);
	await expect(page.getByTestId('master-row').filter({ hasText: name })).toHaveCount(0);

	({ dialog, option } = await registerTypeOptions(page, renamed));
	await expect(option).toHaveCount(1);
	await expect(
		dialog.locator('select[name="typeId"] option').filter({ hasText: name }),
	).toHaveCount(0);
});
