import { describe, expect, it } from 'vite-plus/test';
import { btn, focusRing, input, menu, section, strip, table, tabs } from '#lib/ui.ts';

// The classes each recipe of src/lib/ui.ts ends up with. The recipes are put
// together from shared parts (sizes, looks, the focus ring); this pins the
// result as a set: the order may change, a class may not appear or go
// unnoticed. The expected strings are the recipes written out in full. When a
// recipe changes on purpose, change its line here too.

function classes(list: string): string[] {
	return list.split(/\s+/).filter(Boolean).toSorted();
}

function expectRecipes(recipes: Record<string, string>, expected: Record<string, string>) {
	expect(Object.keys(recipes).toSorted()).toEqual(Object.keys(expected).toSorted());
	for (const [name, list] of Object.entries(expected)) {
		expect(classes(recipes[name]), name).toEqual(classes(list));
		expect(new Set(classes(recipes[name])).size, `${name} repeats a class`).toBe(
			classes(list).length,
		);
	}
}

const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

describe('ui.ts recipes', () => {
	it('buttons (DESIGN.md §8.5)', () => {
		expectRecipes(btn, {
			primary: `inline-flex items-center gap-1.5 h-9 px-3 rounded-sm bg-accent text-sm font-medium text-white hover:bg-accent-strong ${RING} focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors duration-150 pointer-coarse:h-11 whitespace-nowrap`,
			secondary: `inline-flex items-center gap-1.5 h-9 px-3 rounded-sm border border-rule-strong bg-surface text-sm font-medium text-ink hover:bg-stone-50 hover:border-stone-400 ${RING} focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:text-ink-faint disabled:cursor-not-allowed transition-colors duration-150 pointer-coarse:h-11 whitespace-nowrap`,
			ghost: `inline-flex items-center gap-1.5 h-8 px-2 rounded-xs text-sm text-ink-muted hover:bg-stone-200/60 hover:text-ink ${RING} transition-colors duration-150 disabled:text-ink-faint disabled:hover:bg-transparent disabled:cursor-not-allowed pointer-coarse:h-11 whitespace-nowrap`,
			danger: `inline-flex items-center gap-1.5 h-9 px-3 rounded-sm border border-red-300 bg-surface text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:text-ink-faint transition-colors duration-150 pointer-coarse:h-11 whitespace-nowrap`,
			primarySm: `inline-flex items-center gap-1 h-7 px-2 rounded-sm bg-accent text-xs font-medium text-white hover:bg-accent-strong ${RING} focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors duration-150 pointer-coarse:h-11 whitespace-nowrap`,
			secondarySm: `inline-flex items-center gap-1 h-7 px-2 rounded-sm border border-rule-strong bg-surface text-xs font-medium text-ink hover:bg-stone-50 hover:border-stone-400 ${RING} focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:text-ink-faint disabled:cursor-not-allowed transition-colors duration-150 pointer-coarse:h-11 whitespace-nowrap`,
			ghostIcon: `inline-flex items-center justify-center h-8 px-1.5 rounded-xs text-sm text-ink-muted hover:bg-stone-200/60 hover:text-ink ${RING} transition-colors duration-150 pointer-coarse:h-11`,
			ghostSm: `inline-flex items-center gap-1 h-7 px-2 rounded-xs text-xs text-ink-muted hover:bg-stone-200/60 hover:text-ink ${RING} transition-colors duration-150 disabled:text-ink-faint disabled:cursor-not-allowed pointer-coarse:h-11 whitespace-nowrap`,
		});
	});

	it('inputs (DESIGN.md §8.6)', () => {
		const focus = 'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';
		const invalid = 'aria-invalid:border-red-500 aria-invalid:ring-red-500/20';
		expectRecipes(input, {
			text: `block w-full h-9 rounded-xs border border-rule-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint ${focus} disabled:bg-stone-100 disabled:text-ink-faint ${invalid}`,
			select: `select-chevron block w-full h-9 rounded-xs border border-rule-strong bg-surface pl-3 pr-8 text-sm text-ink ${focus} disabled:bg-stone-100 disabled:text-ink-faint ${invalid}`,
			textarea: `block w-full min-h-20 py-2 leading-6 rounded-xs border border-rule-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint ${focus} ${invalid}`,
			search: `block w-full h-8 rounded-xs border border-rule-strong bg-surface pl-8 pr-3 text-sm text-ink placeholder:text-ink-faint ${focus}`,
			textSm: `block h-8 rounded-xs border border-rule-strong bg-surface px-2 text-xs text-ink placeholder:text-ink-faint ${focus} ${invalid}`,
			filterSelect: `select-chevron h-8 rounded-xs border border-rule-strong bg-surface pl-2 pr-7 text-xs text-ink ${focus}`,
			pageSize: `select-chevron h-7 rounded-xs border border-rule-strong bg-surface pl-2 pr-7 text-xs text-ink font-mono tabular-nums ${focus}`,
			checkbox: 'size-4 align-middle rounded-xs border-rule-strong accent-accent',
			radio: 'size-4 align-middle rounded-full border-rule-strong accent-accent',
			label: 'block text-xs font-medium text-ink-muted mb-1',
			help: 'mt-1 text-xs text-ink-faint',
			error: 'mt-1 text-xs text-red-700',
		});
	});

	it('tables (DESIGN.md §8.3)', () => {
		const th =
			'h-(--head-h) px-4 text-(length:--head-text) font-medium text-ink-muted whitespace-nowrap bg-paper';
		const td = 'h-(--row-h) px-4 whitespace-nowrap';
		expectRecipes(table, {
			wrap: 'overflow-auto border border-rule rounded-sm bg-surface max-h-[calc(100dvh-17rem)] min-h-40',
			wrapPlain: 'overflow-x-auto border border-rule rounded-sm bg-surface',
			table: 'w-full border-collapse text-(length:--cell-text)',
			thead: 'sticky top-0 z-10 bg-paper',
			headRow: 'border-b border-rule-strong',
			th: `${th} text-left`,
			thRight: `${th} text-right`,
			row: 'border-b border-rule last:border-0 hover:bg-stone-50 focus-within:bg-stone-50 focus:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
			td,
			tdNum: `${td} text-right font-mono tabular-nums`,
			stickyTh: `sticky left-0 z-20 ${th} text-left border-r border-rule`,
			stickyTd: `sticky left-0 z-[1] ${td} bg-surface border-r border-rule`,
			group:
				'h-(--group-h) px-4 bg-paper text-(length:--chip-text) font-medium text-ink-muted border-b border-rule text-left',
			meta: 'text-(length:--meta-text) text-ink-muted',
			chip: 'text-(length:--chip-text)',
		});
	});

	it('sections, counts strip, tabs (DESIGN.md §8.12) and menus (DESIGN.md §8.14)', () => {
		expect(classes(focusRing)).toEqual(classes(RING));
		expectRecipes(section, {
			heading: 'text-sm font-semibold text-ink pb-2 border-b border-rule',
			headingRow: 'flex items-center justify-between gap-4 pb-2 border-b border-rule',
			title: 'text-sm font-semibold text-ink',
		});
		expectRecipes(strip, {
			line: 'flex flex-wrap items-center gap-x-6 gap-y-1 text-ink-muted',
			item: `inline-flex items-center gap-1.5 h-6 border-b rounded-xs ${RING}`,
			on: 'border-accent text-ink',
			off: 'border-transparent hover:text-ink',
			figure: 'font-mono text-ink tabular-nums',
		});
		expectRecipes(tabs, {
			list: 'flex gap-4 border-b border-rule',
			tab: `h-9 px-1 text-sm border-b-2 -mb-px ${RING}`,
			on: 'text-ink font-medium border-accent',
			off: 'text-ink-muted hover:text-ink border-transparent',
			count: 'font-mono text-xs text-ink-muted ml-1',
		});
		expectRecipes(menu, {
			panel:
				'min-w-40 rounded-sm border border-rule-strong bg-surface py-1 shadow-md shadow-stone-900/10',
			item: 'flex w-full items-center gap-2 h-8 px-3 text-sm text-ink hover:bg-stone-50 pointer-coarse:h-11',
			danger:
				'flex w-full items-center gap-2 h-8 px-3 text-sm text-red-700 hover:bg-stone-50 pointer-coarse:h-11',
		});
	});
});
