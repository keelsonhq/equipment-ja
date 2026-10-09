import { ErrorCode, errorResponse } from '#lib/server/errors.ts';
import type { RequestHandler } from './$types';

// Unknown /api paths answer with the code-only JSON 404, never the HTML page.
export const fallback: RequestHandler = () => errorResponse(ErrorCode.NotFound);
