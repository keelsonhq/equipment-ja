<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import { focusRing } from '#lib/ui.ts';

	// Applied-filter chip (DESIGN.md §8.4) with its remove button.
	let { label, onremove }: { label: string; onremove: () => void } = $props();
</script>

<span
	class="inline-flex items-center gap-1 h-6 px-2 rounded-xs border border-accent/40 bg-accent-soft text-xs text-accent-strong whitespace-nowrap"
>
	{label}
	<button
		type="button"
		class="inline-flex items-center justify-center rounded-xs hover:text-ink {focusRing}"
		onclick={onremove}
		aria-label="{label} を解除"
	>
		<X class="size-3 stroke-[1.5]" />
	</button>
</span>
