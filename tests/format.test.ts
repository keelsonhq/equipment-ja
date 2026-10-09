import { describe, expect, it } from 'vite-plus/test';
import { avatarSrc, initialOf } from '#lib/format.ts';

// The avatar image URL (DESIGN.md §8.10): the directory URL with width /
// height at twice the displayed size, so the picture stays sharp on
// high-density screens; anything unusable falls back to the initial (null).

describe('avatarSrc', () => {
	it('asks for twice the displayed size', () => {
		expect(avatarSrc('https://img.example.com/u/abc', 20)).toBe(
			'https://img.example.com/u/abc?width=40&height=40',
		);
		expect(avatarSrc('https://img.example.com/u/abc', 40)).toBe(
			'https://img.example.com/u/abc?width=80&height=80',
		);
	});

	it('keeps other query parameters and replaces an existing size', () => {
		expect(avatarSrc('https://img.example.com/u/abc?v=2&width=512', 20)).toBe(
			'https://img.example.com/u/abc?v=2&width=40&height=40',
		);
	});

	it('returns null for anything that is not an http(s) URL', () => {
		expect(avatarSrc('not a url', 20)).toBeNull();
		expect(avatarSrc('', 20)).toBeNull();
		expect(avatarSrc('data:image/png;base64,AAAA', 20)).toBeNull();
		expect(avatarSrc('javascript:alert(1)', 20)).toBeNull();
	});
});

describe('initialOf', () => {
	it('skips a leading bracketed label, half- or full-width', () => {
		const [open, close] = [String.fromCodePoint(0xff08), String.fromCodePoint(0xff09)];
		const [lenticularOpen, lenticularClose] = [
			String.fromCodePoint(0x3010),
			String.fromCodePoint(0x3011),
		];
		expect(initialOf('(Sample) Sato')).toBe('S');
		expect(initialOf('[Sample] Sato')).toBe('S');
		expect(initialOf(`${open}Sample${close}Sato`)).toBe('S');
		expect(initialOf(`${lenticularOpen}Sample${lenticularClose} Sato`)).toBe('S');
	});

	it('keeps a name that is only a label, or has none', () => {
		expect(initialOf('(Sample)')).toBe('(');
		expect(initialOf('  sato ')).toBe('s');
		expect(initialOf('')).toBe('?');
	});
});
