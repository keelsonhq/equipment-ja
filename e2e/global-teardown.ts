import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

// Remove the run's temporary directory (database + file store) created by
// playwright.config.ts. Only a directory that config created is removed.
export default function globalTeardown(): void {
	const dir = process.env.E2E_RUN_DIR;
	if (
		!dir ||
		resolve(dirname(dir)) !== resolve(tmpdir()) ||
		!basename(dir).startsWith('template-e2e-')
	) {
		return;
	}
	try {
		rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
	} catch {
		// The OS cleans its temporary directory; a leftover is harmless.
	}
}
