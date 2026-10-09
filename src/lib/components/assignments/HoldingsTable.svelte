<script lang="ts">
	import type { Holding } from '#lib/server/domain/people.ts';
	import { btn, table } from '#lib/ui.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import StatusChip from '#lib/components/items/StatusChip.svelte';

	// Two-tier table (DESIGN.md §9-C): one table, grouped into "held now" and
	// "pending return" (old items kept after an exchange until returned).
	let {
		holdings,
		linkItems = false,
		onreturn,
	}: {
		holdings: Holding[];
		linkItems?: boolean;
		onreturn: (h: Holding) => void;
	} = $props();

	const held = $derived(holdings.filter((h) => !h.pendingReturn));
	const pending = $derived(holdings.filter((h) => h.pendingReturn));
	// Header cells below: keep in step with the <th>s.
	const COLS = 7;
</script>

<!-- A group: its heading row with the count, then its rows. -->
{#snippet group(label: string, rows: Holding[])}
	<tr>
		<th colspan={COLS} scope="colgroup" class={table.group}>
			{label}
			<span class="font-mono tabular-nums">{rows.length}</span> 点
		</th>
	</tr>
	{#each rows as h (h.assignmentId)}
		<tr data-testid="holding-row" class={table.row}>
			<td class={table.stickyTd}><AssetTag tag={h.assetTag} /></td>
			<td class="{table.td} max-w-72 truncate font-medium">
				{#if linkItems}
					<a class="hover:underline underline-offset-2" href="/items/{h.itemId}">{h.itemName}</a>
				{:else}
					{h.itemName}
				{/if}
			</td>
			<td class={table.td}>{h.placeName ?? ''}</td>
			<td class="{table.td} font-mono tabular-nums">{h.issuedOn}</td>
			<td class="{table.td} max-md:hidden"
				><StatusChip status={h.status} reason={h.suspendedReason} /></td
			>
			<td class="{table.td} max-md:hidden"
				>{#if h.typeName}{h.typeName}{:else}<Empty />{/if}</td
			>
			<td class="{table.td} text-right">
				<button
					data-testid="holding-return"
					type="button"
					class={btn.ghostSm}
					onclick={() => onreturn(h)}>返却</button
				>
			</td>
		</tr>
	{:else}
		<!-- Only "held now" is drawn when it has no rows. -->
		<tr
			><td colspan={COLS} class="h-(--row-h) px-4 text-center text-sm text-ink-muted"
				>支給中の物品はありません。</td
			></tr
		>
	{/each}
{/snippet}

<div class={table.wrapPlain}>
	<table class={table.table}>
		<thead class={table.thead}>
			<tr class={table.headRow}>
				<th class="{table.stickyTh} w-[120px]">管理番号</th>
				<th class={table.th}>物品名</th>
				<th class={table.th}>使用場所</th>
				<th class={table.th}>支給日</th>
				<th class="{table.th} max-md:hidden">状態</th>
				<th class="{table.th} max-md:hidden">種類</th>
				<th class="{table.thRight} w-[72px]"><span class="sr-only">操作</span></th>
			</tr>
		</thead>
		<tbody>
			{@render group('支給中', held)}
			{#if pending.length > 0}
				{@render group('返却待ち', pending)}
			{/if}
		</tbody>
	</table>
</div>
