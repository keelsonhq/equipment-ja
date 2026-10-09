// Component class recipes from DESIGN.md §8, in one place so every screen uses
// the same buttons, inputs, tables, tabs and menus. Tailwind picks these
// strings up from this file. Each recipe is built from the shared parts below
// it (tests/ui.test.ts pins the classes each recipe ends up with).

/**
 * Keyboard focus ring (DESIGN.md §4) for controls that draw no box of their own:
 * ghost buttons, tabs, the figures of a counts strip, links in a list.
 */
export const focusRing =
	'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

// The same ring set off from a filled or bordered button by a gap of paper.
const RING_GAP = 'focus-visible:ring-offset-2 focus-visible:ring-offset-paper';

// --- Buttons (DESIGN.md §8.5) ---------------------------------------------------

// Every button: content in a row, colour changes ease in, 44px tall on touch
// screens (DESIGN.md §4). Buttons with a text label do not wrap it.
const BUTTON = 'inline-flex items-center transition-colors duration-150 pointer-coarse:h-11';
const LABELLED = `${BUTTON} whitespace-nowrap`;

// The regular size and the small one (table rows, the bulk bar).
const REGULAR = 'gap-1.5 h-9 px-3 text-sm';
const SMALL = 'gap-1 h-7 px-2 text-xs';

const PRIMARY = `rounded-sm bg-accent font-medium text-white hover:bg-accent-strong ${focusRing} ${RING_GAP} disabled:bg-stone-300 disabled:cursor-not-allowed`;
const SECONDARY = `rounded-sm border border-rule-strong bg-surface font-medium text-ink hover:bg-stone-50 hover:border-stone-400 ${focusRing} ${RING_GAP} disabled:text-ink-faint disabled:cursor-not-allowed`;
const DANGER = `rounded-sm border border-red-300 bg-surface font-medium text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${RING_GAP} disabled:text-ink-faint disabled:cursor-not-allowed`;
const GHOST = `rounded-xs text-ink-muted hover:bg-stone-200/60 hover:text-ink ${focusRing}`;

export const btn = {
	primary: `${LABELLED} ${REGULAR} ${PRIMARY}`,
	secondary: `${LABELLED} ${REGULAR} ${SECONDARY}`,
	ghost: `${LABELLED} gap-1.5 h-8 px-2 text-sm ${GHOST} disabled:text-ink-faint disabled:hover:bg-transparent disabled:cursor-not-allowed`,
	danger: `${LABELLED} ${REGULAR} ${DANGER}`,
	/** Small variants for table rows and the bulk bar (h-7 px-2 text-xs). */
	primarySm: `${LABELLED} ${SMALL} ${PRIMARY}`,
	secondarySm: `${LABELLED} ${SMALL} ${SECONDARY}`,
	/** Icon-only ghost button (close, menu). */
	ghostIcon: `${BUTTON} justify-center h-8 px-1.5 text-sm ${GHOST}`,
	ghostSm: `${LABELLED} ${SMALL} ${GHOST} disabled:text-ink-faint disabled:cursor-not-allowed`,
};

// --- Inputs (DESIGN.md §8.6) ----------------------------------------------------

// Every text box and select: the box, the focus ring inside the border, and
// (where the field can be) disabled and invalid states.
const FIELD = 'rounded-xs border border-rule-strong bg-surface text-ink';
const FIELD_FOCUS = 'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';
const FIELD_DISABLED = 'disabled:bg-stone-100 disabled:text-ink-faint';
const FIELD_INVALID = 'aria-invalid:border-red-500 aria-invalid:ring-red-500/20';
const PLACEHOLDER = 'placeholder:text-ink-faint';

// Selects draw their own arrow (`select-chevron`, src/app.css).
export const input = {
	text: `block w-full h-9 px-3 text-sm ${FIELD} ${PLACEHOLDER} ${FIELD_FOCUS} ${FIELD_DISABLED} ${FIELD_INVALID}`,
	select: `select-chevron block w-full h-9 pl-3 pr-8 text-sm ${FIELD} ${FIELD_FOCUS} ${FIELD_DISABLED} ${FIELD_INVALID}`,
	textarea: `block w-full min-h-20 py-2 leading-6 px-3 text-sm ${FIELD} ${PLACEHOLDER} ${FIELD_FOCUS} ${FIELD_INVALID}`,
	/** Filter-bar search box (h-8, room for the 16px icon on the left). */
	search: `block w-full h-8 pl-8 pr-3 text-sm ${FIELD} ${PLACEHOLDER} ${FIELD_FOCUS}`,
	/** Compact text input for filter bars. */
	textSm: `block h-8 px-2 text-xs ${FIELD} ${PLACEHOLDER} ${FIELD_FOCUS} ${FIELD_INVALID}`,
	/** Compact controls in filter bars (h-8 text-xs). */
	filterSelect: `select-chevron h-8 pl-2 pr-7 text-xs ${FIELD} ${FIELD_FOCUS}`,
	/** Page-size select under a table (DESIGN.md §8.3: h-7 text-xs, the figures in mono). */
	pageSize: `select-chevron h-7 pl-2 pr-7 text-xs font-mono tabular-nums ${FIELD} ${FIELD_FOCUS}`,
	checkbox: 'size-4 align-middle rounded-xs border-rule-strong accent-accent',
	radio: 'size-4 align-middle rounded-full border-rule-strong accent-accent',
	label: 'block text-xs font-medium text-ink-muted mb-1',
	help: 'mt-1 text-xs text-ink-faint',
	error: 'mt-1 text-xs text-red-700',
};

