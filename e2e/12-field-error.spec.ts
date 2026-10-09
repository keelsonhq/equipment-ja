import { test } from './support/app.ts';
import { expect, openDialog, uniqueTag } from './support/harness.ts';

// 12. Registering an asset tag that is already taken shows the error under the
// field, not at the top of the dialog (DESIGN.md §8.6).
test('a taken asset tag is reported under its field', async ({ page, api }) => {
	const tag = uniqueTag('12');
	await api.createItem(tag);

	await page.goto('/items');
	await page.getByTestId('item-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(tag);
	await dialog.locator('[name="name"]').fill(`E2E duplicate of ${tag}`);
	const [response] = await Promise.all([
		page.waitForResponse(
			(res) => res.url().endsWith('/api/items') && res.request().method() === 'POST',
		),
		dialog.getByTestId('item-form-submit').click(),
	]);
	expect(response.status()).toBe(422);
	expect(await response.json()).toEqual({
		error: 'validation_failed',
		fields: { assetTag: 'taken' },
	});

	await expect(dialog.getByTestId('field-error-assetTag')).toBeVisible();
	await expect(dialog.locator('[name="assetTag"]')).toHaveAttribute('aria-invalid', 'true');
	await expect(dialog.locator('[name="assetTag"]')).toBeFocused();
	await expect(dialog.getByTestId('dialog-error')).toHaveCount(0);
	await expect(dialog).toBeVisible();
});
