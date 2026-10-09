<script lang="ts">
	import { fieldMessage } from '#lib/messages.ts';
	import { input } from '#lib/ui.ts';

	// The message under a form field (DESIGN.md §8.6).
	let { field, reason }: { field: string; reason?: string | null } = $props();
</script>

{#if reason}
	<p data-testid="field-error-{field}" class={input.error}>
		{fieldMessage(field, reason)}
	</p>
{/if}