// --- Tables (DESIGN.md §8.3) ----------------------------------------------------

// Sizes come from the density tokens in src/app.css (--row-h, --cell-text,
// ...), so the density toggle changes every table at once.
const TH =
	'h-(--head-h) px-4 text-(length:--head-text) font-medium text-ink-muted whitespace-nowrap bg-paper';
const TD = 'h-(--row-h) px-4 whitespace-nowrap';
// The first data column stays at the left edge, over a background of its own.
const PINNED = 'sticky left-0 border-r border-rule';

export const table = {
	wrap: 'overflow-auto border border-rule rounded-sm bg-surface max-h-[calc(100dvh-17rem)] min-h-40',
	/** Wrapper for short tables that should not scroll on their own. */
	wrapPlain: 'overflow-x-auto border border-rule rounded-sm bg-surface',
	table: 'w-full border-collapse text-(length:--cell-text)',
	thead: 'sticky top-0 z-10 bg-paper',
	headRow: 'border-b border-rule-strong',
	th: `${TH} text-left`,
	thRight: `${TH} text-right`,
	row: 'border-b border-rule last:border-0 hover:bg-stone-50 focus-within:bg-stone-50 focus:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
	td: TD,
	/** A cell of figures (counts, periods, line numbers): right-aligned, mono. */
	tdNum: `${TD} text-right font-mono tabular-nums`,
	/** First data column, pinned to the left edge. */
	stickyTh: `${PINNED} z-20 ${TH} text-left`,
	stickyTd: `${PINNED} z-[1] ${TD} bg-surface`,
	group:
		'h-(--group-h) px-4 bg-paper text-(length:--chip-text) font-medium text-ink-muted border-b border-rule text-left',
	/** Supplementary text in a cell (dates of last update, emails, operators). */
	meta: 'text-(length:--meta-text) text-ink-muted',
	/** Text of a status chip / asset tag / small seal. */
	chip: 'text-(length:--chip-text)',
};

// --- Sections, counts, tabs, menus -------------------------------------------

const SECTION_TITLE = 'text-sm font-semibold text-ink';
const SECTION_RULE = 'pb-2 border-b border-rule';

/** The heading of a section in a page: a small bold title over a rule. */
export const section = {
	heading: `${SECTION_TITLE} ${SECTION_RULE}`,
	/** A heading with a link on its right: the rule goes on the row, `title` on the h2. */
	headingRow: `flex items-center justify-between gap-4 ${SECTION_RULE}`,
	title: SECTION_TITLE,
};

/**
 * Counts strip (DESIGN.md §8.2): figures in one line, each one a filter. The text
 * size is the caller's: `text-xs` for a strip, `text-sm` in running text.
 */
export const strip = {
	line: 'flex flex-wrap items-center gap-x-6 gap-y-1 text-ink-muted',
	/** One figure as a button; add `on` when its filter is applied, else `off`. */
	item: `inline-flex items-center gap-1.5 h-6 border-b rounded-xs ${focusRing}`,
	on: 'border-accent text-ink',
	off: 'border-transparent hover:text-ink',
	figure: 'font-mono text-ink tabular-nums',
};

/** Tabs (DESIGN.md §8.12). `ui/Tabs.svelte` puts them together. */
export const tabs = {
	list: 'flex gap-4 border-b border-rule',
	/** One tab; add `on` for the selected one, else `off`. */
	tab: `h-9 px-1 text-sm border-b-2 -mb-px ${focusRing}`,
	on: 'text-ink font-medium border-accent',
	off: 'text-ink-muted hover:text-ink border-transparent',
	count: 'font-mono text-xs text-ink-muted ml-1',
};

// A menu item: a link, a button or a checklist label (checkbox first), 44px on
// touch screens like the buttons.
const MENU_ITEM =
	'flex w-full items-center gap-2 h-8 px-3 text-sm hover:bg-stone-50 pointer-coarse:h-11';

/** Menu / dropdown (DESIGN.md §8.14). `ui/Menu.svelte` opens and closes it. */
export const menu = {
	panel:
		'min-w-40 rounded-sm border border-rule-strong bg-surface py-1 shadow-md shadow-stone-900/10',
	item: `${MENU_ITEM} text-ink`,
	/** An action that is hard to undo. */
	danger: `${MENU_ITEM} text-red-700`,
};
