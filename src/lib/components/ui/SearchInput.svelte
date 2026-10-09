<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import { input as inputCls } from '#lib/ui.ts';

	// Search box with the 300 ms debounce (DESIGN.md §2). `value` is the applied
	// value (from the URL); typing calls `onsearch` after the pause.
	let {
		value,
		placeholder,
		label,
		onsearch,
		width = 'w-64',
	}: {
		value: string;
		placeholder: string;
		label: string;
		onsearch: (q: string) => void;
		width?: string;
	} = $props();

	// What is typed; it follows `value` when that changes (back / forward, "clear").
	let draft = $derived(value);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		draft = e.currentTarget.value;
		clearTimeout(timer);
		timer = setTimeout(() => onsearch(draft.trim()), 300);
	}
</script>

<label class="relative block {width} max-sm:w-full">
	<span class="sr-only">{label}</span>
	<Search
		class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 stroke-[1.5] text-ink-faint"
	/>
	<input
		data-testid="search-input"
		type="search"
		class={inputCls.search}
		{placeholder}
		value={draft}
		{oninput}
	/>
</label>
