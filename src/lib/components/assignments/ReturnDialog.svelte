<script lang="ts">
	import { untrack } from 'svelte';
	import type { AssignmentView } from '#lib/server/domain/assignments.ts';
	import type { ItemView } from '#lib/server/domain/items.ts';
	import { sendJson } from '#lib/api.ts';
	import {
		check,
		dateProblem,
		type FieldErrors,
		focusFirstInvalid,
		hasErrors,
		splitError,
		without,
		withoutEdited,
	} from '#lib/forms.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import ItemPicker from '#lib/components/items/ItemPicker.svelte';
	import { REASON_LABELS } from '#lib/components/items/StatusChip.svelte';
	import { type ReturnTarget, returnTargetOfItem } from './returnTarget.ts';
	import { ITEM_LIMITS, RETURN_NOTE_MAX, SUSPEND_NOTE_MAX } from '#lib/limits.ts';

	const T = {
		returned: '返却を記録しました。',
	};

	// Record a return (DESIGN.md §9-E). Admins also choose where the item
	// is stored and may suspend it if it needs repair; members record the date
	// and a note only.
	let {
		onclose,
		ondone,
		target,
		pick = false,
	}: {
		onclose: () => void;
		ondone: (a: AssignmentView) => void;
		target: ReturnTarget | null;
		/** No fixed target: choose a held item first (home screen). */
		pick?: boolean;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	const today = $derived(session.me?.today ?? '');
	const isAdmin = $derived(session.me?.isAdmin ?? false);

	let picked = $state<ItemView | null>(null);
	const current = $derived(target ?? (picked ? returnTargetOfItem(picked) : null));

	let returnedOn = $state(untrack(() => today));
	let storageLocation = $state(untrack(() => target?.storageLocation ?? ''));
	let condition = $state<'ok' | 'repair'>('ok');
	let reason = $state('repair');
	let reasonNote = $state('');
	let note = $state('');
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);
	// Places already used, offered while typing (admins only).
	const locations = loader<string[]>(() => (isAdmin ? '/api/items/storage-locations' : null));

	function onpick(item: ItemView) {
		storageLocation = item.storageLocation ?? '';
		errors = without(errors, 'itemId');
	}

	const shown = [
		'itemId',
		'returnedOn',
		'note',
		'storageLocation',
		'suspend.reason',
		'suspend.note',
	];

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		errors = check({
			itemId: !current && 'required',
			returnedOn: dateProblem(returnedOn, { today, notBefore: current?.issuedOn }),
		});
		if (hasErrors(errors) || !current) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		try {
			const a = await sendJson<AssignmentView>(
				'POST',
				`/api/assignments/${encodeURIComponent(current.assignmentId)}/return`,
				{
					returnedOn,
					note,
					storageLocation: isAdmin && storageLocation.trim() ? storageLocation : null,
					suspend: isAdmin && condition === 'repair' ? { reason, note: reasonNote } : null,
				},
			);
			showToast(T.returned);
			ondone(a);
		} catch (err) {
			({ fields: errors, general: error } = splitError(err, shown));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="返却を記録" {onclose} {error}>
	<form
		id={formId}
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		{#if pick && !target}
			<div>
				<label class={input.label} for="return-item">物品</label>
				<ItemPicker
					id="return-item"
					scope="held"
					bind:selected={picked}
					invalid={!!errors.itemId}
					onselect={onpick}
				/>
				<FieldError field="itemId" reason={errors.itemId} />
			</div>
		{/if}
		{#if current}
			<div class="flex items-center gap-2 text-sm">
				<AssetTag tag={current.assetTag} />
				<span class="font-medium truncate">{current.itemName}</span>
				<span class="ml-auto text-xs text-ink-muted whitespace-nowrap">{current.userName}</span>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<label class={input.label} for="return-date">返却日</label>
					<input
						id="return-date"
						name="returnedOn"
						type="date"
						class="{input.text} font-mono tabular-nums"
						min={current.issuedOn}
						max={today}
						bind:value={returnedOn}
						aria-invalid={!!errors.returnedOn || undefined}
					/>
					<FieldError field="returnedOn" reason={errors.returnedOn} />
				</div>
			</div>

			{#if isAdmin}
				<div>
					<label class={input.label} for="return-storage"
						>保管場所 <span class="text-ink-faint">(任意)</span></label
					>
					<input
						id="return-storage"
						name="storageLocation"
						type="text"
						class={input.text}
						list="return-storage-list"
						maxlength={ITEM_LIMITS.storageLocation}
						placeholder="例: 本社 3F 備品庫"
						bind:value={storageLocation}
						aria-invalid={!!errors.storageLocation || undefined}
					/>
					<FieldError field="storageLocation" reason={errors.storageLocation} />
					<datalist id="return-storage-list">
						{#each locations.data ?? [] as loc (loc)}<option value={loc}></option>{/each}
					</datalist>
				</div>

				<fieldset>
					<legend class={input.label}>状態</legend>
					<div class="flex gap-6 text-sm">
						<label class="inline-flex items-center gap-2">
							<input type="radio" class={input.radio} value="ok" bind:group={condition} />そのまま
						</label>
						<label class="inline-flex items-center gap-2">
							<input type="radio" class={input.radio} value="repair" bind:group={condition} />要修理
						</label>
					</div>
				</fieldset>

				{#if condition === 'repair'}
					<div class="space-y-4 rounded-sm border border-amber-200 bg-amber-50 p-3">
						<p class="text-sm text-amber-800">返却と同時に利用停止にします。</p>
						<div>
							<label class={input.label} for="return-reason">利用停止の理由</label>
							<select
								id="return-reason"
								name="suspend.reason"
								class={input.select}
								bind:value={reason}
								aria-invalid={!!errors['suspend.reason'] || undefined}
							>
								{#each Object.entries(REASON_LABELS) as [value, label] (value)}
									<option {value}>{label}</option>
								{/each}
							</select>
							<FieldError field="suspend.reason" reason={errors['suspend.reason']} />
						</div>
						<div>
							<label class={input.label} for="return-reason-note"
								>理由の詳細 <span class="text-ink-faint">(任意)</span></label
							>
							<input
								id="return-reason-note"
								name="suspend.note"
								type="text"
								class={input.text}
								maxlength={SUSPEND_NOTE_MAX}
								bind:value={reasonNote}
								aria-invalid={!!errors['suspend.note'] || undefined}
							/>
							<FieldError field="suspend.note" reason={errors['suspend.note']} />
						</div>
					</div>
				{/if}
			{/if}

			<div>
				<label class={input.label} for="return-note"
					>備考 <span class="text-ink-faint">(任意)</span></label
				>
				<textarea
					id="return-note"
					name="note"
					class={input.textarea}
					maxlength={RETURN_NOTE_MAX}
					bind:value={note}
					aria-invalid={!!errors.note || undefined}></textarea>
				<FieldError field="note" reason={errors.note} />
			</div>
		{/if}
	</form>

	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button
			data-testid="return-submit"
			type="submit"
			form={formId}
			class={btn.primary}
			disabled={busy}>返却を記録</button
		>
	{/snippet}
</Dialog>
