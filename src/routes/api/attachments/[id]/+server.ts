import { deleteAttachment, readAttachment } from '#lib/server/domain/attachments.ts';
import { getClient } from '#lib/server/db/client.ts';
import { actorOf, handle, ok, requireJsonBody } from '#lib/server/http/handler.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () => {
		const { meta, bytes } = await readAttachment(getClient(), actorOf(event), event.params.id);
		const disposition = event.url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
		return new Response(new Uint8Array(bytes), {
			headers: {
				'content-type': meta.contentType,
				'content-length': String(bytes.byteLength),
				'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.fileName)}`,
				'x-content-type-options': 'nosniff',
				'cache-control': 'private, no-store',
			},
		});
	});

export const DELETE: RequestHandler = (event) =>
	handle(async () => {
		await requireJsonBody(event.request);
		await deleteAttachment(getClient(), actorOf(event), event.params.id);
		return ok({ ok: true });
	});
