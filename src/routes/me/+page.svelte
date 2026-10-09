<script lang="ts">
	import { page } from '$app/state';
	import type { AvailableItemList } from '#lib/server/domain/items.ts';
	import type { Holding, PersonPage } from '#lib/server/domain/people.ts';
	import { withQuery } from '#lib/api.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import AssignmentLedger from '#lib/components/assignments/AssignmentLedger.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import HoldingsTable from '#lib/components/assignments/HoldingsTable.svelte';
	import IssueDialog from '#lib/components/assignments/IssueDialog.svelte';
	import NameCard from '#lib/components/people/NameCard.svelte';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import ReturnDialog from '#lib/components/assignments/ReturnDialog.svelte';
	import SearchInput from '#lib/components/ui/SearchInput.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { masters } from '#lib/state/masters.svelte.ts';
	import type { ItemRef } from '#lib/types.ts';
	import {
		returnTargetOfHolding,
		type ReturnTarget,
	} from '#lib/components/assignments/returnTarget.ts';
	import { btn, input, section, table } from '#lib/ui.ts';
	import { listParams, updateQuery } from '#lib/urlstate.ts';

	// My page (DESIGN.md §9-D): every user's home. What I hold, items I can take,
	// and my history. Nothing about other people is shown here.
	let tab = $state<'available' | 'history'>('available');
	let claim = $state<ItemRef | null>(null);
	let returnTarget = $state<ReturnTarget | null>(null);
	let stampId = $state<string | null>(null);

	const params = $derived(page.url.searchParams);
	const q = $derived(params.get('q') ?? '');
	const typeId = $derived(params.get('type') ?? '');
	const { page: pageNo, size } = $derived(listParams(params));
	// Header cells of the available items below: keep in step with the <th>s.
	const COLS = 5;

	const myPage = loader<PersonPage>(() => '/api/me/page');
	const mine = $derived(myPage.data);
	const available = loader<AvailableItemList>(
		() => withQuery('/api/available-items', { q, type: typeId, page: pageNo, size }),
		{ keepPreviousData: true },
	);

	function openReturn(h: Holding) {
		if (!mine) return;
		returnTarget = returnTargetOfHolding(h, mine.person.name);
	}

	const held = $derived(mine?.holdings.filter((h) => !h.pendingReturn).length ?? 0);
	const pending = $derived(mine?.holdings.filter((h) => h.pendingReturn).length ?? 0);
</script>

<PageTitle title="自分のページ" />

{#if myPage.error}
	<ErrorBox code={myPage.error} onretry={myPage.reload} />
{:else if !mine}
	<PageLoading />
{:else}
	<NameCard
		name={mine.person.name}
		email={mine.person.email}
		imageUrl={mine.person.imageUrl}
		assigned={held}
		{pending}
	/>

	<div class="px-6 py-4 space-y-6 max-md:px-4">
		<section class="space-y-3">
			<h2 class={section.heading}>自分の支給品</h2>
			<HoldingsTable holdings={mine.holdings} onreturn={openReturn} />
		</section>

		<section>
			<Tabs
				testid="me-tab"
				tabs={[
					{ key: 'available', label: '利用可能な物品', count: available.data?.total },
					{ key: 'history', label: '履歴', count: mine.ledger.length },
				]}
				bind:selected={tab}
			>
				{#if tab === 'available'}
					<div class="flex flex-wrap items-center gap-2 pb-3">
						<SearchInput
							value={q}
							label="利用可能な物品を検索"
							placeholder="管理番号・物品名・種類"
							onsearch={(value) => updateQuery(page.url, { q: value || null })}
						/>
						<label>
							<span class="sr-only">種類</span>
							<select
								class={input.filterSelect}
								value={typeId}
								onchange={(e) => updateQuery(page.url, { type: e.currentTarget.value || null })}
							>
								<option value="">種類: すべて</option>
								{#each masters.types as t (t.id)}<option value={String(t.id)}>{t.name}</option
									>{/each}
							</select>
						</label>
					</div>
					<div class={table.wrap}>
						<table class={table.table}>
							<thead class={table.thead}>
								<tr class={table.headRow}>
									<th class="{table.stickyTh} w-[120px]">管理番号</th>
									<th class={table.th}>物品名</th>
									<th class="{table.th} max-md:hidden">種類</th>
									<th class="{table.th} max-md:hidden">保管場所</th>
									<th class="{table.thRight} w-[140px]"><span class="sr-only">操作</span></th>
								</tr>
							</thead>
							<tbody>
								{#if available.loading && !available.data}
									<TableState state="loading" cols={COLS} />
								{:else if available.error}
									<TableState
										state="error"
										cols={COLS}
										error={available.error}
										onretry={available.reload}
									/>
								{:else if available.data}
									{#each available.data.rows as item (item.id)}
										<tr data-testid="available-row" class={table.row}>
											<td class={table.stickyTd}><AssetTag tag={item.assetTag} /></td>
											<td class="{table.td} max-w-72 truncate font-medium">{item.name}</td>
											<td class="{table.td} max-md:hidden"
												>{#if item.typeName}{item.typeName}{:else}<Empty />{/if}</td
											>
											<td class="{table.td} text-ink-muted max-md:hidden"
												>{#if item.storageLocation}{item.storageLocation}{:else}<Empty />{/if}</td
											>
											<td class="{table.td} text-right">
												<button
													data-testid="claim-item"
													type="button"
													class={btn.ghostSm}
													onclick={() => (claim = item)}>自分に割り当てる</button
												>
											</td>
										</tr>
									{:else}
										<TableState state="empty" cols={COLS}>
											{#snippet empty()}利用できる物品はありません。{/snippet}
										</TableState>
									{/each}
								{/if}
							</tbody>
						</table>
					</div>
					<Pagination
						page={pageNo}
						{size}
						total={available.data?.total ?? 0}
						onpage={(p) => updateQuery(page.url, { page: p }, { resetPage: false })}
						onsize={(s) => updateQuery(page.url, { size: s })}
					/>
				{:else}
					<AssignmentLedger rows={mine.ledger} variant="person" {stampId} />
				{/if}
			</Tabs>
		</section>
	</div>

	{#if claim}
		<IssueDialog
			item={claim}
			recipient="self"
			onclose={() => (claim = null)}
			ondone={() => {
				claim = null;
				void myPage.reload();
				void available.reload();
			}}
			onconflict={available.reload}
		/>
	{/if}
	{#if returnTarget}
		<ReturnDialog
			target={returnTarget}
			onclose={() => (returnTarget = null)}
			ondone={(a) => {
				returnTarget = null;
				stampId = a.id;
				tab = 'history';
				void myPage.reload();
				void available.reload();
			}}
		/>
	{/if}
{/if}
