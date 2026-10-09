import type { APIRequestContext } from '@playwright/test';
import type { AssignmentView } from '../../src/lib/server/domain/assignments.ts';
import type { ItemView } from '../../src/lib/server/domain/items.ts';
import type { MasterEntry } from '../../src/lib/server/domain/masters.ts';
import type { PersonPage } from '../../src/lib/server/domain/people.ts';
import type { Session } from '../../src/lib/server/auth/session.ts';
import {
	csvLines,
	expect,
	okJson,
	type SamplePerson,
	samplePerson,
	test as base,
} from './harness.ts';

// This app's test data, set up through the API as the local admin, and the
// `test` of the specs: harness.ts `test` (with `memberPage`) plus `api`.

/**
 * The roster user each scenario issues items to (an index into the general
 * users of seed-data/dev-users.json; 0 is harness.ts MEMBER).
 * Scenarios run in parallel and some count what their person holds, so no two
 * share one.
 */
const HOLDERS = { '03': 1, '04': 2, '05': 3, '08': 4, '09': 5, '11': 6 } as const;

/** The roster user scenario `scenario` issues items to (its own, see HOLDERS). */
export function holderFor(scenario: keyof typeof HOLDERS): SamplePerson {
	return samplePerson(HOLDERS[scenario]);
}

/** Test data set up through the API as the local admin. */
export class AdminApi {
	constructor(private readonly request: APIRequestContext) {}

	async session(): Promise<Session> {
		return okJson<Session>(await this.request.get('/api/me'));
	}

	async masters(): Promise<{ types: MasterEntry[]; places: MasterEntry[] }> {
		return okJson(await this.request.get('/api/masters'));
	}

	async firstPlaceId(): Promise<number> {
		const { places } = await this.masters();
		const place = places.find((p) => p.active);
		if (!place) {
			throw new Error('no active usage place');
		}
		return place.id;
	}

	async createItem(assetTag: string, fields: Record<string, unknown> = {}): Promise<ItemView> {
		const res = await this.request.post('/api/items', {
			data: { assetTag, name: `E2E item ${assetTag}`, ...fields },
		});
		return okJson<ItemView>(res);
	}

	async issue(itemId: number, userId: string): Promise<AssignmentView> {
		const { today } = await this.session();
		const res = await this.request.post('/api/assignments', {
			data: { itemId, userId, placeId: await this.firstPlaceId(), issuedOn: today },
		});
		return okJson<AssignmentView>(res);
	}

	async findItem(assetTag: string): Promise<ItemView> {
		const { rows } = await okJson<{ rows: ItemView[] }>(
			await this.request.get('/api/items', { params: { q: assetTag } }),
		);
		const item = rows.find((r) => r.assetTag === assetTag);
		if (!item) {
			throw new Error(`item ${assetTag} not found`);
		}
		return item;
	}

	async person(userId: string): Promise<PersonPage> {
		return okJson<PersonPage>(await this.request.get(`/api/members/${encodeURIComponent(userId)}`));
	}

	/** The import template's header cells (the column names of the CSV files). */
	async templateHeader(): Promise<string[]> {
		const res = await this.request.get('/api/import/template');
		expect(res.ok()).toBe(true);
		return csvLines(await res.body())[0];
	}
}

export const test = base.extend<{ api: AdminApi }>({
	api: async ({ request }, use) => {
		await use(new AdminApi(request));
	},
});
