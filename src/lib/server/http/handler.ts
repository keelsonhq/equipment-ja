import type { RequestEvent } from '@sveltejs/kit';
import type { Actor } from '#lib/server/auth/actor.ts';
import {
	AppError,
	CsvError,
	ErrorCode,
	errorResponse,
	ValidationError,
} from '#lib/server/errors.ts';

// Thin HTTP helpers shared by every +server.ts. Route handlers stay one-liners:
// parse input, call the business layer (which owns authorization, integrity and
// history), and serialize the result. Business-layer AppErrors become
// `{ "error": "<code>" }` responses.

/** JSON success response, never cached. */
export function ok(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}

/**
 * The caller resolved by hooks.server.ts, which already answers 401 to a
 * request without one: a route only calls this when it needs the actor.
 */
export function actorOf(event: Pick<RequestEvent, 'locals'>): Actor {
	const actor = event.locals.actor;
	if (!actor) {
		throw new AppError(ErrorCode.Unauthorized);
	}
	return actor;
}

/**
 * Read a raw upload body (`application/octet-stream`; the file name goes in
 * the query string). A cross-site form cannot send this content type either.
 * `max` is checked against the declared length first, then the bytes.
 */
export async function readBytes(
	request: Request,
	max: number,
	tooLarge: ErrorCode,
): Promise<Uint8Array> {
	const type = request.headers.get('content-type') ?? '';
	if (!type.toLowerCase().startsWith('application/octet-stream')) {
		throw new AppError(ErrorCode.UnsupportedMediaType);
	}
	if (Number(request.headers.get('content-length') ?? 0) > max) {
		throw new AppError(tooLarge);
	}
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.length > max) {
		throw new AppError(tooLarge);
	}
	return bytes;
}

/**
 * Read a JSON body. Only `application/json` is accepted: a cross-site HTML form
 * cannot send it without a CORS preflight, so state-changing endpoints are not
 * reachable by form-based CSRF.
 */
export async function readJson(request: Request): Promise<unknown> {
	const type = request.headers.get('content-type') ?? '';
	if (!type.toLowerCase().startsWith('application/json')) {
		throw new AppError(ErrorCode.UnsupportedMediaType);
	}
	try {
		return await request.json();
	} catch {
		throw new AppError(ErrorCode.InvalidRequest);
	}
}

/**
 * For a state-changing endpoint that takes no input: the body must still be
 * JSON (any JSON; it is not used), so a cross-site form cannot reach it either.
 */
export async function requireJsonBody(request: Request): Promise<void> {
	await readJson(request);
}

/**
 * Run a handler body, mapping AppError to its code-only JSON response. Any
 * other error is a bug: logged once (with `context`, when the route gives one)
 * and answered `internal_error`.
 */
export async function handle(run: () => Promise<Response>, context?: string): Promise<Response> {
	try {
		return await run();
	} catch (err) {
		if (err instanceof ValidationError) {
			return errorResponse(err.code, { fields: err.fields, ...err.extra });
		}
		if (err instanceof CsvError && err.line !== null) {
			return errorResponse(err.code, { line: err.line });
		}
		if (err instanceof AppError) {
			return errorResponse(err.code);
		}
		console.error(`[api] unexpected error${context ? ` (${context})` : ''}`, err);
		return errorResponse(ErrorCode.InternalError);
	}
}
