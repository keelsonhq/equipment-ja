<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import { messageFor } from '#lib/messages.ts';
	import { btn } from '#lib/ui.ts';

	// Native <dialog> (DESIGN.md §8.13). Escape closes it. A server error shows
	// inside the body; the dialog stays open so the input is not lost.
	// The caller renders it only while it is open (`{#if issueItem}<IssueDialog
	// …/>{/if}`): it opens as a modal when it mounts, and closing it is
	// unmounting it, so every opening starts from a fresh form.
	let {
		title,
		onclose,
		error = null,
		children,
		footer,
		wide = false,
	}: {
		title: string;
		onclose: () => void;
		error?: string | null;
		children: Snippet;
		footer?: Snippet;
		wide?: boolean;
	} = $props();

	// Unique per instance: the dialog must be labelled by its own title, never
	// by another element of the page with the same id.
	const uid = $props.id();
	const titleId = `${uid}-title`;

	// Unmounting skips the <dialog>'s own close steps, which hand focus back to
	// what had it before the dialog opened (the button that opened it). Do the
	// same here.
	function showModal(dialog: HTMLDialogElement) {
		const opener = document.activeElement;
		dialog.showModal();
		return () => {
			if (opener instanceof HTMLElement && opener.isConnected) {
				opener.focus();
			}
		};
	}

	const message = $derived(error ? messageFor(error) : null);
</script>

<dialog
	{@attach showModal}
	class="dialog-in fixed left-1/2 top-1/2 w-[calc(100%-2rem)] {wide
		? 'max-w-2xl'
		: 'max-w-lg'} max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-sm border border-rule-strong bg-surface text-ink shadow-md shadow-stone-900/10 open:flex"
	aria-labelledby={titleId}
	oncancel={(e) => {
		e.preventDefault();
		onclose();
	}}
>
	<div class="flex items-center justify-between h-12 px-5 border-b border-rule shrink-0">
		<h2 id={titleId} class="text-sm font-semibold text-ink">{title}</h2>
		<button type="button" class={btn.ghostIcon} onclick={onclose} aria-label="閉じる">
			<X class="size-4 stroke-[1.5]" />
		</button>
	</div>
	<div class="px-5 py-4 space-y-4 overflow-y-auto">
		{#if message}
			<div
				data-testid="dialog-error"
				role="alert"
				class="rounded-xs border border-red-200 bg-red-50 p-3 text-sm text-red-800"
			>
				<p class="font-medium">{message.title}</p>
				<p class="mt-1">{message.body}</p>
			</div>
		{/if}
		{@render children()}
	</div>
	{#if footer}
		<div class="flex justify-end gap-2 px-5 py-3 border-t border-rule bg-paper shrink-0">
			{@render footer()}
		</div>
	{/if}
</dialog>
