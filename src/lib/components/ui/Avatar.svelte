<script lang="ts">
	import { avatarSrc, initialOf } from '#lib/format.ts';

	// Avatar (DESIGN.md §8.10): the directory profile image when there is one,
	// otherwise the initial. Former members are always drawn as a dashed initial.
	let {
		name,
		large = false,
		former = false,
		imageUrl = null,
	}: { name: string; large?: boolean; former?: boolean; imageUrl?: string | null } = $props();

	const px = $derived(large ? 40 : 20);
	// The URL whose image failed to load: fall back to the initial for it, and
	// try again as soon as a different URL comes in.
	let failedUrl = $state<string | null>(null);
	const src = $derived(
		former || imageUrl === null || imageUrl === failedUrl ? null : avatarSrc(imageUrl, px),
	);
</script>

{#if src}
	<img
		{src}
		alt=""
		loading="lazy"
		referrerpolicy="no-referrer"
		draggable="false"
		class="inline-block shrink-0 rounded-full object-cover ring-1 ring-rule {large
			? 'size-10'
			: 'size-5'}"
		onerror={() => (failedUrl = imageUrl)}
	/>
{:else}
	<span
		aria-hidden="true"
		class="inline-flex shrink-0 items-center justify-center rounded-full font-medium {large
			? 'size-10 text-sm'
			: 'size-5 text-[10px]'} {former
			? 'bg-stone-100 text-ink-faint border border-dashed border-rule-strong'
			: 'bg-stone-200 text-ink'}">{initialOf(name)}</span
	>
{/if}
