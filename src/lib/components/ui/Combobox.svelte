<script lang="ts" module>
	// How long typing must pause before the caller is asked to search.
	const SEARCH_DELAY_MS = 200;
	// How long the list stays open after the input loses focus.
	const CLOSE_DELAY_MS = 150;
</script>

<script lang="ts" generics="T extends { id: string | number }">
	import type { Snippet } from 'svelte';

	// Text input with a list of candidates (DESIGN.md §8.6): opening and closing,
	// the keys (↑ ↓ Enter Escape), the ARIA of a combobox and the look of the
	// list. It does not search: after typing pauses it calls `onsearch` with
	// the text, and the caller passes the candidates back as `items`. The
	// caller also draws each candidate (`option`) and says what the input
	// shows once one is chosen (`label`).
	let {
		id,
		items,
		selected = $bindable(null),
		label,
		option,
		empty,
		onsearch,
		onselect,
		invalid = false,
		placeholder,
		class: className,
		testid,
	}: {
		id: string;
		/** The candidates for the text searched last. */
		items: T[];
		selected?: T | null;
		/** The input's text once `item` is chosen. */
		label: (item: T) => string;
		/** One candidate's row. */
		option: Snippet<[T]>;
		/** The line shown when there is no candidate. */
		empty: string;
		/** Typing paused: search for this (trimmed) text. */
		onsearch: (query: string) => void;
		onselect?: (item: T) => void;
		invalid?: boolean;
		placeholder?: string;
		/** Classes of the input. */
		class: string;
		testid: string;
	} = $props();

	let query = $state('');
	let open = $state(false);
	// The highlighted candidate; back to the first whenever new candidates arrive.
	let active = $derived.by(() => {
		void items;
		return 0;
	});
	let timer: ReturnType<typeof setTimeout> | undefined;

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		query = e.currentTarget.value;
		selected = null;
		open = true;
		clearTimeout(timer);
		timer = setTimeout(() => onsearch(query.trim()), SEARCH_DELAY_MS);
	}

	function choose(item: T) {
		selected = item;
		query = label(item);
		open = false;
		onselect?.(item);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			open = true;
			active = Math.min(active + 1, items.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(active - 1, 0);
		} else if (e.key === 'Enter' && open && items[active]) {
			e.preventDefault();
			choose(items[active]);
		} else if (e.key === 'Escape' && open) {
			// Close the list only, not a dialog around it.
			e.stopPropagation();
			e.preventDefault();
			open = false;
		}
	}
</script>

<div class="relative">
	<input
		{id}
		data-testid={testid}
		type="text"
		role="combobox"
		autocomplete="off"
		aria-expanded={open}
		aria-controls="{id}-list"
		aria-invalid={invalid || undefined}
		class={className}
		{placeholder}
		value={selected ? label(selected) : query}
		{oninput}
		{onkeydown}
		onfocus={() => (open = true)}
		onclick={() => (open = true)}
		onblur={() => setTimeout(() => (open = false), CLOSE_DELAY_MS)}
	/>
	{#if open}
		<ul
			id="{id}-list"
			role="listbox"
			class="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-sm border border-rule-strong bg-surface shadow-md shadow-stone-900/10"
		>
			{#each items as item, i (item.id)}
				<li
					role="option"
					aria-selected={i === active}
					class="flex items-center gap-2 h-9 px-3 text-sm cursor-pointer hover:bg-stone-50 aria-selected:bg-accent-soft/60"
					onmousedown={(e) => {
						// Keep the focus in the input: choosing does not blur it.
						e.preventDefault();
						choose(item);
					}}
				>
					{@render option(item)}
				</li>
			{:else}
				<li class="h-9 px-3 flex items-center text-sm text-ink-muted">{empty}</li>
			{/each}
		</ul>
	{/if}
</div>
