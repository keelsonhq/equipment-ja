import type { Actor } from './actor.ts';
import { AppError, ErrorCode } from '#lib/server/errors.ts';

/**
 * Admin gate for the business layer. Every management operation calls this
 * itself — the UI hiding a button is never the protection.
 */
export function requireAdmin(actor: Actor): void {
	if (!actor.isAdmin) {
		throw new AppError(ErrorCode.ForbiddenManageRequired);
	}
}
