<script module lang="ts">
	import { ITEM_FIELD_LABELS as F } from '#lib/components/items/ItemFormDialog.svelte';

	const T = {
		columns: {
			name: F.name,
			status: '状態',
			holder: '支給先',
			type: F.typeId,
			issued: '支給日',
			place: '使用場所',
			serial: F.serialNo,
			updated: '更新',
		},
	};

	export type ColumnKey = keyof typeof T.columns;

	/** Column names; the column menu in LedgerToolbar lists them too. */
	export const COLUMN_LABELS = T.columns;

	// Column priorities (DESIGN.md §9-A): 1-2 shown by default; on narrow screens
	// only priority 1 stays visible and the table scrolls sideways.
	export const COLUMNS: { key: ColumnKey; priority: number; sort?: string; width?: string }[] = [
		{ key: 'name', priority: 1, sort: 'name', width: 'min-w-[200px]' },
		{ key: 'status', priority: 1, width: 'w-[110px]' },
		{ key: 'holder', priority: 1, sort: 'holder', width: 'w-[160px]' },
		{ key: 'type', priority: 2, sort: 'type', width: 'w-[100px]' },
		{ key: 'issued', priority: 2, sort: 'issued', width: 'w-[110px]' },
		{ key: 'place', priority: 3, sort: 'place', width: 'w-[90px]' },
		{ key: 'serial', priority: 3, sort: 'serial', width: 'w-[140px]' },
		{ key: 'updated', priority: 4, sort: 'updated', width: 'w-[130px]' },
	];
	export const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.priority <= 2).map((c) => c.key);
</script>

<script lang="ts">
	import type { ItemView } from '#lib/server/domain/items.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import { rowLink } from '#lib/components/ui/rowLink.ts';
	import SortTh from '#lib/components/ui/SortTh.svelte';
	import StatusChip from '#lib/components/items/StatusChip.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import { formatDateTime } from '#lib/format.ts';
	import { btn, input, table } from '#lib/ui.ts';

	// The ledger table (DESIGN.md §9-A): sortable headers, a selection column, the
	// row actions and the loading / error / empty states. The page owns the
	// rows, the sort and the selection; this reports clicks back.
	let {
		rows,
		loading,
		error,
		visible,
		sort,
		dir,
		selected,
		anyFilter,
		onsort,
		onselect,
		onretry,
		onissue,
		onreturn,
		oncreate,
	}: {
		/** null until the first load answers. */
		rows: ItemView[] | null;
		loading: boolean;
		error: string | null;
		visible: ColumnKey[];
		sort: string;
		dir: 'asc' | 'desc';
		selected: number[];
		anyFilter: boolean;
		onsort: (key: string) => void;
		onselect: (ids: number[]) => void;
		onretry: () => void;
		onissue: (item: ItemView) => void;
		onreturn: (item: ItemView) => void;
		oncreate: () => void;
	} = $props();

	// The columns shown, in table order, each with the class that hides it on
	// narrow screens (only priority 1 stays there; DESIGN.md §9-A).
	const columns = $derived(
		COLUMNS.filter((c) => visible.includes(c.key)).map((c) => ({
			...c,
			narrow: c.priority > 1 ? 'max-md:hidden' : '',
		})),
	);
	// Header cells: selection + asset tag + the columns shown + row actions.
	const cols = $derived(1 + 1 + columns.length + 1);
	const allSelected = $derived(
		(rows?.length ?? 0) > 0 && (rows?.every((r) => selected.includes(r.id)) ?? false),
	);

	function toggleRow(id: number) {
		onselect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
	}

	function toggleAll() {
		const ids = rows?.map((r) => r.id) ?? [];
		onselect(ids.every((id) => selected.includes(id)) ? [] : ids);
	}

	// Space on the focused row selects it (Enter and a click open the item: rowLink).
	function rowKeydown(e: KeyboardEvent, item: ItemView) {
		if (e.key === ' ' && e.target === e.currentTarget) {
			e.preventDefault();
			toggleRow(item.id);
		}
	}
</script>

