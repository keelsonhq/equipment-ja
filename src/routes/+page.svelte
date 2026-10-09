<script lang="ts">
	import FileUp from '@lucide/svelte/icons/file-up';
	import Plus from '@lucide/svelte/icons/plus';
	import { goto } from '$app/navigation';
	import type { HomeData } from '#lib/server/domain/home.ts';
	import type { ItemView } from '#lib/server/domain/items.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import EventsTable from '#lib/components/events/EventsTable.svelte';
	import IssueDialog from '#lib/components/assignments/IssueDialog.svelte';
	import ItemFormDialog from '#lib/components/items/ItemFormDialog.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import { rowLink } from '#lib/components/ui/rowLink.ts';
	import ReturnDialog from '#lib/components/assignments/ReturnDialog.svelte';
	import StatusChip, { REASON_LABELS } from '#lib/components/items/StatusChip.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import TypeName from '#lib/components/items/TypeName.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { formatCount } from '#lib/format.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import {
		returnTargetOfItem,
		type ReturnTarget,
	} from '#lib/components/assignments/returnTarget.ts';
	import { btn, section, table } from '#lib/ui.ts';

	// Admin home (DESIGN.md §9-L): the entry points for the daily jobs, per-type
	// stock ("can I issue a laptop now?"), what needs action, latest history.
	// Members are sent to their own page.

	let creating = $state(false);
	let issuing = $state(false);
	let issueTypeId = $state<number | null>(null);
	let returning = $state(false);
	let returnTarget = $state<ReturnTarget | null>(null);

	const me = $derived(session.me);

	$effect(() => {
		if (me && !me.isAdmin) {
			void goto('/me', { replace: true });
		}
	});

	const home = loader<HomeData>(() => (me?.isAdmin ? '/api/home' : null));
	const data = $derived(home.data);
	const error = $derived(home.error);

	function issueOfType(typeId: number | null) {
		issueTypeId = typeId;
		issuing = true;
	}

	function returnItem(item: ItemView) {
		const target = returnTargetOfItem(item);
		if (target) {
			returnTarget = target;
			returning = true;
		}
	}

	// The ledger filtered to one type (`none`: items without a type).
	function ledgerHref(typeId: number | null): string {
		return `/items?type=${typeId === null ? 'none' : typeId}`;
	}

	// Header cells of the two tables below: keep in step with their <th>.
	const STOCK_COLS = 7;
	const ATTENTION_COLS = 6;

	function done() {
		issuing = false;
		returning = false;
		returnTarget = null;
		void home.reload();
	}
</script>

<PageTitle title="ホーム" />

