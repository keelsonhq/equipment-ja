<script lang="ts" generics="Item extends AvailableItem | ItemView">
	import type {
		AvailableItem,
		AvailableItemList,
		ItemList,
		ItemView,
	} from '#lib/server/domain/items.ts';
	import { withQuery } from '#lib/api.ts';
	import Combobox from '#lib/components/ui/Combobox.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { input } from '#lib/ui.ts';
	import AssetTag from './AssetTag.svelte';

	// Item picker. `available`: items free to issue (not held, not suspended),
	// optionally of one type, as AvailableItem. `held` (admin): items someone
	// holds, for recording a return, as the ledger's ItemView rows. `Item` is
	// the row type of the caller's scope (what `selected` is bound to).
	let {
		id,
		selected = $bindable(null),
		invalid = false,
		scope = 'available',
		typeId = null,
		onselect,
	}: {
		id: string;
		selected?: Item | null;
		invalid?: boolean;
		scope?: 'available' | 'held';
		typeId?: number | null;
		onselect?: (item: Item) => void;
	} = $props();

	// The text searched last. The list is read again when it, the scope or the
	// type changes; an answer to an older search is dropped (loader).
	let term = $state('');
	const found = loader<ItemList | AvailableItemList>(
		() =>
			scope === 'held'
				? withQuery('/api/items', { held: 1, q: term, size: 50 })
				: withQuery('/api/available-items', { q: term, type: typeId, size: 50 }),
		{ keepPreviousData: true },
	);
	const items = $derived(found.error ? [] : ((found.data?.rows ?? []) as Item[]));
</script>

<Combobox
	{id}
	testid="item-picker"
	class="{input.text} font-mono"
	placeholder={scope === 'held' ? '管理番号・物品名・支給先で検索' : '管理番号・物品名・種類で検索'}
	{items}
	bind:selected
	label={(item) => `${item.assetTag} ${item.name}`}
	{invalid}
	empty={scope === 'held' ? '支給中の物品はありません。' : '支給できる物品はありません。'}
	onsearch={(q) => (term = q)}
	{onselect}
>
	{#snippet option(item)}
		<AssetTag tag={item.assetTag} />
		<span class="truncate">{item.name}</span>
		{#if 'holder' in item && item.holder}<span class="ml-auto text-xs text-ink-muted truncate"
				>{item.holder.name}</span
			>{/if}
	{/snippet}
</Combobox>
