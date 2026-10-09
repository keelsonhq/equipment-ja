// The only way the UI talks to the server. The browser never builds
// authentication headers: the platform gateway adds them (and the dev launcher
// stands in for it locally).

/**
 * A failed API call: the HTTP status, the server's stable error code and, for
 * `validation_failed`, the reason per form field (or, for a CSV file problem,
 * the file line).
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly fields: Record<string, string> | null;
	readonly line: number | null;

	constructor(
		status: number,
		code: string,
		fields: Record<string, string> | null = null,
		line: number | null = null,
	) {
		super(code);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.fields = fields;
		this.line = line;
	}
}

/** Error code of anything thrown by the API helpers. */
export function errorCode(err: unknown): string {
	return err instanceof ApiError ? err.code : 'network_error';
}

async function parse<T>(res: Response): Promise<T> {
	if (res.ok) {
		return (await res.json()) as T;
	}
	let code = 'internal_error';
	let fields: Record<string, string> | null = null;
	let line: number | null = null;
	try {
		const body = (await res.json()) as { error?: unknown; fields?: unknown; line?: unknown };
		if (typeof body.error === 'string') {
			code = body.error;
		}
		if (body.fields && typeof body.fields === 'object') {
			fields = body.fields as Record<string, string>;
		}
		if (typeof body.line === 'number') {
			line = body.line;
		}
	} catch {
		// Not JSON (e.g. a proxy error page): keep the generic code.
	}
	throw new ApiError(res.status, code, fields, line);
}

async function request(input: string, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(input, { credentials: 'same-origin', ...init });
	} catch {
		throw new ApiError(0, 'network_error');
	}
}

type Query = Record<string, string | number | null | undefined>;

/** Build `path?query`, dropping empty values. */
export function withQuery(path: string, query: Query = {}): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== null && value !== undefined && value !== '') {
			params.set(key, String(value));
		}
	}
	const qs = params.toString();
	return qs ? `${path}?${qs}` : path;
}

export async function getJson<T>(path: string, query?: Query): Promise<T> {
	return parse<T>(await request(withQuery(path, query)));
}

/**
 * State-changing call. Always sends a JSON body (an empty object if none):
 * the server accepts only `application/json` on these endpoints.
 */
export async function sendJson<T>(
	method: 'POST' | 'PATCH' | 'DELETE',
	path: string,
	body: unknown = {},
): Promise<T> {
	return parse<T>(
		await request(path, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		}),
	);
}

/** Upload a file's raw bytes (attachments, CSV import); `query` adds options. */
export async function uploadFile<T>(path: string, file: File, query: Query = {}): Promise<T> {
	return parse<T>(
		await request(withQuery(path, { name: file.name, ...query }), {
			method: 'POST',
			headers: { 'content-type': 'application/octet-stream' },
			body: file,
		}),
	);
}
