<script lang="ts">
	import type { AssignmentView } from '#lib/server/domain/assignments.ts';
	import { daysBetween, formatCount } from '#lib/format.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { btn, table } from '#lib/ui.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import Seal from '#lib/components/ui/Seal.svelte';
	import StatusChip from '#lib/components/items/StatusChip.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';

	const T = {
		seals: { returned: '返却済', collected: '回収済' },
	};

	// Assignment ledger (DESIGN.md §9-F): one row per hand-over, issue and return
	// dates side by side. Names are the snapshot taken when the item was issued,
	// so the history survives people leaving the workspace.
	let {
		rows,
		variant,
		stampId = null,
		oncorrect,
	}: {
		rows: AssignmentView[];
		variant: 'item' | 'person';
		stampId?: string | null;
		oncorrect?: (a: AssignmentView) => void;
	} = $props();

	const today = $derived(session.me?.today ?? '');
	// Header cells below: keep in step with the <th>s (the last one only with `oncorrect`).
	const cols = $derived(oncorrect ? 8 : 7);
</script>

<div class={table.wrapPlain}>
	<table class={table.table}>
		<thead class={table.thead}>
			<tr class={table.headRow}>
				<th class={table.th}>支給日</th>
				<th class={table.th}>返却日</th>
				<th class={table.th}>{variant === 'item' ? '社員' : '物品'}</th>
				<th class="{table.th} max-md:hidden">使用場所</th>
				<th class="{table.thRight} max-md:hidden">期間</th>
				<th class="{table.th} max-md:hidden">操作者</th>
				<th class={table.thRight}>印</th>
				{#if oncorrect}<th class="{table.th} w-[72px]"><span class="sr-only">操作</span></th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each rows as a (a.id)}
				<tr data-testid="ledger-row" class="{table.row} {a.returnedOn ? '' : 'bg-accent-soft/30'}">
					<td class="{table.td} font-mono tabular-nums">{a.issuedOn}</td>
					<td data-testid="ledger-returned-on" class="{table.td} font-mono tabular-nums"
						>{#if a.returnedOn}{a.returnedOn}{:else}<Empty />{/if}</td
					>
					<td class="{table.td} max-w-72">
						{#if variant === 'item'}
							<a
								class="hover:underline underline-offset-2"
								href="/members/{encodeURIComponent(a.userId)}"
							>
								<Person
									name={a.userName}
									former={a.userMembership === 'former'}
									imageUrl={a.userImageUrl}
								/>
							</a>
						{:else}
							<span class="inline-flex items-center gap-2 min-w-0 max-w-full">
								<AssetTag tag={a.assetTag} />
								<span class="truncate">{a.itemName}</span>
							</span>
						{/if}
					</td>
					<td class="{table.td} max-md:hidden">{a.placeName ?? ''}</td>
					<td class="{table.tdNum} max-md:hidden">
						<span>{formatCount(daysBetween(a.issuedOn, a.returnedOn ?? today))}</span> 日
					</td>
					<td class="{table.td} {table.meta} max-md:hidden">
						{a.issuedByName}{#if a.returnedByName && a.returnedByName !== a.issuedByName}
							/ {a.returnedByName}{/if}
					</td>
					<td class="{table.td} text-right">
						{#if a.returnKind}
							<Seal kind={a.returnKind} label={T.seals[a.returnKind]} animate={a.id === stampId} />
						{:else}
							<StatusChip status={a.pendingReturn ? 'pending_return' : 'assigned'} />
						{/if}
					</td>
					{#if oncorrect}
						<td class="{table.td} text-right">
							<button type="button" class={btn.ghostSm} onclick={() => oncorrect(a)}>訂正</button>
						</td>
					{/if}
				</tr>
			{:else}
				<TableState state="empty" {cols}>
					{#snippet empty()}割当の記録はありません。{/snippet}
				</TableState>
			{/each}
		</tbody>
	</table>
</div>
