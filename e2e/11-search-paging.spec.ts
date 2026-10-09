import { holderFor, test } from './support/app.ts';
import { expect, FORMER, uniqueTag } from './support/harness.ts';

const HOLDER = holderFor('11');

const ITEMS = 53;
const PAGE_SIZE = 50;

// 11. The search term, the status filter, the page and the page size live in
// the URL and survive a reload; the density switch is remembered too.
test('search, filter and paging are kept in the URL; density switches', async ({ page, api }) => {
	// 53 items of this run: one issued, so the "unassigned" filter leaves 52
	// (two pages of 50).
	const prefix = uniqueTag('11');
	const tags = Array.from(
		{ length: ITEMS },
		(_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`,
	);
	for (let i = 0; i < tags.length; i += 10) {
		await Promise.all(tags.slice(i, i + 10).map((tag) => api.createItem(tag)));
	}
	const issued = await api.findItem(tags[ITEMS - 1]);
	await api.issue(issued.id, HOLDER.id);

	const rows = page.getByTestId('item-row');
	const query = () => new URL(page.url()).searchParams;

	await page.goto('/items');
	await page.getByTestId('search-input').fill(prefix);
	await expect(page).toHaveURL((url) => url.searchParams.get('q') === prefix);
	await expect(rows).toHaveCount(PAGE_SIZE);

	await page.getByTestId('status-filter').click();
	await page.getByTestId('status-filter-unassigned').check();
	await expect(page).toHaveURL((url) => url.searchParams.get('status') === 'unassigned');
	// A checklist menu stays open while its boxes are ticked.
	await expect(page.getByTestId('status-filter')).toHaveAttribute('aria-expanded', 'true');
	await page.getByTestId('page-next').click();
	await expect(page).toHaveURL((url) => url.searchParams.get('page') === '2');
	await expect(rows).toHaveCount(ITEMS - 1 - PAGE_SIZE);

	await page.reload();
	expect(Object.fromEntries(query())).toEqual({ q: prefix, status: 'unassigned', page: '2' });
	await expect(page.getByTestId('search-input')).toHaveValue(prefix);
	await expect(rows).toHaveCount(ITEMS - 1 - PAGE_SIZE);
	await page.getByTestId('status-filter').click();
	await expect(page.getByTestId('status-filter-unassigned')).toBeChecked();
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('status-filter-unassigned')).toBeHidden();

	// A new page size starts again from the first page.
	await page.getByTestId('page-size').selectOption('100');
	await expect(page).toHaveURL(
		(url) => url.searchParams.get('size') === '100' && !url.searchParams.has('page'),
	);
	await expect(rows).toHaveCount(ITEMS - 1);
	await page.reload();
	expect(Object.fromEntries(query())).toEqual({ q: prefix, status: 'unassigned', size: '100' });
	await expect(page.getByTestId('page-size')).toHaveValue('100');
	await expect(rows).toHaveCount(ITEMS - 1);

	const density = page.getByTestId('density-toggle');
	await expect(density).toHaveAttribute('aria-pressed', 'false');
	await density.click();
	await expect(density).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('main')).toHaveClass(/density-dense/);
	await page.reload();
	await expect(density).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('main')).toHaveClass(/density-dense/);
});

// The sort column and direction live in the URL too and survive a reload.
test('the sort order is kept in the URL', async ({ page, api }) => {
	// Name order differs from asset-tag order, so each step shows.
	const prefix = uniqueTag('11');
	const a = `${prefix}-A`;
	const b = `${prefix}-B`;
	const c = `${prefix}-C`;
	await api.createItem(a, { name: 'E2E zeta' });
	await api.createItem(b, { name: 'E2E alpha' });
	await api.createItem(c, { name: 'E2E mu' });

	const rows = page.getByTestId('item-row');
	const inOrder = (tags: string[]) => tags.map((tag) => new RegExp(tag));
	const byName = page.getByTestId('sort-name');
	const query = () => new URL(page.url()).searchParams;

	await page.goto(`/items?q=${prefix}`);
	await expect(rows).toHaveText(inOrder([a, b, c]));
	await byName.getByRole('button').click();
	await expect(page).toHaveURL(
		(url) => url.searchParams.get('sort') === 'name' && url.searchParams.get('dir') === 'asc',
	);
	await expect(byName).toHaveAttribute('aria-sort', 'ascending');
	await expect(rows).toHaveText(inOrder([b, c, a]));
	await byName.getByRole('button').click();
	await expect(page).toHaveURL((url) => url.searchParams.get('dir') === 'desc');
	await expect(rows).toHaveText(inOrder([a, c, b]));

	await page.reload();
	expect(Object.fromEntries(query())).toEqual({ q: prefix, sort: 'name', dir: 'desc' });
	await expect(byName).toHaveAttribute('aria-sort', 'descending');
	await expect(rows).toHaveText(inOrder([a, c, b]));
});

// A history URL opened directly applies its filters (operation kind, from date).
test('a history URL opened directly applies its filters', async ({ page, api }) => {
	const tag = uniqueTag('11');
	const item = await api.createItem(tag);
	await api.issue(item.id, HOLDER.id);
	const { today } = await api.session();

	await page.goto(`/history?kind=issue&from=${today}`);
	await expect(page.getByTestId('history-kind')).toHaveValue('issue');
	await expect(page.getByTestId('history-from')).toHaveValue(today);
	const rows = page.getByTestId('event-row');
	// The issue of this item is listed; its create event is not.
	await expect(rows.filter({ hasText: tag })).toHaveCount(1);
	const kinds = await rows
		.getByTestId('event-kind')
		.evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
	expect(new Set(kinds)).toEqual(new Set(['issue']));
	// The first cell is the local date and time (YYYY-MM-DD HH:mm).
	const days = await rows.evaluateAll((els) =>
		els.map((el) => el.querySelector('td')?.textContent?.trim().slice(0, 10) ?? ''),
	);
	expect(days.filter((day) => day < today)).toEqual([]);
});

// The members list opened with holding=1 lists only people who hold something.
test('a members URL opened directly applies the holding filter', async ({ page, api }) => {
	const item = await api.createItem(uniqueTag('11'));
	await api.issue(item.id, HOLDER.id);

	await page.goto('/members?holding=1');
	const holdingOnly = page.getByTestId('holding-only');
	await expect(holdingOnly).toBeChecked();
	const rows = page.getByTestId('member-row');
	await expect(rows.filter({ hasText: HOLDER.email })).toHaveCount(1);
	await expect(rows.filter({ hasText: FORMER.email })).toHaveCount(0);
	const held = await rows.evaluateAll((els) =>
		els.map((el) => {
			const count = (id: string) =>
				Number(el.querySelector(`[data-testid="${id}"]`)?.textContent) || 0;
			return count('member-assigned') + count('member-pending');
		}),
	);
	expect(held.filter((n) => n === 0)).toEqual([]);

	// Without the filter, someone who holds nothing is listed again.
	await holdingOnly.uncheck();
	await expect(page).toHaveURL((url) => !url.searchParams.has('holding'));
	await expect(rows.filter({ hasText: FORMER.email })).toHaveCount(1);
});
