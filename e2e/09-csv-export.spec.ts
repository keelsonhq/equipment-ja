import { readFileSync } from 'node:fs';
import { holderFor, test } from './support/app.ts';
import { csvLines, expect, hasBom, uniqueTag } from './support/harness.ts';

// The export's columns: the importable ones (the template's, without the
// required marks), then four export-only columns.
const EXPORT_ONLY_COLUMNS = 4;

// 9. Export the filtered ledger: BOM, column names and one line per item.
test('export the filtered ledger as CSV', async ({ page, api }) => {
	const prefix = uniqueTag('09');
	const tags = ['01', '02', '03'].map((n) => `${prefix}-${n}`);
	const holder = holderFor('09');
	const items = await Promise.all(tags.map((tag) => api.createItem(tag)));
	await api.issue(items[1].id, holder.id);
	const importable = (await api.templateHeader()).map((h) => h.replace(/\*$/, ''));

	await page.goto('/items');
	await page.getByTestId('search-input').fill(prefix);
	await expect(page.getByTestId('item-row')).toHaveCount(3);
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('items-export').click(),
	]);
	// The export carries the ledger's current filter.
	expect(new URL(download.url()).searchParams.get('q')).toBe(prefix);

	const file = readFileSync(await download.path());
	expect(hasBom(file)).toBe(true);
	expect(file.toString('utf8')).toContain('\r\n');
	const [header, ...lines] = csvLines(file);
	expect(header.slice(0, importable.length)).toEqual(importable);
	expect(header).toHaveLength(importable.length + EXPORT_ONLY_COLUMNS);
	expect(lines.map((cells) => cells[0])).toEqual(tags);
	// Only the issued item carries a holder (its email is an importable column).
	expect(lines.map((cells) => cells.includes(holder.email))).toEqual([false, true, false]);
});
