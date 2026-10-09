<script lang="ts">
	import Columns from '@lucide/svelte/icons/columns-2';
	import Download from '@lucide/svelte/icons/download';
	import FileUp from '@lucide/svelte/icons/file-up';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import Plus from '@lucide/svelte/icons/plus';
	import Rows from '@lucide/svelte/icons/rows-3';
	import type { ItemStatus, StatusCounts } from '#lib/server/domain/items.ts';
	import type { Person as PersonEntry } from '#lib/server/domain/people.ts';
	import FilterChip from '#lib/components/ui/FilterChip.svelte';
	import Menu from '#lib/components/ui/Menu.svelte';
	import MemberCombobox from '#lib/components/people/MemberCombobox.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import SearchInput from '#lib/components/ui/SearchInput.svelte';
	import { STATUS_LABELS } from '#lib/components/items/StatusChip.svelte';
	import { NO_TYPE_LABEL } from '#lib/components/items/TypeName.svelte';
	import { formatCount } from '#lib/format.ts';
	import { masters } from '#lib/state/masters.svelte.ts';
	import { density, toggleDensity } from '#lib/state/density.svelte.ts';
	import { btn, input, menu, strip } from '#lib/ui.ts';
	import { COLUMN_LABELS, COLUMNS, type ColumnKey } from './LedgerTable.svelte';

	const T = {
		title: '台帳',
		all: '全件',
		chips: {
			status: '状態',
			type: '種類',
			place: '使用場所',
			member: '支給先',
			q: '検索',
		},
	};

	// Everything above the ledger table: the page header (count, column menu,
	// density, CSV, register, the "more" menu on narrow screens), the counts
	// strip (DESIGN.md §8.2) and the filter bar (DESIGN.md §8.4). The page owns the
	// URL query: this reads the applied filters and asks for changes through
	// `onquery`.
	let {
		total,
		counts,
		memberName,
		q,
		statuses,
		typeId,
		placeId,
		memberId,
		anyFilter,
		visible,
		exportHref,
		onquery,
		oncolumns,
		oncreate,
	}: {
		total: number | null;
		counts: StatusCounts | null;
		memberName: string | null;
		q: string;
		statuses: ItemStatus[];
		typeId: string;
		placeId: string;
		memberId: string;
		anyFilter: boolean;
		visible: ColumnKey[];
		/** CSV export of the current filters. */
		exportHref: string;
		onquery: (changes: Record<string, string | null>) => void;
		oncolumns: (visible: ColumnKey[]) => void;
		oncreate: () => void;
	} = $props();

	// The statuses in the order the status filter lists them. The counts strip
	// starts with "all" and shows "overdue" last, only when there is one (in
	// seal red).
	type StripKey = keyof StatusCounts;
	const STATUSES: ItemStatus[] = [
		'assigned',
		'unassigned',
		'pending_return',
		'overdue',
		'suspended',
	];
	const STRIP: StripKey[] = ['all', ...STATUSES.filter((s) => s !== 'overdue')];
	const STRIP_LABELS: Record<StripKey, string> = { all: T.all, ...STATUS_LABELS };
	const stripKeys = $derived<StripKey[]>(
		(counts?.overdue ?? 0) > 0 ? [...STRIP, 'overdue'] : STRIP,
	);

	function toggleStatus(s: ItemStatus) {
		const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
		onquery({ status: next.join(',') || null });
	}

	function stripClick(key: StripKey) {
		onquery({ status: key === 'all' ? null : key });
	}

	function stripActive(key: StripKey): boolean {
		return key === 'all' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === key;
	}

	function toggleColumn(key: ColumnKey) {
		oncolumns(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]);
	}

	const typeName = $derived(
		typeId === 'none'
			? NO_TYPE_LABEL
			: (masters.types.find((t) => String(t.id) === typeId)?.name ?? typeId),
	);
	const placeName = $derived(masters.places.find((p) => String(p.id) === placeId)?.name ?? placeId);
</script>

