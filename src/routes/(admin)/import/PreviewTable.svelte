<script module lang="ts">
	import { ITEM_FIELD_LABELS as F } from '#lib/components/items/ItemFormDialog.svelte';

	const T = {
		columns: {
			assetTag: F.assetTag,
			name: F.name,
			typeName: F.typeId,
			serialNo: F.serialNo,
			purchasedOn: F.purchasedOn,
			storageLocation: F.storageLocation,
			note: F.note,
			holderEmail: '支給先メール',
			placeName: '使用場所',
			issuedOn: '支給日',
			dueOn: '返却予定日',
		},
		judgments: { ok: '取込可', warn: '要確認', error: '不可' },
		all: '全件',
	};

	/** CSV column names; the page's column mapping (step 1) shows them too. */
	export const COLUMN_LABELS = T.columns;
</script>

<script lang="ts">
	import type { CsvField } from '#lib/server/import/csv.ts';
	import type {
		ImportIssue,
		ImportPreview,
		Judgment,
		PreviewRow,
	} from '#lib/server/import/importer.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import { formatCount } from '#lib/format.ts';
	import { importIssueMessage } from '#lib/messages.ts';
	import { strip, table } from '#lib/ui.ts';

	// Step 3 of the import (DESIGN.md §9-H): the judgment strip, the rows the
	// server judged (paged here, see `paged`) and the masters the import would
	// add. The page owns the preview; this owns how it is shown (the judgment
	// filter, the page and the page size). The page draws this anew for each
	// file, so another file starts from all rows.
	let { preview }: { preview: ImportPreview | null } = $props();

	// Rows per page before any choice; DESIGN.md §9-H pages beyond this many.
	const FIRST_SIZE = 100;
	let filter = $state<Judgment | 'all'>('all');
	let size = $state(FIRST_SIZE);
	// Back to page 1 whenever the rows shown change: another preview (the
	// options changed), another judgment filter or another page size.
	let pageNo = $derived.by(() => {
		void [preview, filter, size];
		return 1;
	});

	const fields = $derived(
		(preview?.columns ?? []).map((c) => c.field).filter((f): f is CsvField => f !== null),
	);
	// Header cells below: line, judgment, the file's columns, the issues.
	const cols = $derived(fields.length + 3);
	const rows = $derived(
		(preview?.rows ?? []).filter((r) => filter === 'all' || r.judgment === filter),
	);
	const pageRows = $derived(rows.slice((pageNo - 1) * size, pageNo * size));
	// The paging bar (with the size choice) shows when the rows do not fit on
	// one page of the chosen size, and always beyond 100 rows, so a larger size
	// can be changed back.
	const paged = $derived(rows.length > Math.min(size, FIRST_SIZE));

	function issueOf(row: PreviewRow, field: CsvField) {
		return row.issues.find((i) => i.field === field) ?? null;
	}

	const ROW_TONE: Record<Judgment, string> = {
		ok: '',
		warn: 'bg-amber-50/60',
		error: 'bg-red-50/60',
	};
	const CHIP: Record<Judgment, string> = {
		ok: 'border-rule-strong bg-surface text-ink-muted',
		warn: 'border-amber-300 bg-amber-50 text-amber-800',
		error: 'border-red-300 bg-red-50 text-red-700',
	};
	// A value with an issue, and the issue's line in the last column.
	const ISSUE_TONE: Record<ImportIssue['level'], string> = {
		warn: 'text-amber-800',
		error: 'text-red-700',
	};
</script>

{#if !preview}
	<p class="text-sm text-ink-muted">ファイルを選ぶと、ここに各行の判定が出ます。</p>
{:else}
	<div class="{strip.line} text-xs">
		{#each ['all', 'ok', 'warn', 'error'] as const as key (key)}
			<button
				type="button"
				class="{strip.item} {filter === key ? strip.on : strip.off}"
				onclick={() => (filter = key)}
			>
				{key === 'all' ? T.all : T.judgments[key]}
				<span data-testid="import-count-{key}" class={strip.figure}
					>{formatCount(key === 'all' ? preview.rows.length : preview.counts[key])}</span
				>
			</button>
		{/each}
	</div>
	{#if preview.peopleState === 'unconfigured' || preview.peopleState === 'unavailable'}
		<p role="status" class="text-sm text-ink-muted">社員の一覧を取得できませんでした。</p>
	{/if}
	{#if preview.newTypes.length > 0 || preview.newPlaces.length > 0}
		<p class="text-sm text-ink-muted">
			{#if preview.newTypes.length > 0}追加する種類: <span class="text-ink"
					>{preview.newTypes.join('、')}</span
				>{/if}
			{#if preview.newTypes.length > 0 && preview.newPlaces.length > 0}<span class="mx-2">/</span
				>{/if}
			{#if preview.newPlaces.length > 0}追加する使用場所: <span class="text-ink"
					>{preview.newPlaces.join('、')}</span
				>{/if}
		</p>
	{/if}
	<div class={table.wrap}>
		<table class={table.table}>
			<thead class={table.thead}>
				<tr class={table.headRow}>
					<th class="{table.thRight} w-[64px]">行</th>
					<th class="{table.th} w-[80px]">判定</th>
					{#each fields as f (f)}
						<th class={table.th}>{T.columns[f]}</th>
					{/each}
					<th class="{table.th} min-w-72">確認事項</th>
				</tr>
			</thead>
			<tbody>
				{#each pageRows as row (row.line)}
					<tr
						data-testid="import-row"
						data-judgment={row.judgment}
						class="border-b border-rule last:border-0 {ROW_TONE[row.judgment]}"
					>
						<td class="{table.tdNum} {table.meta}">{row.line}</td>
						<td class={table.td}>
							<span
								class="inline-flex items-center h-5 px-1.5 rounded-xs border {table.chip} font-medium {CHIP[
									row.judgment
								]}">{T.judgments[row.judgment]}</span
							>
						</td>
						{#each fields as f (f)}
							{@const issue = issueOf(row, f)}
							{@const value = row.values[f] ?? ''}
							<td class="{table.td} max-w-60 truncate {issue ? ISSUE_TONE[issue.level] : ''}">
								{#if value === ''}
									{#if issue}<span class="text-xs">(空)</span>{:else}<Empty />{/if}
								{:else if f === 'assetTag' && !issue}
									<AssetTag tag={value} />
								{:else if f === 'holderEmail'}
									<span class="font-mono text-xs">{value}</span>{#if row.holderName}<span
											class="ml-2 {table.meta}">{row.holderName}</span
										>{/if}
								{:else if f === 'purchasedOn' || f === 'issuedOn' || f === 'dueOn' || f === 'serialNo' || f === 'assetTag'}
									<span class="font-mono tabular-nums">{value}</span>
								{:else}
									{value}
								{/if}
							</td>
						{/each}
						<td class="{table.td} whitespace-normal py-2 text-xs">
							{#each row.issues as i, n (n)}
								<p class={ISSUE_TONE[i.level]}>
									{T.columns[i.field]}: {importIssueMessage(i.code, i.level)}
								</p>
							{:else}
								<Empty />
							{/each}
						</td>
					</tr>
				{:else}
					<TableState state="empty" {cols}>
						{#snippet empty()}該当する行はありません。{/snippet}
					</TableState>
				{/each}
			</tbody>
		</table>
	</div>
	{#if paged}
		<Pagination
			page={pageNo}
			{size}
			total={rows.length}
			onpage={(p) => (pageNo = p)}
			onsize={(s) => (size = s)}
		/>
	{/if}
{/if}
