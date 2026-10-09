<script lang="ts">
	import type { EventView } from '#lib/server/domain/events.ts';
	import { formatDateTime } from '#lib/format.ts';
	import { focusRing, table } from '#lib/ui.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import { ITEM_FIELD_LABELS } from '#lib/components/items/ItemFormDialog.svelte';
	import { REASON_LABELS } from '#lib/components/items/StatusChip.svelte';
	import EventKind from './EventKind.svelte';
	import { type DetailLabels, detailLines } from './eventDetail.ts';
	import TableState from '#lib/components/ui/TableState.svelte';

	const T = {
		fields: {
			// The item fields (an edit's before / after), then the other keys events hold.
			...ITEM_FIELD_LABELS,
			// An edit records the type by name, under this key (older edits were rewritten by migration 0003).
			type: ITEM_FIELD_LABELS.typeId,
			place: '使用場所',
			dueOn: '返却予定日',
			issuedOn: '支給日',
			returnedOn: '返却日',
			reason: '理由',
			fileName: 'ファイル',
			created: '登録',
			assigned: '支給',
			excluded: '除外',
			addedTypes: '追加した種類',
			addedPlaces: '追加した使用場所',
			failedFromLine: '中断した行',
			// A field removed from items keeps its name here: past edits still hold it (CUSTOMIZE.md §3).
		},
		reasons: REASON_LABELS,
		returnKinds: { returned: '本人が返却', collected: '管理者が回収' },
		exchange: '交換による支給',
		arrow: ' → ',
		separator: ': ',
		empty: '(なし)',
	} satisfies DetailLabels;

	// Operation history table (DESIGN.md §9-G). Click a row's detail to expand it.
	// A screen that reads the events itself passes `loading` / `error`; one
	// that already has them (an item's tab) passes only the rows.
	let {
		rows,
		showTarget = true,
		loading = false,
		error = null,
		onretry,
		plain = false,
	}: {
		/** null until the first load answers. */
		rows: EventView[] | null;
		showTarget?: boolean;
		loading?: boolean;
		error?: string | null;
		onretry?: () => void;
		/** A short list that does not scroll on its own (home screen, an item's tab). */
		plain?: boolean;
	} = $props();

	let expanded = $state<string | null>(null);
	// Header cells below: keep in step with the <th>s ("target" only with `showTarget`).
	const cols = $derived(showTarget ? 6 : 5);
</script>

<div class={plain ? table.wrapPlain : table.wrap}>
	<table class={table.table}>
		<thead class={table.thead}>
			<tr class={table.headRow}>
				<th class="{table.th} w-[140px]">日時</th>
				<th class="{table.th} w-[80px]">操作</th>
				{#if showTarget}<th class={table.th}>対象</th>{/if}
				<th class={table.th}>社員</th>
				<th class="{table.th} max-md:hidden">操作者</th>
				<th class="{table.th} max-md:hidden">備考・差分</th>
			</tr>
		</thead>
		<tbody>
			{#if loading && !rows}
				<TableState state="loading" {cols} />
			{:else if error}
				<TableState state="error" {cols} {error} {onretry} />
			{:else if rows}
				{#each rows as e (e.id)}
					{@const lines = detailLines(e.kind, e.detail, T)}
					<tr data-testid="event-row" class={table.row}>
						<td class="{table.td} font-mono {table.meta} tabular-nums">{formatDateTime(e.at)}</td>
						<td class={table.td}><EventKind kind={e.kind} /></td>
						{#if showTarget}
							<td class="{table.td} max-w-72">
								{#if e.itemTag}
									<span class="inline-flex items-center gap-2 min-w-0 max-w-full">
										<AssetTag tag={e.itemTag} />
										{#if e.itemId}
											<a
												class="truncate hover:underline underline-offset-2"
												href="/items/{e.itemId}">{e.itemName}</a
											>
										{:else}
											<span class="truncate">{e.itemName}</span>
										{/if}
									</span>
								{:else}<Empty />{/if}
							</td>
						{/if}
						<td class="{table.td} max-w-48 truncate"
							>{#if e.subjectName}{e.subjectName}{:else}<Empty />{/if}</td
						>
						<td class="{table.td} {table.meta} max-md:hidden">{e.actorName}</td>
						<td class="{table.td} max-w-80 max-md:hidden">
							{#if lines.length > 0}
								<button
									type="button"
									class="block w-full truncate text-left text-(length:--meta-text) text-ink-muted hover:text-ink {focusRing} rounded-xs"
									aria-expanded={expanded === e.id}
									onclick={() => (expanded = expanded === e.id ? null : e.id)}
									>{lines.join(' / ')}</button
								>
							{:else}<Empty />{/if}
						</td>
					</tr>
					{#if expanded === e.id}
						<tr class="border-b border-rule bg-paper">
							<td colspan={cols} class="px-4 py-2">
								<ul class="space-y-0.5 text-(length:--meta-text) text-ink">
									{#each lines as line, i (i)}<li class="whitespace-pre-wrap">{line}</li>{/each}
								</ul>
							</td>
						</tr>
					{/if}
				{:else}
					<TableState state="empty" {cols}>
						{#snippet empty()}該当する操作はありません。{/snippet}
					</TableState>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
