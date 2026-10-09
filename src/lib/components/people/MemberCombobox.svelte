<script lang="ts">
	import type { PeopleSearch, Person } from '#lib/server/domain/people.ts';
	import { withQuery } from '#lib/api.ts';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import Combobox from '#lib/components/ui/Combobox.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { input } from '#lib/ui.ts';

	const T = { placeholder: '名前またはメールで検索' };

	// Employee picker (DESIGN.md §8.6): searches the workspace members by name or
	// email. When the list cannot be read it says only that, inside the list
	// (DESIGN.md §8.17), and it never offers to create an employee.
	let {
		id,
		selected = $bindable(null),
		invalid = false,
		compact = false,
		placeholder = T.placeholder,
		onselect,
	}: {
		id: string;
		selected?: Person | null;
		invalid?: boolean;
		/** Filter-bar variant: small input. */
		compact?: boolean;
		placeholder?: string;
		onselect?: (p: Person) => void;
	} = $props();

	// The text searched last; an answer to an older search is dropped (loader).
	let term = $state('');
	const found = loader<PeopleSearch>(() => withQuery('/api/members/search', { q: term }), {
		keepPreviousData: true,
	});
	const items = $derived(found.error ? [] : (found.data?.items ?? []));
	// A 403 is not "the list cannot be read": the picker simply has nothing to offer.
	const unreadable = $derived(
		(found.error !== null && found.error !== 'forbidden_manage_required') ||
			found.data?.state === 'unavailable' ||
			found.data?.state === 'unconfigured',
	);
</script>

<Combobox
	{id}
	testid="member-combobox"
	class={compact ? `${input.textSm} w-48 max-sm:w-full` : input.text}
	{placeholder}
	{items}
	bind:selected
	label={(p) => p.name}
	{invalid}
	empty={unreadable ? '社員の一覧を取得できませんでした。' : '該当する社員がいません。'}
	onsearch={(q) => (term = q)}
	{onselect}
>
	{#snippet option(p)}
		<Avatar name={p.name} imageUrl={p.imageUrl} />
		<span class="truncate">{p.name}</span>
		{#if p.email}<span class="ml-auto font-mono text-xs text-ink-muted truncate">{p.email}</span
			>{/if}
	{/snippet}
</Combobox>
