import { listMembers as directoryListMembers, type MemberItem } from '@keelsonhq/identity';
import { type Actor, displayNameOf } from '#lib/server/auth/actor.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { directoryConfigured } from '#lib/server/env.ts';
import { AppError, ErrorCode } from '#lib/server/errors.ts';

// Who the people are. The app keeps NO employee table of its own: the people
// you can issue items to are the workspace members returned by the platform
// Directory API. Assignment rows keep a name / email snapshot, so the history
// of someone who has left the workspace still reads correctly (shown as a
// former member). Profile images are NOT part of that snapshot: the
// directory's `image_url` is looked up from the cached member index every time
// a person is displayed, never written to the database (people who left have
// none).
//
// Locally (`pnpm dev`) the directory is `keelson dev serve`'s mock, or the
// identity SDK's local mode, both serving the local roster
// (seed-data/dev-users.json). The app itself never has sample people.
//
// This module is the people list and its lookups (other modules ask it about
// a person); what the screens show about people is in people.ts.

/**
 * Where the people list came from: the directory (`ok`), or nowhere because
 * the directory is not set up / failed.
 */
export type PeopleState = 'ok' | 'unconfigured' | 'unavailable';

/** A person by id, with the name and email the records keep (their snapshot). */
export interface PersonSummary {
	id: string;
	name: string;
	email: string | null;
}

/** A person who can be chosen in the employee picker. */
export interface Person extends PersonSummary {
	/** Profile image from the directory, or null (none set). */
	imageUrl: string | null;
}

/** Whether a person is (still) a workspace member. */
export type Membership = 'member' | 'former' | 'unknown';

// --- Directory access -------------------------------------------------------

type DirectoryFetcher = () => Promise<Person[]>;

// Directory results are cached briefly: the picker and the members screen would
// otherwise call the platform on every keystroke / page change.
const OK_TTL_MS = 60_000;
const FAILURE_TTL_MS = 15_000;
const MAX_PAGES = 50; // 50 x 100 = 5,000 members

interface Snapshot {
	state: PeopleState;
	people: Person[];
}

let cache: ({ at: number } & Snapshot) | null = null;
// The read in progress. Every caller that finds the cache cold awaits the same
// one, so a cache expiry under concurrent requests (every page load reads the
// index through /api/me) costs one directory read, not one per request.
let inFlight: Promise<Snapshot> | null = null;
let fetcherOverride: DirectoryFetcher | null = null;
let configuredOverride: boolean | null = null;

/** Test seam: replace the Directory call (and whether it counts as configured). */
export function setDirectoryForTest(
	fetcher: DirectoryFetcher | null,
	configured: boolean | null = fetcher ? true : null,
): void {
	fetcherOverride = fetcher;
	configuredOverride = configured;
	cache = null;
	inFlight = null;
}

/** A directory member as a person of this app (image URL kept as given). */
export function memberToPerson(m: MemberItem): Person {
	return {
		id: m.id,
		name: displayNameOf(m.name || undefined, m.email || undefined, m.id),
		email: m.email || null,
		imageUrl: m.image_url ?? null,
	};
}

async function fetchAllMembers(): Promise<Person[]> {
	const people: Person[] = [];
	let offset = 0;
	for (let page = 0; page < MAX_PAGES; page++) {
		// App-as-actor: the SDK reads KEELSON_DIRECTORY_TOKEN and
		// KEELSON_DIRECTORY_BASE_URL injected by the platform.
		const res = await directoryListMembers({ limit: 100, offset });
		for (const m of res.items) {
			people.push(memberToPerson(m));
		}
		if (res.next_offset === null) {
			break;
		}
		offset = res.next_offset;
	}
	return people;
}

/** One directory read; a failure becomes `unavailable` (never throws). */
async function refresh(): Promise<Snapshot> {
	const at = Date.now();
	let next: Snapshot;
	try {
		next = { state: 'ok', people: await (fetcherOverride ?? fetchAllMembers)() };
	} catch (err) {
		console.error('[directory] member list failed', err);
		next = { state: 'unavailable', people: [] };
	}
	cache = { at, ...next };
	return next;
}

