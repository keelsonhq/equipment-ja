<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatCount } from '#lib/format.ts';

	// Page header (DESIGN.md §8.2): left-aligned H1 + total count, actions right.
	let {
		title,
		count = null,
		actions,
	}: { title: string; count?: number | null; actions?: Snippet } = $props();
</script>

<header
	class="flex items-center justify-between gap-4 min-h-14 px-6 py-2 border-b border-rule max-md:px-4"
>
	<div class="flex items-baseline gap-3 min-w-0">
		<h1 class="text-xl font-semibold tracking-tight text-ink truncate">{title}</h1>
		{#if count !== null}
			<span class="font-mono text-xs text-ink-muted tabular-nums whitespace-nowrap"
				>{formatCount(count)} 件</span
			>
		{/if}
	</div>
	{#if actions}
		<div class="flex items-center gap-2 shrink-0">{@render actions()}</div>
	{/if}
</header>
