// Centralized environment access. Every process.env read on the server lives
// here so the rest of the code depends on typed helpers, never on raw lookups.

import { dbConfigFromEnv } from '../../../scripts/migrate.mjs';

/** Read an optional string env var, treating empty / blank strings as unset. */
export function optionalEnv(name: string): string | undefined {
	const value = process.env[name];
	if (value === undefined || value.trim() === '') {
		return undefined;
	}
	return value.trim();
}

/**
 * libSQL connection settings.
 *
 * The platform injects KEELSON_DB_URL / KEELSON_DB_AUTH_TOKEN for a
 * `db.mode: libsql` deploy (plus the legacy TURSO_* aliases). Without them
 * (local dev, `pnpm start` on a laptop, CI) the app falls back to a local file
 * so every feature runs with zero setup. LOCAL_DB_URL overrides the file path.
 * The migration CLI (scripts/migrate.mjs, run before each deploy) resolves the
 * same settings with the same function, so both always open the same database.
 */
export function dbConfig(): { url: string; authToken?: string } {
	return dbConfigFromEnv(process.env);
}

/**
 * Local development: `pnpm dev` (scripts/dev.mjs) runs the app behind
 * `keelson dev serve` (KEELSON_MODE=local) or, without the CLI, in the identity
 * SDK's local mode (KEELSON_LOCAL_MODE=1). Never true in a Keelson deployment:
 * any of the platform's production marks turns it off (the SDK refuses local
 * mode there too).
 */
export function localDevelopment(): boolean {
	const local = optionalEnv('KEELSON_MODE') === 'local' || sdkLocalMode();
	const production = [
		'KEELSON_APP_ID',
		'KEELSON_WORKSPACE_ID',
		'KEELSON_TENANT_ID',
		'KEELSON_DEPLOY_ID',
		'KEELSON_APP_URL',
	].some((name) => optionalEnv(name) !== undefined);
	return local && !production;
}

/** The identity SDK's local mode (fixed admin, members from the local roster). */
function sdkLocalMode(): boolean {
	return ['1', 'true', 'yes'].includes(optionalEnv('KEELSON_LOCAL_MODE') ?? '');
}

/**
 * Whether the platform Directory API is wired for this deploy. Both values are
 * injected after `keelson apps directory enable` + redeploy, and by
 * `keelson dev serve` (its mock directory). The deprecated
 * KEELSON_IDENTITY_BASE_URL alias is still accepted by the SDK. In the SDK's
 * local mode the members come from the local roster instead.
 */
export function directoryConfigured(): boolean {
	if (sdkLocalMode()) {
		return true;
	}
	const base =
		optionalEnv('KEELSON_DIRECTORY_BASE_URL') ?? optionalEnv('KEELSON_IDENTITY_BASE_URL');
	return base !== undefined && optionalEnv('KEELSON_DIRECTORY_TOKEN') !== undefined;
}

/**
 * IANA time zone used for "today" (default issue / return dates, overdue
 * checks). The platform runs containers in UTC; the business day is local.
 */
export function appTimeZone(): string {
	return optionalEnv('APP_TIME_ZONE') ?? 'Asia/Tokyo';
}

/**
 * Whether to load the sample ledger into an empty database at start. Only in
 * local development (the `pnpm dev` launcher sets LOCAL_SAMPLE_DATA=1): a
 * deployed app or `pnpm start` never loads samples, whatever this variable says.
 */
export function localSampleDataRequested(): boolean {
	return localDevelopment() && optionalEnv('LOCAL_SAMPLE_DATA') === '1';
}
