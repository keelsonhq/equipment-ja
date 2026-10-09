<script lang="ts">
	import type { Snippet } from 'svelte';
	import { messageFor } from '#lib/messages.ts';
	import { btn } from '#lib/ui.ts';

	// Loading / error / empty states drawn inside the table (DESIGN.md §8.3), never
	// as illustrations outside it.
	let {
		state,
		cols,
		error = null,
		onretry,
		empty,
	}: {
		state: 'loading' | 'error' | 'empty';
		cols: number;
		error?: string | null;
		onretry?: () => void;
		empty?: Snippet;
	} = $props();
</script>

{#if state === 'loading'}
	{#each Array.from({ length: 8 }, (_, i) => i) as i (i)}
		<tr class="border-b border-rule last:border-0" aria-hidden="true">
			{#each Array.from({ length: cols }, (_, j) => j) as j (j)}
				<td class="h-(--row-h) px-4"
					><div class="h-3 w-[60%] rounded-xs bg-stone-200/80 animate-pulse"></div></td
				>
			{/each}
		</tr>
	{/each}
{:else if state === 'error'}
	<tr>
		<td colspan={cols} class="h-24 px-4 text-center">
			<p class="text-sm text-red-800">{messageFor(error ?? 'internal_error').title}</p>
			{#if onretry}
				<button type="button" class="{btn.ghost} mt-2" onclick={onretry}>再読み込み</button>
			{/if}
		</td>
	</tr>
{:else}
	<tr>
		<td colspan={cols} class="h-24 px-4 text-center text-sm text-ink-muted">
			{#if empty}{@render empty()}{:else}該当するデータはありません。{/if}
		</td>
	</tr>
{/if}
