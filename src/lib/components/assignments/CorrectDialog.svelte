<script lang="ts">
	import { untrack } from 'svelte';
	import type { AssignmentView } from '#lib/server/domain/assignments.ts';
	import { sendJson } from '#lib/api.ts';
	import {
		check,
		dateProblem,
		type FieldErrors,
		focusFirstInvalid,
		hasErrors,
		splitError,
		withoutEdited,
	} from '#lib/forms.ts';
	import { masters } from '#lib/state/masters.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import { CORRECTION_REASON_MAX } from '#lib/limits.ts';

	const T = {
		corrected: '記録を訂正しました。',
	};

	// Correct a recorded assignment (admin, DESIGN.md §9-E). The previous
	// values stay in the operation history.
	let {
		onclose,
		ondone,
		assignment,
	}: {
		onclose: () => void;
		ondone: () => void;
		assignment: AssignmentView;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	const today = $derived(session.me?.today ?? '');

	// The form starts from the recorded values.
	let issuedOn = $state(untrack(() => assignment.issuedOn));
	let returnedOn = $state(untrack(() => assignment.returnedOn ?? ''));
	let placeId = $state(untrack(() => (assignment.placeId ? String(assignment.placeId) : '')));
	let reason = $state('');
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);

	// Active places, plus the current one even if it has been deactivated.
	const places = $derived(masters.places.filter((p) => p.active || p.id === assignment.placeId));

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		// The return date is shown (and checked) only for a returned assignment.
		const returned = assignment.returnedOn !== null;
		errors = check({
			issuedOn: dateProblem(issuedOn, { today }),
			returnedOn: returned && dateProblem(returnedOn, { today, notBefore: issuedOn }),
			placeId: placeId === '' && 'required',
			reason: reason.trim() === '' && 'required',
		});
		if (hasErrors(errors)) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		try {
			await sendJson('POST', `/api/assignments/${encodeURIComponent(assignment.id)}/correct`, {
				issuedOn,
				returnedOn: assignment.returnedOn ? returnedOn : null,
				placeId: Number(placeId),
				reason,
				version: assignment.version,
			});
			showToast(T.corrected);
			ondone();
		} catch (err) {
			({ fields: errors, general: error } = splitError(err, [
				'issuedOn',
				'returnedOn',
				'placeId',
				'reason',
			]));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="記録を訂正" {onclose} {error}>
	<form
		id={formId}
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		<div class="flex items-center gap-2 text-sm">
			<AssetTag tag={assignment.assetTag} />
			<span class="font-medium truncate">{assignment.itemName}</span>
			<span class="ml-auto text-xs text-ink-muted whitespace-nowrap">{assignment.userName}</span>
		</div>
		<div class="grid grid-cols-2 gap-4">
			<div>
				<label class={input.label} for="correct-issued">支給日</label>
				<input
					id="correct-issued"
					name="issuedOn"
					type="date"
					class="{input.text} font-mono tabular-nums"
					max={today}
					bind:value={issuedOn}
					aria-invalid={!!errors.issuedOn || undefined}
				/>
				<FieldError field="issuedOn" reason={errors.issuedOn} />
			</div>
			{#if assignment.returnedOn}
				<div>
					<label class={input.label} for="correct-returned">返却日</label>
					<input
						id="correct-returned"
						name="returnedOn"
						type="date"
						class="{input.text} font-mono tabular-nums"
						min={issuedOn}
						max={today}
						bind:value={returnedOn}
						aria-invalid={!!errors.returnedOn || undefined}
					/>
					<FieldError field="returnedOn" reason={errors.returnedOn} />
				</div>
			{/if}
		</div>
		<div>
			<label class={input.label} for="correct-place">使用場所</label>
			<select
				id="correct-place"
				name="placeId"
				class={input.select}
				bind:value={placeId}
				aria-invalid={!!errors.placeId || undefined}
			>
				{#each places as p (p.id)}
					<option value={String(p.id)}>{p.name}</option>
				{/each}
			</select>
			<FieldError field="placeId" reason={errors.placeId} />
		</div>
		<div>
			<label class={input.label} for="correct-reason">訂正理由</label>
			<textarea
				id="correct-reason"
				name="reason"
				class={input.textarea}
				maxlength={CORRECTION_REASON_MAX}
				bind:value={reason}
				aria-invalid={!!errors.reason || undefined}></textarea>
			{#if errors.reason}
				<FieldError field="reason" reason={errors.reason} />
			{:else}
				<p class={input.help}>訂正は履歴に残り、元の値も履歴から確認できます。</p>
			{/if}
		</div>
	</form>
	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button type="submit" form={formId} class={btn.danger} disabled={busy}>訂正する</button>
	{/snippet}
</Dialog>
