import { addAttachment, listAttachments } from '#lib/server/domain/attachments.ts';
import { getClient } from '#lib/server/db/client.ts';
import { ErrorCode } from '#lib/server/errors.ts';
import { actorOf, handle, ok, readBytes } from '#lib/server/http/handler.ts';
import { parseIdParam } from '#lib/server/http/validate.ts';
import { ATTACHMENT_BYTES_MAX } from '#lib/limits.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(await listAttachments(getClient(), actorOf(event), parseIdParam(event.params.id))),
	);

// Upload: the raw file bytes as `application/octet-stream`, the file name in
// `?name=` (see readBytes).
export const POST: RequestHandler = (event) =>
	handle(async () => {
		const actor = actorOf(event);
		const bytes = await readBytes(
			event.request,
			ATTACHMENT_BYTES_MAX,
			ErrorCode.AttachmentTooLarge,
		);
		return ok(
			await addAttachment(
				getClient(),
				actor,
				parseIdParam(event.params.id),
				event.url.searchParams.get('name'),
				bytes,
			),
			201,
		);
	});