<div class={table.wrap}>
	<table class={table.table}>
		<thead class={table.thead}>
			<tr class={table.headRow}>
				<th class="sticky left-0 z-20 h-(--head-h) w-12 min-w-12 px-4 bg-paper">
					<input
						type="checkbox"
						class={input.checkbox}
						aria-label="このページをすべて選択"
						checked={allSelected}
						onchange={toggleAll}
					/>
				</th>
				<SortTh
					key="tag"
					{sort}
					{dir}
					{onsort}
					extra="sticky left-12 z-20 w-[120px] border-r border-rule">{F.assetTag}</SortTh
				>
				{#each columns as c (c.key)}
					{#if c.sort}
						<SortTh key={c.sort} {sort} {dir} {onsort} extra="{c.width ?? ''} {c.narrow}"
							>{T.columns[c.key]}</SortTh
						>
					{:else}
						<th class="{table.th} {c.width ?? ''} {c.narrow}">{T.columns[c.key]}</th>
					{/if}
				{/each}
				<th class="{table.thRight} w-[72px] max-md:hidden"><span class="sr-only">操作</span></th>
			</tr>
		</thead>
		<tbody>
			{#if loading && !rows}
				<TableState state="loading" {cols} />
			{:else if error}
				<TableState state="error" {cols} {error} {onretry} />
			{:else if rows}
				{#each rows as item (item.id)}
					{@const isSelected = selected.includes(item.id)}
					<tr
						data-testid="item-row"
						class="{table.row} cursor-pointer {isSelected ? 'bg-accent-soft/60' : ''}"
						{@attach rowLink(`/items/${item.id}`)}
						onkeydown={(e) => rowKeydown(e, item)}
						aria-selected={isSelected}
					>
						<td
							class="sticky left-0 z-[1] h-(--row-h) w-12 min-w-12 px-4 {isSelected
								? 'bg-accent-soft'
								: 'bg-surface'}"
						>
							<input
								type="checkbox"
								class={input.checkbox}
								aria-label="{item.assetTag} を選択"
								checked={isSelected}
								onchange={() => toggleRow(item.id)}
								tabindex="-1"
							/>
						</td>
						<td
							class="sticky left-12 z-[1] h-(--row-h) px-4 whitespace-nowrap border-r border-rule {isSelected
								? 'bg-accent-soft'
								: 'bg-surface'}"
						>
							<AssetTag tag={item.assetTag} />
						</td>
						{#each columns as c (c.key)}
							<td
								class="{table.td} {c.narrow} {c.key === 'name'
									? 'max-w-72 truncate font-medium text-ink'
									: ''}"
							>
								{#if c.key === 'name'}
									{item.name}
								{:else if c.key === 'status'}
									<StatusChip status={item.status} reason={item.suspendedReason} />
								{:else if c.key === 'holder'}
									{#if item.holder}<Person
											name={item.holder.name}
											former={item.holder.membership === 'former'}
											imageUrl={item.holder.imageUrl}
										/>{:else}<Empty />{/if}
								{:else if c.key === 'type'}
									{#if item.typeName}{item.typeName}{:else}<Empty />{/if}
								{:else if c.key === 'issued'}
									<span class="font-mono tabular-nums"
										>{#if item.issuedOn}{item.issuedOn}{:else}<Empty />{/if}</span
									>
								{:else if c.key === 'place'}
									{#if item.placeName}
										<span class="text-ink-muted">{item.placeName}</span>
									{:else if item.storageLocation}
										<span class="text-ink-muted">{item.storageLocation}</span>
									{:else}<Empty />{/if}
								{:else if c.key === 'serial'}
									<span class="font-mono text-ink-muted"
										>{#if item.serialNo}{item.serialNo}{:else}<Empty />{/if}</span
									>
								{:else if c.key === 'updated'}
									<span class="font-mono {table.meta} tabular-nums"
										>{formatDateTime(item.updatedAt)}</span
									>
								{/if}
							</td>
						{/each}
						<td class="{table.td} text-right max-md:hidden">
							{#if item.status === 'unassigned'}
								<button type="button" class={btn.ghostSm} onclick={() => onissue(item)}>支給</button
								>
							{:else if item.holder && item.status !== 'suspended'}
								<button
									data-testid="row-return"
									type="button"
									class={btn.ghostSm}
									onclick={() => onreturn(item)}>返却</button
								>
							{/if}
						</td>
					</tr>
				{:else}
					<TableState state="empty" {cols}>
						{#snippet empty()}
							該当する物品はありません。
							{#if !anyFilter}
								<div class="mt-2">
									<button type="button" class={btn.secondary} onclick={oncreate}>物品を登録</button>
								</div>
							{/if}
						{/snippet}
					</TableState>
				{/each}
			{/if}
		</tbody>
	</table>
</div>
