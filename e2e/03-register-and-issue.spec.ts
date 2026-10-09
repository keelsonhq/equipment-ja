import { holderFor, test } from './support/app.ts';
import { expect, openDialog, pick, uniqueTag } from './support/harness.ts';

// 3. Register and issue in one step -> the item's history has a registration
// and an issue -> the holder's page lists it as held.
test('register and issue at once, then see it on the holder page', async ({ page, api }) => {
	const tag = uniqueTag('03');
	const person = holderFor('03');

	await page.goto('/');
	await page.getByTestId('item-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(tag);
	await dialog.locator('[name="name"]').fill(`E2E phone ${tag}`);
	await dialog.getByTestId('item-form-issue').check();
	await pick(dialog.getByTestId('member-combobox'), 'suzuki', person.email);
	await dialog.getByTestId('item-form-submit').click();
	await expect(dialog).toBeHidden();

	const item = await api.findItem(tag);
	await page.goto(`/items/${item.id}`);
	await expect(page.getByTestId('status-chip').first()).toHaveAttribute('data-status', 'assigned');
	await page.getByTestId('item-tab-history').click();
	const kinds = page.getByTestId('event-kind');
	await expect(kinds).toHaveCount(2);
	// Both are written in one transaction (same time), so their order is not fixed.
	const recorded = await kinds.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
	expect(recorded).toEqual(expect.arrayContaining(['create', 'issue']));

	await page.getByTestId('current-holder').click();
	await expect(page).toHaveURL(`/members/${person.id}`);
	const held = page.getByTestId('holding-row').filter({ hasText: tag });
	await expect(held).toHaveCount(1);
	await expect(held.getByTestId('status-chip')).toHaveAttribute('data-status', 'assigned');
});

// The employee picker (ui/Combobox.svelte) from the keyboard: the arrows move
// through the candidates, Escape closes the list but not the dialog, Enter
// chooses the highlighted one.
test('the employee picker works from the keyboard', async ({ page, api }) => {
	const tag = uniqueTag('03');
	await page.goto('/');
	await page.getByTestId('item-register').click();
	const dialog = openDialog(page);
	await dialog.locator('[name="assetTag"]').fill(tag);
	await dialog.locator('[name="name"]').fill(`E2E phone ${tag}`);
	await dialog.getByTestId('item-form-issue').check();

	// "yama" matches the two sample people no other scenario issues to.
	const combobox = dialog.getByTestId('member-combobox');
	const list = dialog.getByRole('listbox');
	const options = list.getByRole('option');
	await combobox.fill('yama');
	await expect(options).toHaveCount(2);
	await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowUp');
	await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowDown');
	const email = (await options.nth(1).textContent())?.match(/[\w.]+@example\.com/)?.[0];
	expect(email).toBeTruthy();

	await page.keyboard.press('Escape');
	await expect(list).toBeHidden();
	await expect(combobox).toHaveAttribute('aria-expanded', 'false');
	await expect(dialog).toBeVisible();

	await page.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('Enter');
	await expect(list).toBeHidden();
	await dialog.getByTestId('item-form-submit').click();
	await expect(dialog).toBeHidden();
	expect((await api.findItem(tag)).holder?.email).toBe(email);
});
