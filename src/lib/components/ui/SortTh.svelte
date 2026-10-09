<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import type { Snippet } from 'svelte';
	import { focusRing, table } from '#lib/ui.ts';

	// Sortable column header (DESIGN.md §8.3): the header is a button; the active
	// column shows ink text and a 12px arrow, other columns show no icon.
	let {
		key,
		sort,
		dir,
		onsort,
		align = 'left',
		extra = '',
		children,
	}: {
		key: string;
		sort: string;
		dir: 'asc' | 'desc';
		onsort: (key: string) => void;
		align?: 'left' | 'right';
		extra?: string;
		children: Snippet;
	} = $props();

	const active = $derived(sort === key);
</script>

<th
	data-testid="sort-{key}"
	class="{align === 'right' ? table.thRight : table.th} {extra}"
	aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
>
	<button
		type="button"
		class="inline-flex items-center gap-1 rounded-xs hover:text-ink {focusRing} {active
			? 'text-ink'
			: ''} {align === 'right' ? 'flex-row-reverse' : ''}"
		onclick={() => onsort(key)}
	>
		{@render children()}
		{#if active}
			{#if dir === 'asc'}
				<ArrowUp class="size-3 stroke-[1.5]" />
			{:else}
				<ArrowDown class="size-3 stroke-[1.5]" />
			{/if}
		{/if}
	</button>
</th>