<PageHeader title={T.title} count={total}>
	{#snippet actions()}
		<button
			data-testid="density-toggle"
			type="button"
			class="{btn.ghost} max-md:hidden"
			onclick={toggleDensity}
			aria-pressed={density.dense}
		>
			<Rows class="size-4 stroke-[1.5]" />密度
		</button>
		<Menu class="max-md:hidden">
			{#snippet trigger(props)}
				<button {...props} class={btn.ghost}>
					<Columns class="size-4 stroke-[1.5]" />列
				</button>
			{/snippet}
			{#each COLUMNS as c (c.key)}
				<label class={menu.item}>
					<input
						type="checkbox"
						class={input.checkbox}
						checked={visible.includes(c.key)}
						onchange={() => toggleColumn(c.key)}
					/>
					{COLUMN_LABELS[c.key]}
				</label>
			{/each}
		</Menu>
		<a class="{btn.secondary} max-md:hidden" href="/import">
			<FileUp class="size-4 stroke-[1.5]" />CSV で取り込む
		</a>
		<a data-testid="items-export" class="{btn.secondary} max-md:hidden" href={exportHref} download>
			<Download class="size-4 stroke-[1.5]" />CSV 出力
		</a>
		<button data-testid="item-register" type="button" class={btn.primary} onclick={oncreate}>
			<Plus class="size-4 stroke-[1.5]" />物品を登録
		</button>
		<Menu class="md:hidden">
			{#snippet trigger(props)}
				<button {...props} class={btn.ghostIcon} aria-label="その他の操作">
					<Ellipsis class="size-4 stroke-[1.5]" />
				</button>
			{/snippet}
			<a class={menu.item} href="/import">CSV で取り込む</a>
			<a class={menu.item} href={exportHref} download>CSV 出力</a>
			<button type="button" class={menu.item} onclick={toggleDensity}>密度を切り替える</button>
		</Menu>
	{/snippet}
</PageHeader>

<!-- Counts strip (DESIGN.md §8.2): one line, each figure filters the ledger. -->
<div class="{strip.line} text-xs px-6 py-2 border-b border-rule bg-paper max-md:px-4">
	{#each stripKeys as key (key)}
		{@const on = stripActive(key)}
		<!-- "Overdue" is in seal red, its figure too, until it is the filter. -->
		{@const seal = key === 'overdue'}
		<button
			type="button"
			class="{strip.item} {on ? strip.on : strip.off} {seal && !on ? 'text-seal' : ''}"
			onclick={() => stripClick(key)}
		>
			{STRIP_LABELS[key]}
			<span class={seal ? 'font-mono tabular-nums' : strip.figure}
				>{formatCount(counts?.[key] ?? 0)}</span
			>
		</button>
	{/each}
</div>

<!-- Filter bar (DESIGN.md §8.4), synced with the URL query. -->
<div class="flex flex-wrap items-center gap-2 px-6 py-2 border-b border-rule max-md:px-4">
	<SearchInput
		value={q}
		label="物品を検索"
		placeholder="管理番号・物品名・製造番号・備考・支給先"
		onsearch={(value) => onquery({ q: value || null })}
	/>
	<Menu align="left">
		{#snippet trigger(props)}
			<button
				{...props}
				data-testid="status-filter"
				class="{input.filterSelect} inline-flex items-center gap-1"
			>
				状態{#if statuses.length > 0}<span class="font-mono tabular-nums">({statuses.length})</span
					>{/if}
			</button>
		{/snippet}
		{#each STATUSES as s (s)}
			<label class={menu.item}>
				<input
					data-testid="status-filter-{s}"
					type="checkbox"
					class={input.checkbox}
					checked={statuses.includes(s)}
					onchange={() => toggleStatus(s)}
				/>
				{STATUS_LABELS[s]}
			</label>
		{/each}
	</Menu>
	<label>
		<span class="sr-only">種類</span>
		<select
			class={input.filterSelect}
			value={typeId}
			onchange={(e) => onquery({ type: e.currentTarget.value || null })}
		>
			<option value="">種類: すべて</option>
			{#each masters.types as t (t.id)}<option value={String(t.id)}>{t.name}</option>{/each}
			<option value="none">{NO_TYPE_LABEL}</option>
		</select>
	</label>
	<label>
		<span class="sr-only">使用場所</span>
		<select
			class={input.filterSelect}
			value={placeId}
			onchange={(e) => onquery({ place: e.currentTarget.value || null })}
		>
			<option value="">使用場所: すべて</option>
			{#each masters.places as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
		</select>
	</label>
	<MemberCombobox
		id="filter-member"
		compact
		placeholder="支給先で絞り込み"
		onselect={(p: PersonEntry) => onquery({ member: p.id })}
	/>

	{#if anyFilter}
		<div class="flex flex-wrap items-center gap-2 basis-full">
			{#each statuses as s (s)}
				<FilterChip label="{T.chips.status}: {STATUS_LABELS[s]}" onremove={() => toggleStatus(s)} />
			{/each}
			{#if typeId}<FilterChip
					label="{T.chips.type}: {typeName}"
					onremove={() => onquery({ type: null })}
				/>{/if}
			{#if placeId}<FilterChip
					label="{T.chips.place}: {placeName}"
					onremove={() => onquery({ place: null })}
				/>{/if}
			{#if memberId}
				<FilterChip
					label="{T.chips.member}: {memberName ?? memberId}"
					onremove={() => onquery({ member: null })}
				/>
			{/if}
			{#if q}<FilterChip label="{T.chips.q}: {q}" onremove={() => onquery({ q: null })} />{/if}
			<button
				type="button"
				class={btn.ghostSm}
				onclick={() => onquery({ status: null, type: null, place: null, member: null, q: null })}
				>クリア</button
			>
		</div>
	{/if}
</div>
