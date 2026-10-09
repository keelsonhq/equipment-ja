import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { rowLink } from '#lib/components/ui/rowLink.ts';

// A table row that opens a page (src/lib/components/ui/rowLink.ts): focusable,
// Enter and a click open the page, a click on a control inside the row does
// not, and other keys are the caller's.

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));

afterEach(() => {
	goto.mockClear();
});

// There is no DOM in these tests. A node knows its tag and its parent, which is
// enough for `closest()` with the tag selectors rowLink uses.
class FakeNode {
	constructor(
		readonly tag: string,
		readonly parent: FakeNode | null = null,
	) {}

	closest(selector: string): FakeNode | null {
		const tags = selector.split(',').map((s) => s.trim());
		return tags.includes(this.tag) ? this : (this.parent?.closest(selector) ?? null);
	}
}

type Listener = (e: unknown) => void;

class FakeRow extends FakeNode {
	tabIndex = -1;
	readonly listeners = new Map<string, Listener>();

	constructor() {
		super('tr');
	}

	addEventListener(type: string, fn: Listener) {
		this.listeners.set(type, fn);
	}

	removeEventListener(type: string, fn: Listener) {
		if (this.listeners.get(type) === fn) {
			this.listeners.delete(type);
		}
	}

	click(target: FakeNode) {
		this.listeners.get('click')?.({ target });
	}

	/** Press `key` with focus on `target`; true when the default was prevented. */
	press(key: string, target: FakeNode = this): boolean {
		let prevented = false;
		this.listeners.get('keydown')?.({ key, target, preventDefault: () => (prevented = true) });
		return prevented;
	}
}

function linkedRow(href = '/items/7') {
	const row = new FakeRow();
	const detach = rowLink(href)(row as unknown as HTMLElement);
	const cell = new FakeNode('td', row);
	return { row, cell, detach };
}

describe('rowLink', () => {
	it('makes the row focusable, and Enter on it opens the page', () => {
		const { row } = linkedRow('/members/sample-sato');
		expect(row.tabIndex).toBe(0);
		expect(row.press('Enter')).toBe(true);
		expect(goto).toHaveBeenCalledExactlyOnceWith('/members/sample-sato');
	});

	it('opens the page on a click anywhere in the row but a control', () => {
		const { row, cell } = linkedRow();
		row.click(cell);
		row.click(new FakeNode('span', cell));
		row.click(row);
		expect(goto.mock.calls).toEqual([['/items/7'], ['/items/7'], ['/items/7']]);
	});

	it('leaves a click on a control in the row to the control', () => {
		const { row, cell } = linkedRow();
		for (const tag of ['a', 'button', 'input', 'label', 'select', 'textarea']) {
			row.click(new FakeNode(tag, cell));
		}
		// The icon inside a button is part of the button.
		row.click(new FakeNode('svg', new FakeNode('button', cell)));
		expect(goto).not.toHaveBeenCalled();
	});

	it('leaves Enter on a control in the row, and other keys, to the caller', () => {
		const { row, cell } = linkedRow();
		expect(row.press('Enter', new FakeNode('button', cell))).toBe(false);
		expect(row.press(' ')).toBe(false);
		expect(row.press('ArrowDown')).toBe(false);
		expect(goto).not.toHaveBeenCalled();
	});

	it('stops listening when it is detached', () => {
		const { row, cell, detach } = linkedRow();
		detach?.();
		expect(row.listeners.size).toBe(0);
		row.click(cell);
		row.press('Enter');
		expect(goto).not.toHaveBeenCalled();
	});
});
