<script lang="ts">
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import FormerChip from './FormerChip.svelte';

	// Avatar + display name (+ "former member" chip) for table cells.
	let {
		name,
		former = false,
		imageUrl = null,
	}: { name: string; former?: boolean; imageUrl?: string | null } = $props();
</script>

<span class="inline-flex items-center gap-2 min-w-0 max-w-full">
	<Avatar {name} {former} {imageUrl} />
	<span class="truncate">{name}</span>
	{#if former}<FormerChip />{/if}
</span>
