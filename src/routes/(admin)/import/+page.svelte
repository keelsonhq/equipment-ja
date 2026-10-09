<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import FileUp from '@lucide/svelte/icons/file-up';
	import type { ImportPreview, ImportResult as RunResult } from '#lib/server/import/importer.ts';
	import { ApiError, errorCode, uploadFile } from '#lib/api.ts';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { formatCount } from '#lib/format.ts';
	import { IMPORT_BYTES_MAX } from '#lib/limits.ts';
	import { loadMasters } from '#lib/state/masters.svelte.ts';
	import { messageFor } from '#lib/messages.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import { btn, input, section, table } from '#lib/ui.ts';
	import ImportResult from './ImportResult.svelte';
	import PreviewTable, { COLUMN_LABELS } from './PreviewTable.svelte';

	const T = {
		encodings: { 'utf-8': 'UTF-8', shift_jis: 'Shift_JIS' },
		imported: '取り込みました。',
	};

	// CSV import (DESIGN.md §9-H): numbered steps on one page. The server judges
	// the file (preview) and judges it again when importing, so the page holds
	// only the chosen file and the options. PreviewTable draws step 3 (anew for
	// each file) and ImportResult the outcome of step 4.

	let chooser: HTMLInputElement | undefined = $state();
	let file = $state<File | null>(null);
	let autoAddMasters = $state(true);
	let unassignUnknown = $state(true);
	let preview = $state<ImportPreview | null>(null);
	let fileError = $state<{ code: string; line: number | null } | null>(null);
	let loading = $state(false);
	let running = $state(false);
	let result = $state<RunResult | null>(null);
	let runError = $state<string | null>(null);
	let seq = 0;

	function options() {
		return { autoAddMasters: autoAddMasters ? 1 : 0, unassignUnknown: unassignUnknown ? 1 : 0 };
	}

	async function loadPreview() {
		if (!file) {
			return;
		}
		const mine = ++seq;
		loading = true;
		runError = null;
		try {
			const p = await uploadFile<ImportPreview>('/api/import/preview', file, options());
			if (mine === seq) {
				preview = p;
				fileError = null;
			}
		} catch (err) {
			if (mine === seq) {
				preview = null;
				fileError = { code: errorCode(err), line: err instanceof ApiError ? err.line : null };
			}
		} finally {
			if (mine === seq) {
				loading = false;
			}
		}
	}

	function choose(e: Event & { currentTarget: HTMLInputElement }) {
		const chosen = e.currentTarget.files?.[0] ?? null;
		// Let the same file be chosen again after it was edited.
		e.currentTarget.value = '';
		if (!chosen) {
			return;
		}
		file = chosen;
		result = null;
		if (chosen.size > IMPORT_BYTES_MAX) {
			preview = null;
			fileError = { code: 'csv_too_large', line: null };
			return;
		}
		void loadPreview();
	}

	async function run(mode: 'all' | 'skip_errors') {
		if (!file) {
			return;
		}
		running = true;
		runError = null;
		try {
			result = await uploadFile<RunResult>('/api/import/execute', file, {
				...options(),
				mode,
			});
			if (result.addedTypes.length > 0 || result.addedPlaces.length > 0) {
				void loadMasters(true);
			}
			showToast(T.imported);
			// The rows are in now: clear the file so they are not imported twice.
			file = null;
			preview = null;
		} catch (err) {
			runError = errorCode(err);
		} finally {
			running = false;
		}
	}

	// Rows that would be imported (rejected rows never are), and what the two
	// buttons need: "import" all rows only when none is rejected, "import the
	// others" anything at all; neither while a file is read or imported.
	const importable = $derived(preview ? preview.counts.ok + preview.counts.warn : 0);
	const rejected = $derived(preview?.counts.error ?? 0);
	const idle = $derived(!running && !loading);
	const fileMessage = $derived(fileError ? messageFor(fileError.code) : null);
</script>

<PageTitle title="CSV で取り込む" />

<PageHeader title="CSV で取り込む" />

