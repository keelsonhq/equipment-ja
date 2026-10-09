import { CSV_TEMPLATE_FILE } from '#lib/server/content.ts';
import { importTemplate } from '#lib/server/import/importer.ts';
import { actorOf, handle } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

// The import template: header + two example rows (UTF-8 with a BOM).
export const GET: RequestHandler = (event) =>
	handle(async () => {
		return new Response(importTemplate(actorOf(event)), {
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="${CSV_TEMPLATE_FILE}"`,
				'cache-control': 'no-store',
			},
		});
	});
