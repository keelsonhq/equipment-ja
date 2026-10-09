<script lang="ts">
	// Asset tag chip (DESIGN.md §8.7): always used to show a management number.
	let { tag, large = false }: { tag: string; large?: boolean } = $props();
</script>

<span
	class="inline-flex items-center rounded-xs border border-rule-strong border-l-2 border-l-accent bg-surface font-mono font-medium tracking-wide text-ink whitespace-nowrap {large
		? 'h-7 px-2 text-sm'
		: 'h-5 px-1.5 text-(length:--chip-text)'}">{tag}</span
>
