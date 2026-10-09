<script module lang="ts">
	const T = { none: '(種類なし)' };

	/** The name of "no type": the ledger's `type=none` filter and the home stock row. */
	export const NO_TYPE_LABEL = T.none;
</script>

<script lang="ts">
	// An item type's name, or "no type" for items without one.
	let { name }: { name: string | null } = $props();
</script>

{name ?? NO_TYPE_LABEL}
