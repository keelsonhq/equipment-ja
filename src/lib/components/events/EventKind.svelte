<script module lang="ts">
	import type { EventKind as Kind } from '#lib/server/domain/events.ts';

	const T = {
		kinds: {
			create: '登録',
			edit: '編集',
			issue: '支給',
			return: '返却',
			suspend: '利用停止',
			resume: '再開',
			correct: '訂正',
			import: '取込',
		},
	};

	/** History entry kinds, in the order the history filter offers them. */
	export const KIND_LABELS: Record<Kind, string> = T.kinds;
</script>

<script lang="ts">
	// Label of an operation-history entry kind.
	let { kind }: { kind: Kind } = $props();
</script>

<span data-testid="event-kind" data-kind={kind} class="whitespace-nowrap">{KIND_LABELS[kind]}</span>
