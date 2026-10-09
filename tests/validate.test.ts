import { describe, expect, it } from 'vite-plus/test';
import { AppError } from '#lib/server/errors.ts';
import { Checker } from '#lib/server/http/validate.ts';
import { ToolArgs } from '#lib/server/mcp/args.ts';

describe('Checker.nested', () => {
	it("writes the block's problems into the parent's errors, named block.key", () => {
		const c = new Checker({ name: '', block: { date: 'no', inner: { id: 'x' } } });
		c.text('name', { max: 10, required: true });
		const b = c.nested('block');
		b?.date('date');
		b?.nested('inner')?.id('id');
		expect(c.errors).toEqual({
			name: 'required',
			'block.date': 'invalid_date',
			'block.inner.id': 'invalid',
		});
		expect(() => c.done()).toThrow();
	});

	it('takes an absent or null block as null', () => {
		const c = new Checker({ empty: null });
		expect(c.nested('missing')).toBeNull();
		expect(c.nested('empty')).toBeNull();
		expect(c.errors).toEqual({});
	});

	it('answers a block that is not an object with invalid_request (JSON API)', () => {
		for (const value of ['text', 3, [], true]) {
			const c = new Checker({ block: value });
			expect(() => c.nested('block')).toThrow(AppError);
		}
	});

	it('makes a block that is not an object an `invalid` argument (AI assistant tools)', () => {
		const c = new ToolArgs({ assign_to: 'Taro' });
		expect(c.nested('assign_to')).toBeNull();
		expect(c.errors).toEqual({ assign_to: 'invalid' });
	});

	it('reads a tool block with the same reader kind', () => {
		const c = new ToolArgs({ assign_to: {} });
		expect(c.nested('assign_to')).toBeInstanceOf(ToolArgs);
	});
});

describe('Checker.int', () => {
	it('reads a whole number from a JSON number or digits in a string', () => {
		const c = new Checker({ a: 3, b: '12', c: ' 1,200 ', d: 0, e: '-3' });
		expect(c.int('a', { min: 1, max: 10 })).toBe(3);
		expect(c.int('b', { min: 1 })).toBe(12);
		expect(c.int('c', { min: 0, max: 5000 })).toBe(1200);
		expect(c.int('d', { min: 0 })).toBe(0);
		expect(c.int('e', { min: -5, max: 5 })).toBe(-3);
		expect(c.errors).toEqual({});
	});

	it('takes absent or blank as null, or `required` when it is', () => {
		const c = new Checker({ blank: '  ', empty: null });
		expect(c.int('missing', { min: 0 })).toBeNull();
		expect(c.int('blank', { min: 0 })).toBeNull();
		expect(c.errors).toEqual({});
		expect(c.int('empty', { min: 0, required: true })).toBe(0);
		expect(c.errors).toEqual({ empty: 'required' });
	});

	it('rejects fractions, non-digit text, out-of-range and unsafe numbers', () => {
		const c = new Checker(
			{
				frac: 1.5,
				text: 'ten',
				low: 0,
				high: 11,
				huge: 2 ** 53,
				bool: true,
				neg: '-3',
				comma: ',',
				exp: '1e3',
				hex: '0x10',
			},
			'block.',
		);
		expect(c.int('frac', { min: 0 })).toBeNull();
		expect(c.int('text', { min: 0 })).toBeNull();
		expect(c.int('low', { min: 1, max: 10 })).toBeNull();
		expect(c.int('high', { min: 1, max: 10 })).toBeNull();
		expect(c.int('huge', { min: 0 })).toBeNull();
		expect(c.int('bool', { min: 0 })).toBeNull();
		expect(c.int('neg', { min: 0 })).toBeNull();
		expect(c.int('comma', { min: 0 })).toBeNull();
		expect(c.int('exp', { min: 0 })).toBeNull();
		expect(c.int('hex', { min: 0 })).toBeNull();
		expect(c.int('high', { min: 1, max: 10, required: true })).toBe(0);
		expect(c.errors).toEqual({
			'block.frac': 'invalid',
			'block.text': 'invalid',
			'block.low': 'invalid',
			'block.high': 'invalid',
			'block.huge': 'invalid',
			'block.bool': 'invalid',
			'block.neg': 'invalid',
			'block.comma': 'invalid',
			'block.exp': 'invalid',
			'block.hex': 'invalid',
		});
		expect(() => c.done()).toThrow();
	});
});
