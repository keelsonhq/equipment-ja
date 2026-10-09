<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { formatCount } from '#lib/format.ts';
	import { btn, input } from '#lib/ui.ts';
	import { PAGE_SIZES } from '#lib/urlquery.ts';

	// Paging bar under a table (DESIGN.md §8.3): "1–50 / 1,284" + unit, page size
	// (PAGE_SIZES: 50 / 100 / 200), previous / next.
	let {
		page,
		size,
		total,
		onpage,
		onsize,
	}: {
		page: number;
		size: number;
		total: number;
		onpage: (page: number) => void;
		onsize: (size: number) => void;
	} = $props();

	const first = $derived(total === 0 ? 0 : (page - 1) * size + 1);
	const last = $derived(Math.min(page * size, total));
	const lastPage = $derived(Math.max(1, Math.ceil(total / size)));
</script>

<div class="flex items-center justify-between gap-4 h-10 text-xs text-ink-muted">
	<span class="font-mono tabular-nums"
		>{formatCount(first)}–{formatCount(last)} / {formatCount(total)} 件</span
	>
	<div class="flex items-center gap-2">
		<label class="flex items-center gap-1.5">
			<span class="max-sm:sr-only">表示件数</span>
			<select
				data-testid="page-size"
				class={input.pageSize}
				value={size}
				onchange={(e) => onsize(Number(e.currentTarget.value))}
			>
				{#each PAGE_SIZES as choice (choice)}
					<option value={choice}>{choice}</option>
				{/each}
			</select>
		</label>
		<button type="button" class={btn.ghostSm} disabled={page <= 1} onclick={() => onpage(page - 1)}>
			<ChevronLeft class="size-4 stroke-[1.5]" />前へ
		</button>
		<button
			data-testid="page-next"
			type="button"
			class={btn.ghostSm}
			disabled={page >= lastPage}
			onclick={() => onpage(page + 1)}
		>
			次へ<ChevronRight class="size-4 stroke-[1.5]" />
		</button>
	</div>
</div>
