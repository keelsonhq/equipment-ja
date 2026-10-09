import { actorOf, handle, ok } from '#lib/server/http/handler.ts';
import { searchPeople } from '#lib/server/domain/people.ts';
import { SEARCH_MAX } from '#lib/limits.ts';
import type { RequestHandler } from './$types';

// Employee picker candidates (admin).
export const GET: RequestHandler = (event) =>
	handle(async () =>
		ok(
			await searchPeople(
				actorOf(event),
				(event.url.searchParams.get('q') ?? '').slice(0, SEARCH_MAX),
			),
		),
	);