<div class="px-6 py-4 space-y-8 max-md:px-4">
	<section class="space-y-3 max-w-3xl" aria-labelledby="step-file">
		<h2 id="step-file" class={section.heading}>1. ファイルを選ぶ</h2>
		<p class="text-sm text-ink-muted">
			1 行目は見出しです。列は
			管理番号・物品名(必須)、種類・製造番号・購入日・保管場所・備考・支給先メール・使用場所・支給日・返却予定日。台帳の「CSV
			出力」で作ったファイルもそのまま使えます(状態などの列は読みません)。
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<input
				bind:this={chooser}
				data-testid="import-file"
				type="file"
				accept=".csv,text/csv"
				class="sr-only"
				tabindex="-1"
				onchange={choose}
			/>
			<button
				type="button"
				class={btn.secondary}
				onclick={() => chooser?.click()}
				disabled={running}
			>
				<FileUp class="size-4 stroke-[1.5]" />ファイルを選ぶ
			</button>
			<a data-testid="import-template" class={btn.ghost} href="/api/import/template" download>
				<Download class="size-4 stroke-[1.5]" />ひな形をダウンロード
			</a>
		</div>
		<p class={input.help}>
			UTF-8 と Shift_JIS(表計算ソフトの既定)を自動で判別します。最大 2,000 行・2 MB。
		</p>
		{#if file}
			<p class="flex flex-wrap items-baseline gap-x-3">
				<span class="font-mono text-sm text-ink">{file.name}</span>
				{#if preview}<span class={table.meta}>文字コード: {T.encodings[preview.encoding]}</span
					>{/if}
				{#if loading}<span class={table.meta}>読み込み中…</span>{/if}
			</p>
		{/if}
		{#if fileMessage}
			<p role="alert" class={input.error}>
				{fileMessage.title}{#if fileError?.line}(<span class="font-mono tabular-nums"
						>{fileError.line}</span
					> 行目){/if}。{fileMessage.body}
			</p>
		{/if}
		{#if preview}
			<p class="{input.label} mt-4">列の対応</p>
			<dl class="text-sm max-w-xl">
				{#each preview.columns as c, i (i)}
					<div class="grid grid-cols-[10rem_1fr] gap-x-4 py-1.5 border-b border-rule last:border-0">
						<dt class="font-mono text-ink truncate">{c.header || '(見出しなし)'}</dt>
						<dd class={c.field ? 'text-ink' : 'text-ink-faint'}>
							{c.field ? COLUMN_LABELS[c.field] : '取り込まない'}
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
	</section>

	<section class="space-y-3 max-w-3xl" aria-labelledby="step-options">
		<h2 id="step-options" class={section.heading}>2. 取り込み方を決める</h2>
		<div class="space-y-2 text-sm">
			<label class="flex items-start gap-2">
				<input
					type="checkbox"
					class="{input.checkbox} mt-0.5"
					bind:checked={autoAddMasters}
					onchange={() => void loadPreview()}
				/>
				<span>未登録の種類・使用場所を自動で追加する</span>
			</label>
			<label class="flex items-start gap-2">
				<input
					type="checkbox"
					class="{input.checkbox} mt-0.5"
					bind:checked={unassignUnknown}
					onchange={() => void loadPreview()}
				/>
				<span>支給先が見つからない行は未割当で登録する</span>
			</label>
		</div>
		<p class={input.help}>
			社員は自動作成しません。支給先メールが社員に一致した行は、登録と同時に支給します(支給日が空なら今日、使用場所が空なら先頭の使用場所)。オフにした項目に当たる行は「不可」になり、取り込みません。
		</p>
	</section>

	<section class="space-y-3" aria-labelledby="step-preview">
		<h2 id="step-preview" class={section.heading}>3. 内容を確認する</h2>
		{#key file}
			<PreviewTable {preview} />
		{/key}
	</section>

	<section class="space-y-3 max-w-3xl" aria-labelledby="step-run">
		<h2 id="step-run" class={section.heading}>4. 取り込む</h2>
		{#if runError}
			<div role="alert" class="rounded-xs border border-red-200 bg-red-50 p-3 text-sm text-red-800">
				<p class="font-medium">{messageFor(runError).title}</p>
				<p class="mt-1">{messageFor(runError).body}</p>
			</div>
		{/if}
		{#if result}
			<ImportResult {result} />
		{:else}
			<div class="flex flex-wrap gap-2">
				<button
					data-testid="import-run"
					type="button"
					class={btn.primary}
					disabled={!(idle && importable > 0 && rejected === 0)}
					onclick={() => run('all')}>取り込む</button
				>
				{#if rejected > 0}
					<button
						type="button"
						class={btn.secondary}
						disabled={!(idle && importable > 0)}
						onclick={() => run('skip_errors')}>不可を除いて取り込む</button
					>
				{/if}
			</div>
			<p class={input.help}>
				{#if preview}
					取り込む行: <span class="font-mono tabular-nums">{formatCount(importable)}</span> 件。
				{/if}
				100 行ずつ登録します。途中で止まった場合は、どこまで入ったかをここに示します。
			</p>
		{/if}
	</section>
</div>
