<script lang="ts">
	import { untrack } from 'svelte';
	import type { AssignmentView } from '#lib/server/domain/assignments.ts';
	import type { AvailableItem } from '#lib/server/domain/items.ts';
	import type { Holding } from '#lib/server/domain/people.ts';
	import { sendJson } from '#lib/api.ts';
	import {
		check,
		type FieldErrors,
		focusFirstInvalid,
		hasErrors,
		splitError,
		without,
		withoutEdited,
	} from '#lib/forms.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import type { ItemRef, PersonRef } from '#lib/types.ts';
	import { btn, input } from '#lib/ui.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import ItemPicker from '#lib/components/items/ItemPicker.svelte';
	import IssueFields from './IssueFields.svelte';
	import { issueBody, issueChecks, issueFieldNames, newIssue } from './issueForm.ts';

	const T = {
		issueTitle: '支給する',
		exchangeTitle: '交換する',
		selfTitle: '自分に割り当てる',
		issued: '支給しました。',
		exchanged: '支給しました。交換元は返却待ちです。',
		selfIssued: '自分に割り当てました。',
	};

	// Issue / exchange (DESIGN.md §9-E). The item, the person, or both can
	// be fixed by the screen that opens the dialog; the rest is chosen here.
	// `recipient`: chosen here (null), the user ('self', "assign to me" on my
	// page) or a person the screen fixed. Only with a fixed person can it be an
	// exchange: `exchangeHoldings` is what they hold, to pick the item the new
	// one replaces (null: a plain issue).
	type Recipient =
		| { recipient?: 'self' | null; exchangeHoldings?: null }
		| { recipient: PersonRef; exchangeHoldings?: Holding[] | null };

	let {
		onclose,
		ondone,
		onconflict,
		item = null,
		recipient = null,
		exchangeHoldings = null,
		typeId = null,
	}: Recipient & {
		onclose: () => void;
		ondone: (a: AssignmentView) => void;
		onconflict?: () => void;
		item?: ItemRef | null;
		/** Limit the item picker to one item type (home screen stock table). */
		typeId?: number | null;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	const today = $derived(session.me?.today ?? '');

	let pickedItem = $state<AvailableItem | null>(null);
	// The person (when chosen here), place, dates and note.
	let issue = $state(untrack(() => newIssue(today)));
	// The assignment the new item replaces ('' = none; exchange only).
	let exchangeFromId = $state('');
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);
	let conflicted = $state(false);

	const exchangeable = $derived((exchangeHoldings ?? []).filter((h) => !h.pendingReturn));

	const targetItem = $derived(item ?? pickedItem);
	const pickPerson = $derived(recipient === null);
	// The person the screen fixed; for 'self' the server takes the user.
	const fixedPerson = $derived(recipient === 'self' ? null : recipient);
	const title = $derived.by(() => {
		if (exchangeHoldings !== null) {
			return T.exchangeTitle;
		}
		return recipient === 'self' ? T.selfTitle : T.issueTitle;
	});

	// The toast says what happened: the replaced item waits for its return.
	function doneMessage(): string {
		if (exchangeFromId) {
			return T.exchanged;
		}
		return recipient === 'self' ? T.selfIssued : T.issued;
	}

	// Fields this form shows (server errors for others go to the general box).
	const shown = $derived([
		...(item ? [] : ['itemId']),
		...(exchangeHoldings !== null ? ['exchangeFrom'] : []),
		...issueFieldNames({ pickPerson }),
	]);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		errors = check({
			itemId: !targetItem && 'required',
			...issueChecks(issue, today, { pickPerson }),
		});
		if (hasErrors(errors) || !targetItem) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		try {
			const a = await sendJson<AssignmentView>('POST', '/api/assignments', {
				itemId: targetItem.id,
				userId: fixedPerson?.id ?? issue.person?.id ?? null,
				...issueBody(issue),
				exchangeFrom: exchangeFromId || null,
			});
			showToast(doneMessage());
			ondone(a);
		} catch (err) {
			// The item or the person may be fixed by the screen that opened the
			// dialog; an error on it is shown as the general error.
			({ fields: errors, general: error } = splitError(err, shown, {
				itemId: 'item_not_found',
				userId: 'member_not_found',
			}));
			if (error === 'item_already_assigned' || error === 'item_suspended') {
				conflicted = true;
				onconflict?.();
			}
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog {title} {onclose} {error}>
	<form
		id={formId}
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		{#if item}
			<div class="flex items-center gap-2 text-sm">
				<AssetTag tag={item.assetTag} />
				<span class="font-medium truncate">{item.name}</span>
			</div>
		{/if}
		{#if fixedPerson}
			<div class="flex items-center gap-2 text-sm">
				<Avatar name={fixedPerson.name} imageUrl={fixedPerson.imageUrl} />
				<span class="font-medium">{fixedPerson.name}</span>
				{#if fixedPerson.email}<span class="font-mono text-xs text-ink-muted"
						>{fixedPerson.email}</span
					>{/if}
			</div>
		{/if}

		{#if !item}
			<div>
				<label class={input.label} for="issue-item">物品</label>
				<ItemPicker
					id="issue-item"
					bind:selected={pickedItem}
					{typeId}
					invalid={!!errors.itemId}
					onselect={() => (errors = without(errors, 'itemId'))}
				/>
				<FieldError field="itemId" reason={errors.itemId} />
			</div>
		{/if}

		{#if exchangeHoldings !== null}
			<div>
				<label class={input.label} for="issue-exchange"
					>交換元 <span class="text-ink-faint">(任意)</span></label
				>
				<select
					id="issue-exchange"
					name="exchangeFrom"
					class="{input.select} font-mono"
					bind:value={exchangeFromId}
					aria-invalid={!!errors.exchangeFrom || undefined}
				>
					<option value="">選ばない</option>
					{#each exchangeable as h (h.assignmentId)}
						<option value={h.assignmentId}>{h.assetTag} {h.itemName}</option>
					{/each}
				</select>
				{#if errors.exchangeFrom}
					<FieldError field="exchangeFrom" reason={errors.exchangeFrom} />
				{:else}
					<p class={input.help}>交換元は、実際の返却を記録するまで「返却待ち」として残ります。</p>
				{/if}
			</div>
		{/if}

		<IssueFields bind:values={issue} bind:errors {pickPerson} />
	</form>

	{#snippet footer()}
		<button type="button" class={btn.secondary} onclick={onclose}>キャンセル</button>
		<button
			data-testid="issue-submit"
			type="submit"
			form={formId}
			class={btn.primary}
			disabled={busy || conflicted}>{title}</button
		>
	{/snippet}
</Dialog>
