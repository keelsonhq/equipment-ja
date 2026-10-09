import type { Session } from '#lib/server/auth/session.ts';
import { errorCode, getJson } from '#lib/api.ts';

// The signed-in user and app setup (GET /api/me), loaded once by the root
// layout and shared by every page.
export const session = $state<{ me: Session | null; error: string | null }>({
	me: null,
	error: null,
});

export async function loadSession(): Promise<void> {
	try {
		session.me = await getJson<Session>('/api/me');
		session.error = null;
	} catch (err) {
		session.me = null;
		session.error = errorCode(err);
	}
}
