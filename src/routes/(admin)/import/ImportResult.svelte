<script lang="ts">
	import type { ImportResult } from '#lib/server/import/importer.ts';
	import { formatCount } from '#lib/format.ts';
	import { importIssueMessage, messageFor } from '#lib/messages.ts';
	import { btn, strip } from '#lib/ui.ts';

	// Step 4 once the import has run (DESIGN.md §9-H): the counts, the masters it
	// added and, when a chunk failed, where it stopped.
	let { result }: { result: ImportResult } = $props();

	function failureText(code: string): string {
		return code === 'duplicate_existing'
			? importIssueMessage(code, 'error')
			: messageFor(code).title;
	}
</script>

<div data-testid="import-result" role="status" class="space-y-2">
	<p class="{strip.line} text-sm">
		<span
			>登録 <span data-testid="import-created" class={strip.figure}
				>{formatCount(result.created)}</span
			> 件</span
		>
		<span
			>支給 <span data-testid="import-assigned" class={strip.figure}
				>{formatCount(result.assigned)}</span
			> 件</span
		>
		<span
			>除外 <span data-testid="import-excluded" class={strip.figure}
				>{formatCount(result.excluded)}</span
			> 件</span
		>
	</p>
	{#if result.addedTypes.length > 0}<p class="text-sm text-ink-muted">
			追加した種類: <span class="text-ink">{result.addedTypes.join('、')}</span>
		</p>{/if}
	{#if result.addedPlaces.length > 0}<p class="text-sm text-ink-muted">
			追加した使用場所: <span class="text-ink">{result.addedPlaces.join('、')}</span>
		</p>{/if}
	{#if result.failed}
		<p class="text-sm text-red-700">
			<span class="font-mono tabular-nums">{result.failed.fromLine}</span> 行目から
			<span class="font-mono tabular-nums">{result.failed.toLine}</span>
			行目のまとまりで止まりました({failureText(result.failed.code)})。
			この行より前は取り込み済みです。この行以降を直して、もう一度取り込んでください。
		</p>
	{/if}
	<a class={btn.secondary} href="/items">台帳で見る</a>
</div>
