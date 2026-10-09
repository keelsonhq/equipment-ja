import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { readPref, writePref } from '#lib/state/prefs.ts';

// Display preferences live in localStorage under the app's key prefix. A
// preference saved by an earlier version of the app must still be read.

let store: Map<string, string>;

beforeEach(() => {
	store = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => store.set(key, value),
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('display preferences', () => {
	it('stores values as JSON under the equipment: prefix', () => {
		writePref('items.columns', ['name', 'type']);
		expect([...store.entries()]).toEqual([['equipment:items.columns', '["name","type"]']]);
		expect(readPref('items.columns', [])).toEqual(['name', 'type']);
	});

	it('reads what browsers already saved, and falls back when there is nothing', () => {
		store.set('equipment:density.dense', 'true');
		expect(readPref('density.dense', false)).toBe(true);
		expect(readPref('items.columns', ['name'])).toEqual(['name']);
	});

	it('falls back when storage is blocked or the value is broken', () => {
		store.set('equipment:density.dense', '{broken');
		expect(readPref('density.dense', false)).toBe(false);
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
		});
		expect(readPref('density.dense', false)).toBe(false);
		expect(() => writePref('density.dense', true)).not.toThrow();
	});
});
