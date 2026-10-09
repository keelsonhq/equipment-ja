// Dev launcher (`pnpm dev`): run the SvelteKit dev server (UI + API + HMR in
// one process) behind `keelson dev serve`, the Keelson CLI's local gateway.
// The gateway signs every request in as a user of the local roster
// (seed-data/dev-users.json) with the same X-Keelson-User-* headers as
// production, mocks the Directory API with the same roster, and lets you
// switch users at /__keelson/dev. See
// https://keelson.dev/docs/building-apps/local-development/
//
// Without the CLI (or with one too old for `dev serve`) it warns and starts the
// dev server directly in the identity SDK's local mode: the roster's admin is
// always the user, and the roster is the member list. No user switching.
//
// It also asks the server to load the sample ledger into an empty local
// database (LOCAL_SAMPLE_DATA=1; set it to 0 in the shell or .env to start
// empty). A deployed app or `pnpm start` never loads samples.
// Node standard library only, so `pnpm dev` works from a fresh checkout.
//
// Usage:
//   pnpm dev                          # as the roster's admin
//   pnpm dev -- --as sample-sato      # start as another roster user (CLI only)
//   pnpm dev -- --port 5190           # fixed port, fail if taken (e2e)
//
// The pure helpers are exported for unit tests; the process side effects run
// only when invoked directly.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const require = createRequire(import.meta.url);
const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const USERS_FILE = join(APP_ROOT, 'seed-data', 'dev-users.json');

/** Absolute path to a dependency's CLI entry, resolved via its package.json `bin`. */
function resolveBin(pkg, preferred) {
	const pkgPath = require.resolve(`${pkg}/package.json`);
	const { bin } = require(pkgPath);
	const rel = typeof bin === 'string' ? bin : bin[preferred];
	return resolve(dirname(pkgPath), rel);
}

/** Parse the flags passed after `pnpm dev --` (both `--flag v` and `--flag=v`). */
export function parseArgs(argv) {
	let as = null;
	let port = null;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		// Tolerate a lone `--` separator (some runners forward it verbatim).
		if (arg === '--') continue;
		const eq = arg.indexOf('=');
		const [flag, inlineValue] = eq === -1 ? [arg, null] : [arg.slice(0, eq), arg.slice(eq + 1)];
		const value = inlineValue ?? argv[++i];
		if (flag === '--as') as = value;
		else if (flag === '--port') port = Number(value);
		else throw new Error(`unknown argument: ${arg}`);
	}
	if (as === '') throw new Error('--as requires a user id');
	if (port !== null && !(Number.isInteger(port) && port > 0 && port < 65536)) {
		throw new Error('--port must be a port number');
	}
	return { as, port };
}

/**
 * The command line: `keelson dev serve ... -- <dev server>` with the CLI, or
 * the dev server alone without it. Behind the gateway the dev server listens
 * on 127.0.0.1 at the port the CLI picks ({port}); the gateway takes --port
 * (default 5173). Alone, Vite takes --port, or its default (5173, or the next
 * free port).
 */
export function commandLine({ as, port, cli, vpBin }) {
	const vite = [process.execPath, vpBin, 'dev'];
	if (!cli) {
		return port === null ? vite : [...vite, '--port', String(port), '--strictPort'];
	}
	const serve = ['keelson', 'dev', 'serve', '--users', USERS_FILE];
	if (port !== null) serve.push('--port', String(port));
	if (as !== null) serve.push('--as', as);
	return [...serve, '--', ...vite, '--host', '127.0.0.1', '--port', '{port}', '--strictPort'];
}

/** Read and parse APP_ROOT/.env if present (node:util parseEnv). Absent -> {}. */
function loadDotEnv() {
	try {
		return parseEnv(readFileSync(join(APP_ROOT, '.env'), 'utf8'));
	} catch (err) {
		if (err.code !== 'ENOENT') {
			console.error(`[dev] failed to read .env: ${err.message}`);
		}
		return {};
	}
}

/**
 * Env for the dev server. Precedence, low to high: launcher defaults, the .env
 * file (optional real settings), the parent shell environment, and, without
 * the CLI, the SDK's local mode with the same roster.
 */
export function buildChildEnv({ cli, baseEnv = {}, dotenv = {} }) {
	const env = {
		KEELSON_FILES_DIR: join(APP_ROOT, '.keelson', 'files'),
		// The file SDK's local backend on macOS / Windows is development-only and
		// needs this explicit opt-in (Linux does not use it). Production never
		// runs the launcher and always uses the platform file store.
		KEELSON_FILES_ALLOW_BESTEFFORT_LOCAL: '1',
		LOCAL_SAMPLE_DATA: '1',
		...dotenv,
		...baseEnv,
	};
	if (!cli) {
		env.KEELSON_LOCAL_MODE = '1';
		env.KEELSON_LOCAL_USERS_FILE = USERS_FILE;
	}
	return env;
}

/** Whether the installed Keelson CLI has `keelson dev serve` (v0.6.11 or later). */
function hasDevServe() {
	return spawnSync('keelson', ['dev', 'serve', '--check'], { stdio: 'ignore' }).status === 0;
}

function main() {
	let parsed;
	try {
		parsed = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`[dev] ${err.message}`);
		process.exit(1);
	}
	const cli = hasDevServe();
	if (!cli) {
		console.warn(
			'[dev] warning: `keelson dev serve` is not available (Keelson CLI v0.6.11 or later). ' +
				'Starting in the identity SDK local mode: you are always the roster admin and cannot ' +
				'switch users. Install the CLI: curl -fsSL https://keelson.dev/install.sh | sh',
		);
	}
	const [command, ...args] = commandLine({ ...parsed, cli, vpBin: resolveBin('vite-plus', 'vp') });
	// Anchor to the app root so relative paths (local.db, .keelson/files)
	// resolve the same regardless of where `pnpm dev` was launched from.
	const child = spawn(command, args, {
		cwd: APP_ROOT,
		stdio: 'inherit',
		env: buildChildEnv({ cli, baseEnv: process.env, dotenv: loadDotEnv() }),
	});
	child.on('exit', (code, signal) => {
		process.exit(typeof code === 'number' ? code : signal ? 1 : 0);
	});
	child.on('error', (err) => {
		console.error(`[dev] failed to start ${command}: ${err.message}`);
		process.exit(1);
	});
	for (const sig of ['SIGINT', 'SIGTERM']) {
		process.on(sig, () => {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill(sig);
			}
		});
	}
}

// Run only when invoked directly (`node scripts/dev.mjs`); importing (tests) must
// not spawn anything. Both sides are real paths: Node resolves symlinks in
// import.meta.url but not in argv[1] (macOS /tmp is one).
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
