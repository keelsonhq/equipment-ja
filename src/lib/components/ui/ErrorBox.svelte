<script lang="ts">
	import { messageFor } from '#lib/messages.ts';
	import { btn } from '#lib/ui.ts';

	// Page-level error: title + cause / what to do + one action (DESIGN.md §10).
	// The action is the code's own link from the message table (messages.ts)
	// when it has one, else a reload when the page can retry.
	let { code, onretry }: { code: string; onretry?: () => void } = $props();
	const message = $derived(messageFor(code));
</script>

<div
	role="alert"
	class="m-6 max-w-2xl rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-800"
>
	<p class="font-medium">{message.title}</p>
	<p class="mt-1">{message.body}</p>
	{#if message.action}
		<a class="{btn.secondary} mt-3" href={message.action.href}>{message.action.label}</a>
	{:else if onretry}
		<button type="button" class="{btn.secondary} mt-3" onclick={onretry}>再読み込み</button>
	{/if}
</div>
