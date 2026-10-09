<script lang="ts">
	import { page } from '$app/state';
	import type { EventKind as Kind, EventList } from '#lib/server/domain/events.ts';
	import { KIND_LABELS } from '#lib/components/events/EventKind.svelte';
	import EventsTable from '#lib/components/events/EventsTable.svelte';
	import FilterChip from '#lib/components/ui/FilterChip.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import SearchInput from '#lib/components/ui/SearchInput.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { btn, input } from '#lib/ui.ts';
	import { commaSeparatedParam, listParams, updateQuery } from '#lib/urlstate.ts';

	const T = {
		kindChip: '操作',
		fromChip: '開始',
		toChip: '終了',
		actorChip: '操作者',
		qChip: '検索',
	};
	const KINDS = Object.keys(KIND_LABELS) as Kind[];

	// Operation history (DESIGN.md §9-G), admin only.
	const params = $derived(page.url.searchParams);
	const kinds = $derived(commaSeparatedParam(params, 'kind') as Kind[]);
	const from = $derived(params.get('from') ?? '');
	const to = $derived(params.get('to') ?? '');
	const actor = $derived(params.get('actor') ?? '');
	const q = $derived(params.get('q') ?? '');
	const { page: pageNo, size } = $derived(listParams(params));

	const events = loader<EventList>(() => `/api/events${page.url.search}`, {
		keepPreviousData: true,
	});

	function setKind(value: string) {
		void updateQuery(page.url, { kind: value || null });
	}

	const actorName = $derived(events.data?.actors.find((a) => a.id === actor)?.name ?? actor);
	const anyFilter = $derived(
		kinds.length > 0 || from !== '' || to !== '' || actor !== '' || q !== '',
	);
</script>

<PageTitle title="履歴" />

<PageHeader title="履歴" count={events.data?.total ?? null} />

<div class="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-rule max-md:px-4">
	<SearchInput
		value={q}
		label="履歴を検索"
		placeholder="管理番号・物品名・社員・操作者"
		onsearch={(value) => updateQuery(page.url, { q: value || null })}
	/>
	<label>
		<span class="sr-only">操作</span>
		<select
			data-testid="history-kind"
			class={input.filterSelect}
			value={kinds.length === 1 ? kinds[0] : ''}
			onchange={(e) => setKind(e.currentTarget.value)}
		>
			<option value="">操作: すべて</option>
			{#each KINDS as k (k)}<option value={k}>{KIND_LABELS[k]}</option>{/each}
		</select>
	</label>
	<label class="inline-flex items-center gap-1 text-xs text-ink-muted">
		期間
		<input
			data-testid="history-from"
			type="date"
			class="{input.textSm} font-mono tabular-nums"
			value={from}
			onchange={(e) => updateQuery(page.url, { from: e.currentTarget.value || null })}
			aria-label="開始日"
		/>
		–
		<input
			data-testid="history-to"
			type="date"
			class="{input.textSm} font-mono tabular-nums"
			value={to}
			onchange={(e) => updateQuery(page.url, { to: e.currentTarget.value || null })}
			aria-label="終了日"
		/>
	</label>
	<label>
		<span class="sr-only">操作者</span>
		<select
			class={input.filterSelect}
			value={actor}
			onchange={(e) => updateQuery(page.url, { actor: e.currentTarget.value || null })}
		>
			<option value="">操作者: すべて</option>
			{#each events.data?.actors ?? [] as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
		</select>
	</label>
	{#if anyFilter}
		<div class="flex flex-wrap items-center gap-2 basis-full">
			{#each kinds as k (k)}
				<FilterChip label="{T.kindChip}: {KIND_LABELS[k] ?? k}" onremove={() => setKind('')} />
			{/each}
			{#if from}<FilterChip
					label="{T.fromChip}: {from}"
					onremove={() => updateQuery(page.url, { from: null })}
				/>{/if}
			{#if to}<FilterChip
					label="{T.toChip}: {to}"
					onremove={() => updateQuery(page.url, { to: null })}
				/>{/if}
			{#if actor}<FilterChip
					label="{T.actorChip}: {actorName}"
					onremove={() => updateQuery(page.url, { actor: null })}
				/>{/if}
			{#if q}<FilterChip
					label="{T.qChip}: {q}"
					onremove={() => updateQuery(page.url, { q: null })}
				/>{/if}
			<button
				type="button"
				class={btn.ghostSm}
				onclick={() =>
					updateQuery(page.url, { kind: null, from: null, to: null, actor: null, q: null })}
				>クリア</button
			>
		</div>
	{/if}
</div>

<div class="px-6 pt-3 max-md:px-4">
	<EventsTable
		rows={events.data?.rows ?? null}
		loading={events.loading}
		error={events.error}
		onretry={events.reload}
	/>
	<Pagination
		page={pageNo}
		{size}
		total={events.data?.total ?? 0}
		onpage={(p) => updateQuery(page.url, { page: p }, { resetPage: false })}
		onsize={(s) => updateQuery(page.url, { size: s })}
	/>
</div>
