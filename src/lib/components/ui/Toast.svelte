<script lang="ts">
	import { closeToast, toast } from '#lib/state/toast.svelte.ts';
	import { focusRing } from '#lib/ui.ts';
</script>

{#if toast.text}
	{#key toast.seq}
		<div
			role="status"
			aria-live="polite"
			class="toast-in fixed bottom-4 left-4 z-50 flex items-center gap-3 min-h-10 px-4 py-2 rounded-sm bg-ink text-paper text-sm shadow-md shadow-stone-900/20 max-md:inset-x-4"
		>
			<span>{toast.text}</span>
			{#if toast.error}
				<button
					type="button"
					class="ml-auto inline-flex items-center h-7 px-2 rounded-xs text-xs text-paper hover:bg-white/10 {focusRing}"
					onclick={closeToast}>閉じる</button
				>
			{/if}
		</div>
	{/key}
{/if}
