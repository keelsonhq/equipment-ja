import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import { expect } from 'vite-plus/test';
import type { Actor } from '#lib/server/auth/actor.ts';
import { setClientForTest } from '#lib/server/db/client.ts';
import {
	AppError,
	CsvError,
	type ErrorCode,
	type FieldErrors,
	ValidationError,
} from '#lib/server/errors.ts';
import { type FileStore, setFileStoreForTest } from '#lib/server/domain/files.ts';
import {
	type Person,
	type PersonSummary,
	setDirectoryForTest,
} from '#lib/server/domain/directory.ts';
import { ensureReady } from '#lib/server/ready.ts';
import { seedSampleData } from '#lib/server/domain/seed.ts';
import { strictClient } from './strict-client.ts';

// Test harness, with nothing particular to this app's records: every test gets
// its own temporary on-disk database (a real libSQL file, so the connection
// pool behaves as in `pnpm dev`), its own in-memory file store, a directory of
// three test people and an environment without the local-development switches.
// No network, no API keys. The client is wrapped to reject named arguments the
// SQL does not use, as remote libSQL does. A test file that uses freshDb runs
// `afterEach(cleanupDbs)`, which undoes all of it.
// The app's own records (items, types, places, issues) are made with helpers.ts.

export const ADMIN: Actor = {
	id: 'u-admin',
	name: 'Admin User',
	email: 'admin@example.com',
	isAdmin: true,
};

export const MEMBER: Actor = {
	id: 'u-member',
	name: 'Member User',
	email: 'member@example.com',
	isAdmin: false,
};

export const OTHER: Actor = {
	id: 'u-other',
	name: 'Other User',
	email: 'other@example.com',
	isAdmin: false,
};

/**
 * Directory profile images of the test people (ADMIN and OTHER have one,
 * MEMBER has none). Any http(s) URL will do: nothing is fetched in the tests.
 */
export const IMAGE_URLS = {
	[ADMIN.id]: 'https://img.example.com/u/admin',
	[OTHER.id]: 'https://img.example.com/u/other',
} as Record<string, string>;

let tempDirs: string[] = [];

// Environment variables that switch on local development or change what
// happens at start (src/lib/server/env.ts, the identity SDK's local mode). freshDb removes them, so neither the shell
// nor an earlier test decides what a test sees; a test that needs one sets it
// after freshDb. cleanupDbs puts back the values the process started with.
const ENV_KEYS = [
	'KEELSON_MODE',
	'KEELSON_LOCAL_MODE',
	'KEELSON_LOCAL_USERS_FILE',
	'LOCAL_SAMPLE_DATA',
	'KEELSON_APP_URL',
] as const;
let savedEnv: Record<string, string | undefined> | null = null;

/** A temporary on-disk database URL (removed by cleanupDbs). */
export function tempDbUrl(): string {
	const dir = mkdtempSync(join(tmpdir(), 'template-test-'));
	tempDirs.push(dir);
	return `file:${join(dir, 'test.db')}`;
}

/**
 * Fresh database, started like the server does (migrations + default lists).
 * `env` is applied before the start (e.g. local development); `samples` loads the
 * sample ledger afterwards, as the tests' own fixture.
 */
export async function freshDb(
	opts: { samples?: boolean; env?: Record<string, string>; url?: string } = {},
): Promise<Client> {
	savedEnv ??= Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	for (const key of ENV_KEYS) {
		delete process.env[key];
	}
	Object.assign(process.env, opts.env ?? {});
	// An in-memory file store: the tests cover this app, not the file SDK's
	// local backend (which is OS-specific).
	setFileStoreForTest(memoryStore());
	const db = strictClient(createClient({ url: opts.url ?? tempDbUrl() }));
	setClientForTest(db);
	// A directory with the three test people, unless a test overrides it.
	setDirectoryForTest(async () => [ADMIN, MEMBER, OTHER].map(directoryPerson));
	await ensureReady(db);
	if (opts.samples) {
		await seedSampleData(db);
	}
	return db;
}

/**
 * Someone as the directory lists them (the shape `setDirectoryForTest` takes):
 * the image of IMAGE_URLS, or none.
 */
export function directoryPerson(person: PersonSummary): Person {
	return {
		id: person.id,
		name: person.name,
		email: person.email,
		imageUrl: IMAGE_URLS[person.id] ?? null,
	};
}

/** Undo freshDb: temp dirs, directory, file store and environment (call from afterEach). */
export function cleanupDbs(): void {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tempDirs = [];
	setDirectoryForTest(null);
	setFileStoreForTest(null);
	if (savedEnv !== null) {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
		savedEnv = null;
	}
}

/** A Map-backed FileStore. */
export function memoryStore(): FileStore & { keys(): string[] } {
	const data = new Map<string, Uint8Array>();
	return {
		write: async (key, bytes) => {
			data.set(key, bytes);
		},
		read: async (key) => data.get(key) ?? null,
		delete: async (key) => {
			data.delete(key);
		},
		keys: () => [...data.keys()],
	};
}

/** The rejection `expectError` checks for. */
export interface ExpectedError {
	status: number;
	code: ErrorCode;
	/** `validation_failed`: exactly these field reasons. */
	fields?: FieldErrors;
	/** A CSV file problem: the line of the file it is at (null: the whole file). */
	line?: number | null;
}

/** The `validation_failed` rejection (422) with exactly these field reasons. */
export function invalid(fields: FieldErrors): ExpectedError {
	return { status: 422, code: 'validation_failed', fields };
}

/**
 * Assert that `action` fails with an AppError of this status and code and, when
 * given, exactly these field reasons or this CSV line. `action` is a promise, or
 * a function for code that throws synchronously. Errors that are not an
 * AppError (the migration runner, a database error) use Vitest's
 * `await expect(promise).rejects` matchers.
 */
export async function expectError(
	action: Promise<unknown> | (() => unknown),
	expected: ExpectedError,
): Promise<void> {
	let error: unknown;
	try {
		await (typeof action === 'function' ? action() : action);
	} catch (err) {
		error = err;
	}
	expect(error, 'expected an AppError, but the call did not fail with one').toBeInstanceOf(
		AppError,
	);
	const err = error as AppError;
	// Compared as one object, so a failure shows every difference at once.
	const actual: ExpectedError = { status: err.status, code: err.code };
	if (expected.fields !== undefined) {
		actual.fields = err instanceof ValidationError ? err.fields : undefined;
	}
	if (expected.line !== undefined) {
		actual.line = err instanceof CsvError ? err.line : undefined;
	}
	expect(actual).toEqual(expected);
}
