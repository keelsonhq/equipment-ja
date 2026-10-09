import { getClient } from '#lib/server/db/client.ts';
import { ErrorCode } from '#lib/server/errors.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { actorOf, handle, ok, readBytes } from '#lib/server/http/handler.ts';
import { parseImportOptions } from '#lib/server/http/queries.ts';
import { previewImport } from '#lib/server/import/importer.ts';
import { IMPORT_BYTES_MAX } from '#lib/limits.ts';
import type { RequestHandler } from './$types';

// Judge a CSV file without writing anything. Body: the file bytes
// (`application/octet-stream`); options in the query string.
export const POST: RequestHandler = (event) =>
	handle(async () => {
		const actor = actorOf(event);
		// previewImport checks the admin too; checking here first refuses a
		// member before up to IMPORT_BYTES_MAX of upload is read.
		requireAdmin(actor);
		const bytes = await readBytes(event.request, IMPORT_BYTES_MAX, ErrorCode.CsvTooLarge);
		return ok(
			await previewImport(getClient(), actor, bytes, parseImportOptions(event.url.searchParams)),
		);
	});
