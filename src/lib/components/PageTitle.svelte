<script module lang="ts">
	const T = { app: '備品管理' };

	/** The app's name: the side bar, the mobile top bar and every tab title. */
	export const APP_NAME = T.app;
</script>

<script lang="ts">
	// The browser tab's title: "<title> | <app name>", or the app name alone
	// (a screen the user may not open shows no title of its own).
	let { title = null }: { title?: string | null } = $props();
</script>

<svelte:head><title>{title ? `${title} | ${APP_NAME}` : APP_NAME}</title></svelte:head>
