<script lang="ts">
	// Red seal (DESIGN.md §8.9): a recorded fact. The words come from the caller
	// (this app's return / collection, or another use's own); `kind` is the
	// English value for data-kind. `animate` plays the stamp once, only right
	// after the fact is recorded.
	let {
		kind,
		label,
		largeLabel,
		large = false,
		animate = false,
	}: {
		/** English value for data-kind (tests select by it). */
		kind: string;
		/** The words on the seal. */
		label: string;
		/** The words on the round seal, with a line break (default: `label`). */
		largeLabel?: string;
		large?: boolean;
		animate?: boolean;
	} = $props();
</script>

{#if large}
	<span
		data-testid="seal"
		data-kind={kind}
		class="inline-flex items-center justify-center size-12 rounded-full border-[1.5px] border-seal text-seal text-[11px] font-semibold leading-tight text-center -rotate-6 select-none whitespace-pre-line {animate
			? 'stamp-press'
			: ''}">{largeLabel ?? label}</span
	>
{:else}
	<span
		data-testid="seal"
		data-kind={kind}
		class="inline-flex items-center h-5 px-1.5 rounded-xs border border-seal text-seal text-(length:--chip-text) font-medium whitespace-nowrap select-none {animate
			? 'stamp-press'
			: ''}">{label}</span
	>
{/if}
