<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import FormerChip from './FormerChip.svelte';

	// Name-tag header of a person's page (DESIGN.md §9-C): who, and how many items
	// they hold now / still owe back after an exchange.
	let {
		name,
		email,
		former = false,
		imageUrl = null,
		assigned,
		pending,
		actions,
	}: {
		name: string;
		email: string | null;
		former?: boolean;
		imageUrl?: string | null;
		assigned: number;
		pending: number;
		actions?: Snippet;
	} = $props();
</script>

<header
	class="flex items-start justify-between gap-6 px-6 py-5 border-b border-rule max-md:flex-col max-md:gap-4 max-md:px-4"
>
	<div class="flex items-center gap-3 min-w-0">
		<Avatar {name} large {former} {imageUrl} />
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<h1 class="text-lg font-semibold tracking-tight text-ink truncate">{name}</h1>
				{#if former}<FormerChip />{/if}
			</div>
			{#if email}<p class="font-mono text-xs text-ink-muted truncate">{email}</p>{/if}
		</div>
	</div>
	<dl class="flex gap-8">
		<div>
			<dt class="text-xs text-ink-muted">支給中</dt>
			<dd data-testid="count-assigned" class="font-mono text-2xl font-medium tabular-nums text-ink">
				{assigned}
			</dd>
		</div>
		<div>
			<dt class="text-xs text-ink-muted">返却待ち</dt>
			<dd data-testid="count-pending" class="font-mono text-2xl font-medium tabular-nums text-ink">
				{pending}
			</dd>
		</div>
	</dl>
	{#if actions}
		<div class="flex items-center gap-2">{@render actions()}</div>
	{:else}
		<div class="max-md:hidden"></div>
	{/if}
</header>
