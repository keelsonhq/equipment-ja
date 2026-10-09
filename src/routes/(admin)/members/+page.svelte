<script lang="ts">
	import { page } from '$app/state';
	import type { MemberList } from '#lib/server/domain/people.ts';
	import Empty from '#lib/components/ui/Empty.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import { rowLink } from '#lib/components/ui/rowLink.ts';
	import SearchInput from '#lib/components/ui/SearchInput.svelte';
	import SortTh from '#lib/components/ui/SortTh.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { formatDateTime } from '#lib/format.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { input, table } from '#lib/ui.ts';
	import { listParams, updateQuery } from '#lib/urlstate.ts';

	// Members screen (DESIGN.md §9-C): workspace members plus anyone in the
	// records, with how many items each holds.
	const params = $derived(page.url.searchParams);
	const { sort, dir, page: pageNo, size } = $derived(listParams(params, { sort: 'name' }));
	const holding = $derived(params.get('holding') === '1');
	const q = $derived(params.get('q') ?? '');
	// Header cells below: keep in step with the <SortTh>s.
	const COLS = 5;

	const members = loader<MemberList>(() => `/api/members${page.url.search}`, {
		keepPreviousData: true,
	});

	function setSort(key: string) {
		const nextDir = sort === key && dir === 'asc' ? 'desc' : 'asc';
		void updateQuery(page.url, { sort: key, dir: nextDir });
	}
</script>

<PageTitle title="社員別" />

<PageHeader title="社員別" count={members.data?.total ?? null} />

<div class="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-rule max-md:px-4">
	<SearchInput
		value={q}
		label="社員を検索"
		placeholder="名前・メール"
		onsearch={(value) => updateQuery(page.url, { q: value || null })}
	/>
	<label class="inline-flex items-center gap-2 h-8 text-xs text-ink">
		<input
			data-testid="holding-only"
			type="checkbox"
			class={input.checkbox}
			checked={holding}
			onchange={(e) => updateQuery(page.url, { holding: e.currentTarget.checked ? '1' : null })}
		/>
		支給中のみ
	</label>
</div>

<div class="px-6 pt-3 max-md:px-4 space-y-3">
	{#if members.data && (members.data.state === 'unconfigured' || members.data.state === 'unavailable')}
		<p role="status" class="text-sm text-ink-muted">社員の一覧を取得できませんでした。</p>
	{/if}

	<div class={table.wrap}>
		<table class={table.table}>
			<thead class={table.thead}>
				<tr class={table.headRow}>
					<SortTh
						key="name"
						{sort}
						{dir}
						onsort={setSort}
						extra="sticky left-0 z-20 border-r border-rule min-w-[200px]">社員</SortTh
					>
					<SortTh key="assigned" {sort} {dir} onsort={setSort} align="right" extra="w-[90px]"
						>支給中</SortTh
					>
					<SortTh key="pending" {sort} {dir} onsort={setSort} align="right" extra="w-[90px]"
						>返却待ち</SortTh
					>
					<SortTh key="email" {sort} {dir} onsort={setSort} extra="max-md:hidden">メール</SortTh>
					<SortTh key="updated" {sort} {dir} onsort={setSort} extra="w-[140px] max-md:hidden"
						>最終更新</SortTh
					>
				</tr>
			</thead>
			<tbody>
				{#if members.loading && !members.data}
					<TableState state="loading" cols={COLS} />
				{:else if members.error}
					<TableState state="error" cols={COLS} error={members.error} onretry={members.reload} />
				{:else if members.data}
					{#each members.data.rows as row (row.id)}
						<tr
							data-testid="member-row"
							class="{table.row} cursor-pointer"
							{@attach rowLink(`/members/${encodeURIComponent(row.id)}`)}
						>
							<td class="{table.stickyTd} max-w-80"
								><Person
									name={row.name}
									former={row.membership === 'former'}
									imageUrl={row.imageUrl}
								/></td
							>
							<td data-testid="member-assigned" class={table.tdNum}>{row.assigned}</td>
							<td data-testid="member-pending" class={table.tdNum}
								>{#if row.pending > 0}{row.pending}{:else}<Empty />{/if}</td
							>
							<td class="{table.td} font-mono {table.meta} max-md:hidden"
								>{#if row.email}{row.email}{:else}<Empty />{/if}</td
							>
							<td class="{table.td} font-mono {table.meta} tabular-nums max-md:hidden"
								>{#if row.lastActivity}{formatDateTime(row.lastActivity)}{:else}<Empty />{/if}</td
							>
						</tr>
					{:else}
						<TableState state="empty" cols={COLS}>
							{#snippet empty()}該当する社員はいません。{/snippet}
						</TableState>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	<Pagination
		page={pageNo}
		{size}
		total={members.data?.total ?? 0}
		onpage={(p) => updateQuery(page.url, { page: p }, { resetPage: false })}
		onsize={(s) => updateQuery(page.url, { size: s })}
	/>
</div>
