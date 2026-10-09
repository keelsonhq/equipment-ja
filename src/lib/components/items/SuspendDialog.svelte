<script lang="ts">
	import { sendJson } from '#lib/api.ts';
	import { type FieldErrors, focusFirstInvalid, splitError, withoutEdited } from '#lib/forms.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import type { ItemRef } from '#lib/types.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from './AssetTag.svelte';
	import { REASON_LABELS } from './StatusChip.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import { SUSPEND_NOTE_MAX } from '#lib/limits.ts';

	const T = {
		suspended: '利用停止にしました。',
	};

	// Suspend an item (DESIGN.md §9-E). Existing assignments stay.
	let { onclose, ondone, item }: { onclose: () => void; ondone: () => void; item: ItemRef } =
		$props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	let reason = $state('repair');
	let note = $state('');
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		busy = true;
		error = null;
		errors = {};
		try {
			await sendJson('POST', `/api/items/${item.id}/suspend`, { reason, note });
			showToast(T.suspended);
			ondone();
		} catch (err) {
			({ fields: errors, general: error } = splitError(err, ['reason', 'note']));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="利用停止にする" {onclose} {error}>
	<form
		id={formId}
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		<div class="flex items-center gap-2 text-sm">
			<AssetTag tag={item.assetTag} />
			<span class="font-medium truncate">{item.name}</span>
		</div>
		<div>
			<label class={input.label} for="suspend-reason">理由</label>
			<select
				id="suspend-reason"
				name="reason"
				class={input.select}
				bind:value={reason}
				aria-invalid={!!errors.reason || undefined}
			>
				{#each Object.entries(REASON_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
			<FieldError field="reason" reason={errors.reason} />
		</div>
		<div>
			<label class={input.label} for="suspend-note"
				>詳細 <span class="text-ink-faint">(任意)</span></label
			>
			<input
				id="suspend-note"
				name="note"
				type="text"
				class={input.text}
				maxlength={SUSPEND_NOTE_MAX}
				bind:value={note}
				aria-invalid={!!errors.note || undefined}
			/>
			{#if errors.note}
				<FieldError field="note" reason={errors.note} />
			{:else}
				<p class={input.help}>支給中の割当は残ります。返却は記録できます。</p>
			{/if}
		</div>
	</form>
	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button
			data-testid="suspend-submit"
			type="submit"
			form={formId}
			class={btn.primary}
			disabled={busy}>利用停止にする</button
		>
	{/snippet}
</Dialog>
