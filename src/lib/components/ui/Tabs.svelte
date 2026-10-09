<script lang="ts" generics="K extends string">
	import type { Snippet } from 'svelte';
	import { tabs as recipe } from '#lib/ui.ts';

	// Tabs (DESIGN.md §8.12) over one panel that shows the selected tab's content
	// (`children`). The caller keeps which tab is selected (`bind:selected`).
	let {
		tabs,
		selected = $bindable(),
		testid,
		children,
	}: {
		/** In order; a `count` is shown after the label. */
		tabs: readonly { key: K; label: string; count?: number | null }[];
		selected: K;
		/** Each tab gets `data-testid="<testid>-<key>"`. */
		testid?: string;
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const panelId = `${uid}-panel`;
	const tabId = (key: K) => `${uid}-tab-${key}`;
</script>

<div class="{recipe.list} mb-3" role="tablist">
	{#each tabs as tab (tab.key)}
		<button
			id={tabId(tab.key)}
			data-testid={testid ? `${testid}-${tab.key}` : undefined}
			type="button"
			role="tab"
			aria-selected={selected === tab.key}
			aria-controls={panelId}
			class="{recipe.tab} {selected === tab.key ? recipe.on : recipe.off}"
			onclick={() => (selected = tab.key)}
		>
			{tab.label}{#if typeof tab.count === 'number'}<span class={recipe.count}>{tab.count}</span
				>{/if}
		</button>
	{/each}
</div>
<div id={panelId} role="tabpanel" aria-labelledby={tabId(selected)}>
	{@render children()}
</div>
