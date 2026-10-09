import { getClient } from '#lib/server/db/client.ts';
import { ErrorCode } from '#lib/server/errors.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { actorOf, handle, ok, readBytes } from '#lib/server/http/handler.ts';
import { parseImportOptions, parseImportRun } from '#lib/server/http/queries.ts';
import { runImport } from '#lib/server/import/importer.ts';
import { IMPORT_BYTES_MAX } from '#lib/limits.ts';
import type { RequestHandler } from './$types';

// Import a CSV file. The same body and options as the preview, plus `name`
// (the file name, kept in the history) and `mode` (`all` / `skip_errors`).
export const POST: RequestHandler = (event) =>
	handle(async () => {
		const actor = actorOf(event);
		// runImport checks the admin too; checking here first refuses a member
		// before up to IMPORT_BYTES_MAX of upload is read.
		requireAdmin(actor);
		const bytes = await readBytes(event.request, IMPORT_BYTES_MAX, ErrorCode.CsvTooLarge);
		const params = event.url.searchParams;
		const { mode, fileName } = parseImportRun(params);
		return ok(
			await runImport(getClient(), actor, bytes, fileName, parseImportOptions(params), mode),
		);
	});
