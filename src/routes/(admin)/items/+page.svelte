<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ItemList, ItemStatus } from '#lib/server/domain/items.ts';
	import { withQuery } from '#lib/api.ts';
	import IssueDialog from '#lib/components/assignments/IssueDialog.svelte';
	import ItemFormDialog from '#lib/components/items/ItemFormDialog.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import ReturnDialog from '#lib/components/assignments/ReturnDialog.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { readPref, writePref } from '#lib/state/prefs.ts';
	import type { ItemRef } from '#lib/types.ts';
	import {
		returnTargetOfItem,
		type ReturnTarget,
	} from '#lib/components/assignments/returnTarget.ts';
	import { btn } from '#lib/ui.ts';
	import { commaSeparatedParam, listParams, updateQuery } from '#lib/urlstate.ts';
	import LedgerTable, { type ColumnKey, DEFAULT_COLUMNS } from './LedgerTable.svelte';
	import LedgerToolbar from './LedgerToolbar.svelte';

	// The ledger (DESIGN.md §9-A). This page owns the state: the URL query (filters,
	// sort, paging), the loaded page of rows, the selection, the visible columns
	// and the dialogs. LedgerToolbar and LedgerTable draw it and report back.

	let visible = $state<ColumnKey[]>(readPref('items.columns', DEFAULT_COLUMNS));
	let selected = $state<number[]>([]);

	let issueItem = $state<ItemRef | null>(null);
	let returnTarget = $state<ReturnTarget | null>(null);
	let creating = $state(false);

	const params = $derived(page.url.searchParams);
	const { sort, dir, page: pageNo, size } = $derived(listParams(params, { sort: 'tag' }));
	const statuses = $derived(commaSeparatedParam(params, 'status') as ItemStatus[]);
	const q = $derived(params.get('q') ?? '');
	const typeId = $derived(params.get('type') ?? '');
	const placeId = $derived(params.get('place') ?? '');
	const memberId = $derived(params.get('member') ?? '');

	// The server reads the same query (filters, sort, paging).
	const items = loader<ItemList>(() => `/api/items${page.url.search}`, { keepPreviousData: true });

	// A new query clears the selection.
	$effect(() => {
		void page.url.search;
		selected = [];
	});

	function setSort(key: string) {
		const nextDir = sort === key && dir === 'asc' ? 'desc' : 'asc';
		void updateQuery(page.url, { sort: key, dir: nextDir });
	}

	function setColumns(next: ColumnKey[]) {
		visible = next;
		writePref('items.columns', visible);
	}

	function exportHref(ids: number[] = []): string {
		if (ids.length > 0) {
			return withQuery('/api/items/export', { ids: ids.join(','), sort, dir });
		}
		const query = new URLSearchParams(page.url.searchParams.toString());
		query.delete('page');
		query.delete('size');
		const qs = query.toString();
		return `/api/items/export${qs ? `?${qs}` : ''}`;
	}

	const anyFilter = $derived(
		statuses.length > 0 || q !== '' || typeId !== '' || placeId !== '' || memberId !== '',
	);
</script>

<PageTitle title="台帳" />

<LedgerToolbar
	total={items.data?.total ?? null}
	counts={items.data?.counts ?? null}
	memberName={items.data?.memberName ?? null}
	{q}
	{statuses}
	{typeId}
	{placeId}
	{memberId}
	{anyFilter}
	{visible}
	exportHref={exportHref()}
	onquery={(changes) => updateQuery(page.url, changes)}
	oncolumns={setColumns}
	oncreate={() => (creating = true)}
/>

<div class="px-6 pt-3 max-md:px-4">
	{#if selected.length > 0}
		<div
			class="flex items-center gap-3 h-10 px-3 mb-2 rounded-sm border border-accent/30 bg-accent-soft/40 text-sm"
		>
			<span><span class="font-mono tabular-nums">{selected.length}</span> 件を選択</span>
			<a class={btn.secondarySm} href={exportHref(selected)} download>
				<Download class="size-3.5 stroke-[1.5]" />CSV 出力
			</a>
			<button type="button" class="{btn.ghostSm} ml-auto" onclick={() => (selected = [])}
				>選択解除</button
			>
		</div>
	{/if}

	<LedgerTable
		rows={items.data?.rows ?? null}
		loading={items.loading}
		error={items.error}
		{visible}
		{sort}
		{dir}
		{selected}
		{anyFilter}
		onsort={setSort}
		onselect={(ids) => (selected = ids)}
		onretry={items.reload}
		onissue={(item) => (issueItem = item)}
		onreturn={(item) => (returnTarget = returnTargetOfItem(item))}
		oncreate={() => (creating = true)}
	/>

	<Pagination
		page={pageNo}
		{size}
		total={items.data?.total ?? 0}
		onpage={(p) => updateQuery(page.url, { page: p }, { resetPage: false })}
		onsize={(s) => updateQuery(page.url, { size: s })}
	/>
</div>

{#if issueItem}
	<IssueDialog
		item={issueItem}
		onclose={() => (issueItem = null)}
		ondone={() => {
			issueItem = null;
			void items.reload();
		}}
		onconflict={items.reload}
	/>
{/if}
{#if returnTarget}
	<ReturnDialog
		target={returnTarget}
		onclose={() => (returnTarget = null)}
		ondone={() => {
			returnTarget = null;
			void items.reload();
		}}
	/>
{/if}
{#if creating}
	<ItemFormDialog
		onclose={() => (creating = false)}
		ondone={(item) => {
			creating = false;
			void goto(`/items/${item.id}`);
		}}
		onsaved={() => void items.reload()}
	/>
{/if}
