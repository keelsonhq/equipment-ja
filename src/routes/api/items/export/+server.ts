import { CSV_FILE_PREFIX } from '#lib/server/content.ts';
import { itemsToCsv } from '#lib/server/import/csv.ts';
import { today } from '#lib/server/dates.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle } from '#lib/server/http/handler.ts';
import { exportItems } from '#lib/server/domain/items.ts';
import { parseItemQuery } from '#lib/server/http/queries.ts';
import type { RequestHandler } from './$types';

// CSV of the ledger with the same filters as GET /api/items (no paging), or of
// the selected rows (`ids`).
export const GET: RequestHandler = (event) =>
	handle(async () => {
		const rows = await exportItems(
			getClient(),
			actorOf(event),
			parseItemQuery(event.url.searchParams),
		);
		return new Response(itemsToCsv(rows), {
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="${CSV_FILE_PREFIX}-${today()}.csv"`,
				'cache-control': 'no-store',
			},
		});
	});
