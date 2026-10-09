import { describe, expect, it } from 'vite-plus/test';
import { buildChildEnv, commandLine, parseArgs, USERS_FILE } from '../scripts/dev.mjs';

const VP = '/app/node_modules/vite-plus/bin/vp';

describe('pnpm dev launcher', () => {
	it('parses --as, --port and the pnpm `--` separator', () => {
		expect(parseArgs([])).toEqual({ as: null, port: null });
		expect(parseArgs(['--', '--as', 'sample-sato', '--port=5190'])).toEqual({
			as: 'sample-sato',
			port: 5190,
		});
		expect(() => parseArgs(['--port', 'abc'])).toThrow(/--port must be/);
		expect(() => parseArgs(['--user', 'x'])).toThrow(/unknown argument/);
	});

	it('runs the dev server behind keelson dev serve with the roster', () => {
		expect(commandLine({ as: 'sample-sato', port: 5190, cli: true, vpBin: VP })).toEqual([
			'keelson',
			'dev',
			'serve',
			'--users',
			USERS_FILE,
			'--port',
			'5190',
			'--as',
			'sample-sato',
			'--',
			process.execPath,
			VP,
			'dev',
			'--host',
			'127.0.0.1',
			'--port',
			'{port}',
			'--strictPort',
		]);
	});

	it('runs the dev server alone without the CLI', () => {
		expect(commandLine({ as: null, port: null, cli: false, vpBin: VP })).toEqual([
			process.execPath,
			VP,
			'dev',
		]);
		expect(commandLine({ as: null, port: 5190, cli: false, vpBin: VP }).slice(3)).toEqual([
			'--port',
			'5190',
			'--strictPort',
		]);
	});

	it('uses the SDK local mode with the same roster only without the CLI', () => {
		const local = buildChildEnv({ cli: false, dotenv: { FOO: 'from-dotenv' } });
		expect(local).toMatchObject({
			KEELSON_LOCAL_MODE: '1',
			KEELSON_LOCAL_USERS_FILE: USERS_FILE,
			FOO: 'from-dotenv',
		});
		expect(buildChildEnv({ cli: true })).not.toHaveProperty('KEELSON_LOCAL_MODE');
	});

	it('requests the local sample ledger unless told otherwise', () => {
		expect(buildChildEnv({ cli: true }).LOCAL_SAMPLE_DATA).toBe('1');
		const optedOut = buildChildEnv({ cli: true, baseEnv: { LOCAL_SAMPLE_DATA: '0' } });
		expect(optedOut.LOCAL_SAMPLE_DATA).toBe('0');
	});
});
