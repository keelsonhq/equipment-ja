import { holderFor, test } from './support/app.ts';
import { expect, openDialog, pick, uniqueTag } from './support/harness.ts';

// 5. "Exchange" on a person's page with the old item as the source -> the old
// item waits for its return, the new one is held -> record the old one's return.
test('exchange an item on the person page, then return the old one', async ({ page, api }) => {
	const person = holderFor('05');
	const tag = uniqueTag('05');
	const oldTag = `${tag}-OLD`;
	const newTag = `${tag}-NEW`;
	const oldItem = await api.createItem(oldTag);
	const oldAssignment = await api.issue(oldItem.id, person.id);
	await api.createItem(newTag);

	const before = (await api.person(person.id)).holdings;
	const held = before.filter((h) => !h.pendingReturn).length;
	const pending = before.filter((h) => h.pendingReturn).length;

	await page.goto(`/members/${person.id}`);
	await expect(page.getByTestId('count-assigned')).toHaveText(String(held));
	await page.getByTestId('member-exchange').click();
	const dialog = openDialog(page);
	await pick(dialog.getByTestId('item-picker'), newTag);
	await dialog.locator('[name="exchangeFrom"]').selectOption(oldAssignment.id);
	await dialog.getByTestId('issue-submit').click();
	await expect(dialog).toBeHidden();

	const rows = page.getByTestId('holding-row');
	await expect(rows.filter({ hasText: oldTag }).getByTestId('status-chip')).toHaveAttribute(
		'data-status',
		'pending_return',
	);
	await expect(rows.filter({ hasText: newTag }).getByTestId('status-chip')).toHaveAttribute(
		'data-status',
		'assigned',
	);
	// The new item is held and the old one moved to "pending return".
	await expect(page.getByTestId('count-assigned')).toHaveText(String(held));
	await expect(page.getByTestId('count-pending')).toHaveText(String(pending + 1));

	await rows.filter({ hasText: oldTag }).getByTestId('holding-return').click();
	await openDialog(page).getByTestId('return-submit').click();
	await expect(openDialog(page)).toBeHidden();
	await expect(rows.filter({ hasText: oldTag })).toHaveCount(0);
	await expect(page.getByTestId('count-pending')).toHaveText(String(pending));
	await expect(rows.filter({ hasText: newTag })).toHaveCount(1);
});
