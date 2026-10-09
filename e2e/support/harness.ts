import { readFileSync } from 'node:fs';
import { type APIResponse, test as base, expect, type Locator, type Page } from '@playwright/test';

// Pieces of the e2e specs with nothing particular to this app's records. The
// server is `pnpm dev` behind `keelson dev serve`, started by
// playwright.config.ts: a request is the roster's admin unless it names
// another roster user in the X-Keelson-Dev-As header. This app's test data is set up with
// app.ts, which also exports the `test` the specs use.
//
// No Japanese here or in any spec (the same specs must pass on a translated
// edition): select by data-testid, role or attribute, and check values, counts,
// URLs and the data-status / data-kind attributes instead of labels.

export { expect };

/** A user of the local roster (seed-data/dev-users.json). */
export interface SamplePerson {
	id: string;
	name: string;
	email: string;
}

/**
 * The general users (perms `view`) of the local roster, read from
 * seed-data/dev-users.json so that editing the roster does not break the
 * scenarios, and the former members, who appear in the sample records only.
 */
const PEOPLE = (
	JSON.parse(readFileSync(new URL('../../seed-data/dev-users.json', import.meta.url), 'utf8')) as {
		users: (SamplePerson & { perms: string[] })[];
	}
).users.filter((u) => !u.perms.includes('manage'));
const ASSIGNMENTS = JSON.parse(
	readFileSync(new URL('../../seed-data/assignments.json', import.meta.url), 'utf8'),
) as { former: SamplePerson[] };

/** The general user at `index` of the roster (admins skipped). */
export function samplePerson(index: number): SamplePerson {
	const person = PEOPLE[index];
	if (!person) {
		throw new Error(
			`seed-data/dev-users.json lists ${PEOPLE.length} general users; the e2e scenarios use ${index + 1}`,
		);
	}
	return person;
}

/** The general user of the member scenarios (perms `view`, no `manage`): the first one. */
export const MEMBER = samplePerson(0);

/** A sample former member: in the sample records only, not in the roster. */
export const FORMER: SamplePerson = ASSIGNMENTS.former[0];

/**
 * A run-unique tag (an asset tag, a name, or a prefix of them) for one
 * scenario: `E2E-<nn>-<random>`. Scenarios share one database, so nothing
 * they create may collide.
 */
export function uniqueTag(scenario: string): string {
	const random = Math.random().toString(36).slice(2, 8).toUpperCase();
	return `E2E-${scenario}-${random}`;
}

/**
 * A fixture file's text with each `{{NAME}}` replaced by `values.NAME` (values
 * that change per run or come from the samples). Fails on a placeholder
 * without a value, so a typo in a fixture does not go unnoticed.
 */
export function fillFixture(text: string, values: Record<string, string>): string {
	return text.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
		const value = values[name];
		if (value === undefined) {
			throw new Error(`no value for ${placeholder} in the fixture`);
		}
		return value;
	});
}

/** The JSON body of an API response, failing the test unless it is a 2xx. */
export async function okJson<T>(res: APIResponse): Promise<T> {
	expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBe(true);
	return (await res.json()) as T;
}

const BOM = [0xef, 0xbb, 0xbf];

/** Whether the bytes start with the UTF-8 byte order mark. */
export function hasBom(bytes: Uint8Array): boolean {
	return BOM.every((b, i) => bytes[i] === b);
}

/**
 * Lines of a CSV file the app wrote, split into cells. Enough for the files of
 * these specs (no quoted commas or line breaks in the cells they read).
 */
export function csvLines(bytes: Uint8Array): string[][] {
	const text = new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes);
	return text
		.split(/\r?\n/)
		.filter((line) => line !== '')
		.map((line) => line.split(','));
}

/**
 * The dialog that is open. Screens render a dialog only while it is open, so
 * closing removes it from the page and `toBeHidden()` sees that.
 */
export function openDialog(page: Page): Locator {
	return page.getByRole('dialog');
}

/** Pick an option of a combobox (a person or record picker) by typing `query`. */
export async function pick(combobox: Locator, query: string, optionText = query): Promise<void> {
	await combobox.click();
	await combobox.fill(query);
	await combobox
		.page()
		.getByRole('listbox')
		.getByRole('option')
		.filter({ hasText: optionText })
		.click();
}

export const test = base.extend<{ memberPage: Page }>({
	// A separate browser context signed in as a general user: keelson dev serve
	// signs each request in as the roster user named by X-Keelson-Dev-As.
	memberPage: async ({ browser, baseURL }, use) => {
		const context = await browser.newContext({
			baseURL,
			locale: 'ja-JP',
			timezoneId: 'Asia/Tokyo',
			extraHTTPHeaders: { 'X-Keelson-Dev-As': MEMBER.id },
		});
		await use(await context.newPage());
		await context.close();
	},
});