/**
 * Workspace members from the Directory API, with a short-lived cache. While a
 * read is in progress, concurrent callers share it (and its result, including
 * a failure, which is then cached for FAILURE_TTL_MS).
 */
export async function directorySnapshot(): Promise<Snapshot> {
	const configured = configuredOverride ?? directoryConfigured();
	if (!configured) {
		return { state: 'unconfigured', people: [] };
	}
	if (cache) {
		const ttl = cache.state === 'ok' ? OK_TTL_MS : FAILURE_TTL_MS;
		if (Date.now() - cache.at < ttl) {
			return { state: cache.state, people: cache.people };
		}
	}
	if (!inFlight) {
		const flight: Promise<Snapshot> = refresh().finally(() => {
			if (inFlight === flight) {
				inFlight = null;
			}
		});
		inFlight = flight;
	}
	return inFlight;
}

// --- People index ------------------------------------------------------------

/** The people list of one request, indexed by id (membership, image lookups). */
export interface PeopleIndex {
	state: PeopleState;
	people: Person[];
	byId: Map<string, Person>;
}

function indexOf(state: PeopleState, people: Person[]): PeopleIndex {
	return { state, people, byId: new Map(people.map((p) => [p.id, p])) };
}

/**
 * The people an admin may choose from: the directory members. Served from the
 * directory cache, so a request may call this once without another fetch.
 */
export async function peopleIndex(): Promise<PeopleIndex> {
	const directory = await directorySnapshot();
	return indexOf(directory.state, directory.people);
}

/**
 * Profile image of a current member, or null: former / unknown people and an
 * unconfigured directory have none. Resolved at display time
 * from the index, never stored with the records.
 */
export function imageUrlOf(index: PeopleIndex, id: string): string | null {
	return index.byId.get(id)?.imageUrl ?? null;
}

/** Whether `id` is a current member, someone who left, or cannot be told. */
export function membershipOf(index: PeopleIndex, id: string): Membership {
	if (index.byId.has(id)) {
		return 'member';
	}
	// "Not in the list" means someone who left only when the directory answered.
	return index.state === 'ok' ? 'former' : 'unknown';
}

/** People in name order (the picker, the members screen, the AI assistant's candidates). */
export function byName(a: { name: string }, b: { name: string }): number {
	return a.name.localeCompare(b.name, 'ja');
}

/**
 * Everyone `actor` may issue to, in name order and without paging (admin).
 * The employee picker searches this; the AI assistant looks a person up in it.
 */
export async function issuablePeople(
	actor: Actor,
): Promise<{ state: PeopleState; people: Person[] }> {
	requireAdmin(actor);
	const index = await peopleIndex();
	return { state: index.state, people: [...index.people].sort(byName) };
}

/**
 * The people `actor` may issue to, by lower-cased email (CSV import: the file
 * names the holder by email). People without an email cannot be matched.
 */
export async function peopleByEmail(
	actor: Actor,
): Promise<{ state: PeopleState; byEmail: Map<string, Person> }> {
	requireAdmin(actor);
	const index = await peopleIndex();
	const byEmail = new Map<string, Person>();
	for (const p of index.people) {
		if (p.email) {
			byEmail.set(p.email.trim().toLowerCase(), p);
		}
	}
	return { state: index.state, byEmail };
}

/**
 * The person an admin is issuing to: a current member, whose name / email become the record's snapshot. Null when
 * the list has no such person; `people_unconfigured` / `people_unavailable`
 * when there is no list to look in.
 */
export async function findPerson(userId: string): Promise<PersonSummary | null> {
	const index = await peopleIndex();
	const person = index.byId.get(userId);
	if (person) {
		return { id: person.id, name: person.name, email: person.email };
	}
	if (index.state === 'unconfigured') {
		throw new AppError(ErrorCode.PeopleUnconfigured);
	}
	if (index.state === 'unavailable') {
		throw new AppError(ErrorCode.PeopleUnavailable);
	}
	return null;
}
