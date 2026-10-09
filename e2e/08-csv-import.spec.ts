import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { holderFor, test } from './support/app.ts';
import { csvLines, expect, fillFixture, hasBom, uniqueTag } from './support/harness.ts';

// The CSV to import (Japanese headers and values, so it lives in e2e/fixtures/).
// Its placeholders are filled per run: `{{PREFIX}}` is a run-unique prefix of
// the asset tags and of a type the file names before it exists (so the import
// adds it, every run anew), `{{TYPE}}` / `{{PLACE}}` an existing type and usage
// place, and `{{HOLDER_EMAIL}}` the sample person this scenario issues to.
const FIXTURE = join(import.meta.dirname, 'fixtures', 'import.csv');

// 8. Download the template (BOM + header) -> import the fixture: the preview
// judges each row, the import registers them, adds the new type, and the row
// whose holder email matches a person is issued.
test('download the template, preview and import a CSV', async ({ page, api }) => {
	const prefix = uniqueTag('08');
	const holder = holderFor('08');
	const { types, places } = await api.masters();
	const active = (entries: { name: string; active: boolean }[]) =>
		entries.find((e) => e.active)?.name ?? '';
	const csv = fillFixture(readFileSync(FIXTURE, 'utf8'), {
		PREFIX: prefix,
		TYPE: active(types),
		PLACE: active(places),
		HOLDER_EMAIL: holder.email,
	});

	await page.goto('/import');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('import-template').click(),
	]);
	const template = readFileSync(await download.path());
	expect(hasBom(template)).toBe(true);
	const [header, ...examples] = csvLines(template);
	// Required columns (asset tag, name) are marked with a trailing `*`, which
	// the import ignores; the fixture has the same columns without the marks.
	expect(header.filter((h) => h.endsWith('*'))).toHaveLength(2);
	expect(examples).toHaveLength(2);
	expect(csvLines(Buffer.from(csv))[0]).toEqual(header.map((h) => h.replace(/\*$/, '')));

	await page.getByTestId('import-file').setInputFiles({
		name: 'e2e-import.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(csv),
	});
	await expect(page.getByTestId('import-count-all')).toHaveText('3');
	await expect(page.getByTestId('import-count-ok')).toHaveText('2');
	await expect(page.getByTestId('import-count-warn')).toHaveText('1');
	await expect(page.getByTestId('import-count-error')).toHaveText('0');
	await expect(page.getByTestId('import-row')).toHaveCount(3);
	// Row 03: its holder email matches nobody and its type is new.
	await expect(page.getByTestId('import-row').filter({ hasText: `${prefix}-03` })).toHaveAttribute(
		'data-judgment',
		'warn',
	);

	await page.getByTestId('import-run').click();
	await expect(page.getByTestId('import-result')).toBeVisible();
	await expect(page.getByTestId('import-created')).toHaveText('3');
	await expect(page.getByTestId('import-assigned')).toHaveText('1');
	await expect(page.getByTestId('import-excluded')).toHaveText('0');
	// The type the file named is registered now (an active entry of the list).
	const added = (await api.masters()).types.filter((t) => t.name.startsWith(prefix));
	expect(added.map((t) => t.active)).toEqual([true]);

	await page.goto(`/items?q=${prefix}`);
	const rows = page.getByTestId('item-row');
	await expect(rows).toHaveCount(3);
	const status = (n: string) =>
		rows.filter({ hasText: `${prefix}-${n}` }).getByTestId('status-chip');
	await expect(status('01')).toHaveAttribute('data-status', 'unassigned');
	await expect(status('02')).toHaveAttribute('data-status', 'assigned');
	await expect(status('03')).toHaveAttribute('data-status', 'unassigned');
	// Issued to the person whose email the file named.
	await rows
		.filter({ hasText: `${prefix}-02` })
		.getByText(`${prefix}-02`, { exact: true })
		.click();
	await expect(page.getByTestId('current-holder')).toHaveAttribute('href', `/members/${holder.id}`);
});
