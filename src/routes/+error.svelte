<script lang="ts">
	import { page } from '$app/state';
	import { btn } from '#lib/ui.ts';
</script>

<div class="m-6 max-w-2xl rounded-sm border border-rule-strong bg-surface p-4 text-sm text-ink">
	{#if page.status === 404}
		<p class="font-medium">ページが見つかりません。</p>
		<p class="mt-1 text-ink-muted">URL が正しいか確認してください。</p>
	{:else}
		<p class="font-medium">ページを表示できませんでした。</p>
		<p class="mt-1 text-ink-muted">再読み込みしてください。続く場合は管理者に連絡してください。</p>
	{/if}
	<a class="{btn.secondary} mt-3" href="/">ホームへ</a>
</div>
