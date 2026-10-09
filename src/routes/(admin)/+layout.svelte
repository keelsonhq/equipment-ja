<script lang="ts">
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { session } from '#lib/state/session.svelte.ts';

	// The admin screens (route group: the folder name is not part of the URL).
	// A user without manage sees the message and a way to their own page, and
	// the screen itself is not rendered, so it reads nothing from the API. The
	// server checks manage on every admin API anyway; this only spares the UI.
	// The root layout renders pages only once `session.me` has loaded.
	let { children } = $props();
</script>

<!-- Without manage the screen (and its own title) is not rendered: keep the app's name. -->
{#if !session.me?.isAdmin}<PageTitle />{/if}

{#if session.me?.isAdmin}
	{@render children()}
{:else}
	<ErrorBox code="forbidden_manage_required" />
{/if}