{#if me?.isAdmin}
	<PageHeader title="ホーム">
		{#snippet actions()}
			<a class={btn.secondary} href="/import"
				><FileUp class="size-4 stroke-[1.5]" />CSV で取り込む</a
			>
			<button
				data-testid="item-register"
				type="button"
				class={btn.primary}
				onclick={() => (creating = true)}
			>
				<Plus class="size-4 stroke-[1.5]" />物品を登録
			</button>
		{/snippet}
	</PageHeader>

	<!-- Flow bar: the two daily jobs that start from an item. -->
	<div class="flex flex-wrap gap-2 px-6 py-3 border-b border-rule max-md:px-4">
		<button type="button" class={btn.secondary} onclick={() => issueOfType(null)}>支給する</button>
		<button
			type="button"
			class={btn.secondary}
			onclick={() => {
				returnTarget = null;
				returning = true;
			}}>返却を記録</button
		>
	</div>

	<div class="px-6 py-4 space-y-8 max-md:px-4">
		<section data-testid="home-stock" class="space-y-3" aria-labelledby="stock-title">
			<h2 id="stock-title" class={section.heading}>種類別の在庫</h2>
			<div class={table.wrapPlain}>
				<table class={table.table}>
					<thead class={table.thead}>
						<tr class={table.headRow}>
							<th class="{table.stickyTh} min-w-40">種類</th>
							<th class="{table.thRight} w-[90px]">未割当</th>
							<th class="{table.thRight} w-[90px]">支給中</th>
							<th class="{table.thRight} w-[90px]">返却待ち</th>
							<th class="{table.thRight} w-[90px]">利用停止</th>
							<th class="{table.thRight} w-[90px]">合計</th>
							<th class="{table.thRight} w-[80px]"><span class="sr-only">操作</span></th>
						</tr>
					</thead>
					<tbody>
						{#if home.loading && !data}
							<TableState state="loading" cols={STOCK_COLS} />
						{:else if error}
							<TableState state="error" cols={STOCK_COLS} {error} onretry={home.reload} />
						{:else if data}
							{#each data.stock as row (row.typeId ?? 'none')}
								<tr
									data-testid="stock-row"
									class="{table.row} cursor-pointer"
									{@attach rowLink(ledgerHref(row.typeId))}
								>
									<td class="{table.stickyTd} {row.active ? 'text-ink' : 'text-ink-faint'}"
										><TypeName name={row.name} /></td
									>
									<td
										class="{table.tdNum} {row.unassigned > 0
											? 'text-ink font-medium'
											: 'text-ink-muted'}">{formatCount(row.unassigned)}</td
									>
									<td class={table.tdNum}>{formatCount(row.assigned)}</td>
									<td class={table.tdNum}
										>{#if row.pendingReturn > 0}{formatCount(row.pendingReturn)}{:else}<Empty
											/>{/if}</td
									>
									<td class={table.tdNum}
										>{#if row.suspended > 0}{formatCount(row.suspended)}{:else}<Empty />{/if}</td
									>
									<td class={table.tdNum}>{formatCount(row.total)}</td>
									<td class="{table.td} text-right">
										<button
											type="button"
											class={btn.ghostSm}
											disabled={row.unassigned === 0}
											onclick={() => issueOfType(row.typeId)}>支給</button
										>
									</td>
								</tr>
							{:else}
								<TableState state="empty" cols={STOCK_COLS}>
									{#snippet empty()}種類が登録されていません。マスタ管理で追加してください。{/snippet}
								</TableState>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</section>

		<section data-testid="home-attention" class="space-y-3" aria-labelledby="attention-title">
			<div class={section.headingRow}>
				<h2 id="attention-title" class={section.title}>
					要対応{#if data && data.attention.total > 0}<span
							class="ml-2 font-mono text-xs text-ink-muted tabular-nums"
							>{formatCount(data.attention.total)} 件</span
						>{/if}
				</h2>
				<a class={btn.ghostSm} href="/items?status=overdue,pending_return,suspended">台帳で見る</a>
			</div>
			<div class={table.wrapPlain}>
				<table class={table.table}>
					<thead class={table.thead}>
						<tr class={table.headRow}>
							<th class="{table.th} w-[130px]">状態</th>
							<th class="{table.stickyTh} w-[120px]">管理番号</th>
							<th class={table.th}>物品名</th>
							<th class="{table.th} max-md:hidden">支給先</th>
							<th class="{table.th} max-md:hidden">期限または理由</th>
							<th class="{table.thRight} w-[80px]"><span class="sr-only">操作</span></th>
						</tr>
					</thead>
					<tbody>
						{#if home.loading && !data}
							<TableState state="loading" cols={ATTENTION_COLS} />
						{:else if error}
							<TableState state="error" cols={ATTENTION_COLS} {error} onretry={home.reload} />
						{:else if data}
							{#each data.attention.rows as item (item.id)}
								<tr data-testid="attention-row" class={table.row}>
									<td class={table.td}
										><StatusChip status={item.status} reason={item.suspendedReason} /></td
									>
									<td class={table.stickyTd}><AssetTag tag={item.assetTag} /></td>
									<td class="{table.td} max-w-72 truncate font-medium">
										<a class="hover:underline underline-offset-2" href="/items/{item.id}"
											>{item.name}</a
										>
									</td>
									<td class="{table.td} max-md:hidden"
										>{#if item.holder}<Person
												name={item.holder.name}
												former={item.holder.membership === 'former'}
												imageUrl={item.holder.imageUrl}
											/>{:else}<Empty />{/if}</td
									>
									<td class="{table.td} max-md:hidden">
										{#if item.status === 'suspended'}
											<span class={table.meta}
												>{item.suspendedReason
													? REASON_LABELS[item.suspendedReason]
													: ''}{#if item.suspendedNote}{' / '}{item.suspendedNote}{/if}</span
											>
										{:else if item.dueOn}
											<span
												class="font-mono tabular-nums {item.status === 'overdue'
													? 'text-seal'
													: ''}">{item.dueOn}</span
											>
										{:else}<Empty />{/if}
									</td>
									<td class="{table.td} text-right">
										{#if item.holder}
											<button type="button" class={btn.ghostSm} onclick={() => returnItem(item)}
												>返却</button
											>
										{:else}
											<a class={btn.ghostSm} href="/items/{item.id}">詳細</a>
										{/if}
									</td>
								</tr>
							{:else}
								<TableState state="empty" cols={ATTENTION_COLS}>
									{#snippet empty()}対応が必要な物品はありません。{/snippet}
								</TableState>
							{/each}
						{/if}
					</tbody>
				</table>
			</div>
		</section>

		<section data-testid="home-recent" class="space-y-3" aria-labelledby="recent-title">
			<div class={section.headingRow}>
				<h2 id="recent-title" class={section.title}>最近の履歴</h2>
				<a class={btn.ghostSm} href="/history">履歴をすべて見る</a>
			</div>
			<EventsTable
				rows={data?.recent ?? null}
				loading={home.loading}
				{error}
				onretry={home.reload}
				plain
			/>
		</section>
	</div>

	{#if creating}
		<ItemFormDialog
			onclose={() => (creating = false)}
			ondone={() => {
				creating = false;
				void home.reload();
			}}
			onsaved={() => void home.reload()}
		/>
	{/if}
	{#if issuing}
		<IssueDialog
			typeId={issueTypeId}
			onclose={() => (issuing = false)}
			ondone={done}
			onconflict={home.reload}
		/>
	{/if}
	{#if returning}
		<ReturnDialog
			target={returnTarget}
			pick
			onclose={() => {
				returning = false;
				returnTarget = null;
			}}
			ondone={done}
		/>
	{/if}
{:else}
	<PageLoading />
{/if}
