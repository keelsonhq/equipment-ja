import { test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 2. Register one item -> the ledger search finds exactly it -> its detail page
// shows what was entered.
test('register an item, find it in the ledger and open its detail', async ({ page, api }) => {
	const tag = uniqueTag('02');
	const name = `E2E laptop ${tag}`;
	const type = (await api.masters()).types.find((t) => t.active);
	if (!type) {
		throw new Error('no active item type');
	}

	await page.goto('/');
	await page.getByTestId('item-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(tag);
	await dialog.locator('[name="typeId"]').selectOption(String(type.id));
	await dialog.locator('[name="name"]').fill(name);
	await dialog.locator('[name="serialNo"]').fill(`SN-${tag}`);
	await dialog.locator('[name="purchasedOn"]').fill('2025-04-01');
	await dialog.locator('[name="storageLocation"]').fill('HQ 3F store room');
	await dialog.locator('[name="note"]').fill('Registered by the e2e run.');
	await dialog.getByTestId('item-form-submit').click();
	await expect(dialog).toBeHidden();

	await page.getByRole('navigation').locator('a[href="/items"]').click();
	await page.getByTestId('search-input').fill(tag);
	await expect(page).toHaveURL((url) => url.searchParams.get('q') === tag);
	const rows = page.getByTestId('item-row');
	await expect(rows).toHaveCount(1);
	await expect(rows.getByTestId('status-chip')).toHaveAttribute('data-status', 'unassigned');

	await rows.getByText(tag, { exact: true }).click();
	await expect(page).toHaveURL(/\/items\/\d+$/);
	await expect(page.getByTestId('item-title')).toHaveText(name);
	await expect(page.getByTestId('item-attr-type')).toHaveText(type.name);
	await expect(page.getByTestId('item-attr-serial')).toHaveText(`SN-${tag}`);
	await expect(page.getByTestId('item-attr-purchased')).toHaveText('2025-04-01');
	await expect(page.getByTestId('item-attr-storage')).toHaveText('HQ 3F store room');
	await expect(page.getByTestId('item-attr-note')).toHaveText('Registered by the e2e run.');
});

// Cancelling the register form discards what was typed: it opens empty again.
test('cancel discards the register form', async ({ page, api }) => {
	const tag = uniqueTag('02');
	await page.goto('/');
	await page.getByTestId('item-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(tag);
	await dialog.locator('[name="name"]').fill(`E2E laptop ${tag}`);
	await dialog.locator('[name="storageLocation"]').fill('HQ 3F store room');
	await dialog.locator('[name="note"]').fill('Never saved.');
	await dialog.getByTestId('item-form-cancel').click();
	await expect(dialog).toBeHidden();

	await page.getByTestId('item-register').click();
	await expect(dialog).toBeVisible();
	for (const field of ['assetTag', 'name', 'typeId', 'serialNo', 'storageLocation', 'note']) {
		await expect(dialog.locator(`[name="${field}"]`)).toHaveValue('');
	}
	await expect(api.findItem(tag)).rejects.toThrow();
});

// "Save and continue" registers the item and keeps the dialog open for the
// next one: the type and the storage place stay, everything else is cleared.
test('save and continue keeps the type and the storage place', async ({ page, api }) => {
	const first = uniqueTag('02');
	const second = uniqueTag('02');
	const type = (await api.masters()).types.find((t) => t.active);
	if (!type) {
		throw new Error('no active item type');
	}
	const storage = 'HQ 3F store room';

	await page.goto('/');
	await page.getByTestId('item-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(first);
	await dialog.locator('[name="typeId"]').selectOption(String(type.id));
	await dialog.locator('[name="name"]').fill(`E2E laptop ${first}`);
	await dialog.locator('[name="serialNo"]').fill(`SN-${first}`);
	await dialog.locator('[name="purchasedOn"]').fill('2025-04-01');
	await dialog.locator('[name="storageLocation"]').fill(storage);
	await dialog.locator('[name="note"]').fill('First of two.');
	await dialog.getByTestId('item-form-continue').click();

	await expect(dialog.locator('[name="assetTag"]')).toHaveValue('');
	await expect(dialog).toBeVisible();
	for (const field of ['name', 'serialNo', 'purchasedOn', 'note']) {
		await expect(dialog.locator(`[name="${field}"]`)).toHaveValue('');
	}
	await expect(dialog.locator('[name="typeId"]')).toHaveValue(String(type.id));
	await expect(dialog.locator('[name="storageLocation"]')).toHaveValue(storage);
	expect(await api.findItem(first)).toMatchObject({
		typeId: type.id,
		serialNo: `SN-${first}`,
		storageLocation: storage,
	});

	await dialog.locator('[name="assetTag"]').fill(second);
	await dialog.locator('[name="name"]').fill(`E2E laptop ${second}`);
	await dialog.getByTestId('item-form-submit').click();
	await expect(dialog).toBeHidden();
	expect(await api.findItem(second)).toMatchObject({
		typeId: type.id,
		serialNo: null,
		storageLocation: storage,
		note: null,
	});
});
