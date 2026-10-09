<script module lang="ts">
	import type { ItemFields } from '#lib/server/domain/items.ts';

	const T = {
		fields: {
			assetTag: '管理番号',
			name: '物品名',
			typeId: '種類',
			serialNo: '製造番号',
			purchasedOn: '購入日',
			storageLocation: '保管場所',
			note: '備考',
		},
		created: '登録しました。',
		createdIssued: '登録して支給しました。',
		saved: '保存しました。',
	};

	/**
	 * The name of each item field. The ledger's columns, the import preview, the
	 * history's edit lines and the item page use it too.
	 */
	export const ITEM_FIELD_LABELS: Record<keyof ItemFields, string> = T.fields;
</script>

<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { ItemView } from '#lib/server/domain/items.ts';
	import { sendJson } from '#lib/api.ts';
	import {
		check,
		type FieldErrors,
		focusFirstInvalid,
		hasErrors,
		splitError,
		withoutEdited,
	} from '#lib/forms.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { masters } from '#lib/state/masters.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { showToast } from '#lib/state/toast.svelte.ts';
	import { btn, input } from '#lib/ui.ts';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import IssueFields from '#lib/components/assignments/IssueFields.svelte';
	import {
		issueBody,
		issueChecks,
		issueFieldNames,
		newIssue,
	} from '#lib/components/assignments/issueForm.ts';
	import { ITEM_LIMITS } from '#lib/limits.ts';

	// Register a new item, or edit one (admin, DESIGN.md §9-E). The asset tag is
	// the company's own management number, separate from the manufacturer's
	// serial number. When registering, the item can be issued in the same step
	// (one transaction on the server), and "save and continue" keeps the dialog
	// open for the next item.
	let {
		onclose,
		ondone,
		onsaved,
		item = null,
	}: {
		onclose: () => void;
		ondone: (item: ItemView) => void;
		/** Called after each "save and continue" (the dialog stays open). */
		onsaved?: (item: ItemView) => void;
		item?: ItemView | null;
	} = $props();

	// Unique per instance: the submit buttons sit in the dialog footer, outside
	// the form, and must never reach the form of another dialog on the page.
	const uid = $props.id();
	const formId = `${uid}-form`;

	const today = $derived(session.me?.today ?? '');

	// The form starts from the item being edited (empty when registering).
	let assetTag = $state(untrack(() => item?.assetTag ?? ''));
	let name = $state(untrack(() => item?.name ?? ''));
	let typeId = $state(untrack(() => (item?.typeId ? String(item.typeId) : '')));
	let serialNo = $state(untrack(() => item?.serialNo ?? ''));
	let purchasedOn = $state(untrack(() => item?.purchasedOn ?? ''));
	let storageLocation = $state(untrack(() => item?.storageLocation ?? ''));
	let note = $state(untrack(() => item?.note ?? ''));
	let issueToo = $state(false);
	// "Issue on registration": the person, place, dates and note.
	let issue = $state(untrack(() => newIssue(today)));
	let error = $state<string | null>(null);
	let errors = $state<FieldErrors>({});
	let busy = $state(false);
	let tagInput: HTMLInputElement | undefined = $state();
	// The person combobox keeps its own text; remount the issue fields to clear it.
	let personKey = $state(0);
	// Storage places already used, offered while typing.
	const locations = loader<string[]>(() => '/api/items/storage-locations');

	// Active types, plus the item's current one even if deactivated.
	const types = $derived(masters.types.filter((t) => t.active || t.id === item?.typeId));
	const creating = $derived(item === null);
	const issuing = $derived(creating && issueToo);

	const ITEM_FIELDS = [
		'assetTag',
		'name',
		'typeId',
		'serialNo',
		'purchasedOn',
		'storageLocation',
		'note',
	];
	// The issue block's fields are nested under `assignment` in the request.
	const ISSUE = { prefix: 'assignment.' };

	function validate(): FieldErrors {
		return check({
			assetTag: assetTag.trim() === '' && 'required',
			name: name.trim() === '' && 'required',
			...(issuing ? issueChecks(issue, today, ISSUE) : {}),
		});
	}

	// "Save and continue": the dialog stays open for the next item. Keep the
	// type, the storage place and "issue too", clear the rest.
	async function nextItem() {
		assetTag = '';
		name = '';
		serialNo = '';
		purchasedOn = '';
		note = '';
		issue = newIssue(today);
		personKey += 1;
		await tick();
		tagInput?.focus();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		const again = (e.submitter as HTMLButtonElement | null)?.value === 'continue';
		error = null;
		errors = validate();
		if (hasErrors(errors)) {
			void focusFirstInvalid();
			return;
		}
		busy = true;
		const body = {
			assetTag,
			name,
			typeId: typeId ? Number(typeId) : null,
			serialNo,
			purchasedOn: purchasedOn || null,
			storageLocation,
			note,
		};
		try {
			if (item) {
				const saved = await sendJson<ItemView>('PATCH', `/api/items/${item.id}`, {
					...body,
					version: item.version,
				});
				showToast(T.saved);
				ondone(saved);
				return;
			}
			const assignment = issuing ? { userId: issue.person?.id, ...issueBody(issue) } : null;
			const saved = await sendJson<ItemView>('POST', '/api/items', { ...body, assignment });
			showToast(issuing ? T.createdIssued : T.created);
			if (again) {
				onsaved?.(saved);
				await nextItem();
			} else {
				ondone(saved);
			}
		} catch (err) {
			({ fields: errors, general: error } = splitError(err, [
				...ITEM_FIELDS,
				...(issuing ? issueFieldNames(ISSUE) : []),
			]));
			void focusFirstInvalid();
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title={item ? '物品を編集' : '物品を登録'} {onclose} {error} wide>
	<form
		id={formId}
		data-testid="item-form"
		class="space-y-4"
		onsubmit={submit}
		oninput={(e) => (errors = withoutEdited(errors, e))}
		novalidate
	>
		<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
			<div>
				<label class={input.label} for="item-tag">{T.fields.assetTag}</label>
				<input
					bind:this={tagInput}
					id="item-tag"
					name="assetTag"
					type="text"
					class="{input.text} font-mono tabular-nums"
					maxlength={ITEM_LIMITS.assetTag}
					placeholder="PC-0101"
					bind:value={assetTag}
					aria-invalid={!!errors.assetTag || undefined}
				/>
				{#if errors.assetTag}
					<FieldError field="assetTag" reason={errors.assetTag} />
				{:else}
					<p class={input.help}>社内で付ける番号。製造番号とは別です。</p>
				{/if}
			</div>
			<div>
				<label class={input.label} for="item-type"
					>{T.fields.typeId} <span class="text-ink-faint">(任意)</span></label
				>
				<select
					id="item-type"
					name="typeId"
					class={input.select}
					bind:value={typeId}
					aria-invalid={!!errors.typeId || undefined}
				>
					<option value="">未設定</option>
					{#each types as t (t.id)}
						<option value={String(t.id)}>{t.name}</option>
					{/each}
				</select>
				<FieldError field="typeId" reason={errors.typeId} />
			</div>
		</div>
		<div>
			<label class={input.label} for="item-name">{T.fields.name}</label>
			<input
				id="item-name"
				name="name"
				type="text"
				class={input.text}
				maxlength={ITEM_LIMITS.name}
				placeholder="ノートPC 14型 Core Ultra 7 / 32GB"
				bind:value={name}
				aria-invalid={!!errors.name || undefined}
			/>
			<FieldError field="name" reason={errors.name} />
		</div>
		<div class="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
			<div>
				<label class={input.label} for="item-serial"
					>{T.fields.serialNo} <span class="text-ink-faint">(任意)</span></label
				>
				<input
					id="item-serial"
					name="serialNo"
					type="text"
					class="{input.text} font-mono"
					maxlength={ITEM_LIMITS.serialNo}
					bind:value={serialNo}
					aria-invalid={!!errors.serialNo || undefined}
				/>
				<FieldError field="serialNo" reason={errors.serialNo} />
			</div>
			<div>
				<label class={input.label} for="item-purchased"
					>{T.fields.purchasedOn} <span class="text-ink-faint">(任意)</span></label
				>
				<input
					id="item-purchased"
					name="purchasedOn"
					type="date"
					class="{input.text} font-mono tabular-nums"
					bind:value={purchasedOn}
					aria-invalid={!!errors.purchasedOn || undefined}
				/>
				<FieldError field="purchasedOn" reason={errors.purchasedOn} />
			</div>
		</div>
		<div>
			<label class={input.label} for="item-storage"
				>{T.fields.storageLocation} <span class="text-ink-faint">(任意)</span></label
			>
			<input
				id="item-storage"
				name="storageLocation"
				type="text"
				class={input.text}
				list="item-storage-list"
				maxlength={ITEM_LIMITS.storageLocation}
				placeholder="本社 3F 備品庫"
				bind:value={storageLocation}
				aria-invalid={!!errors.storageLocation || undefined}
			/>
			<datalist id="item-storage-list">
				{#each locations.data ?? [] as loc (loc)}<option value={loc}></option>{/each}
			</datalist>
			{#if errors.storageLocation}
				<FieldError field="storageLocation" reason={errors.storageLocation} />
			{:else}
				<p class={input.help}>
					未割当のときに置いておく場所。支給中の使用場所(オフィス・在宅など)とは別です。
				</p>
			{/if}
		</div>
		<div>
			<label class={input.label} for="item-note"
				>{T.fields.note} <span class="text-ink-faint">(任意)</span></label
			>
			<textarea
				id="item-note"
				name="note"
				class={input.textarea}
				maxlength={ITEM_LIMITS.note}
				bind:value={note}
				aria-invalid={!!errors.note || undefined}></textarea>
			<FieldError field="note" reason={errors.note} />
		</div>

		{#if creating}
			<fieldset class="border-t border-rule pt-4 space-y-4">
				<label class="inline-flex items-center gap-2 text-sm font-medium text-ink">
					<input
						data-testid="item-form-issue"
						type="checkbox"
						class={input.checkbox}
						bind:checked={issueToo}
					/>登録と同時に支給する
				</label>
				{#if issueToo}
					{#key personKey}
						<IssueFields
							bind:values={issue}
							bind:errors
							prefix={ISSUE.prefix}
							noteLabel="支給の備考"
						/>
					{/key}
				{/if}
			</fieldset>
		{/if}
	</form>
	{#snippet footer()}
		<button data-testid="item-form-cancel" type="button" class={btn.secondary} onclick={onclose}
			>キャンセル</button
		>
		{#if creating}
			<button
				data-testid="item-form-continue"
				type="submit"
				form={formId}
				value="continue"
				class={btn.secondary}
				disabled={busy}>保存して続けて登録</button
			>
			<button
				data-testid="item-form-submit"
				type="submit"
				form={formId}
				class={btn.primary}
				disabled={busy}
			>
				{issueToo ? '登録して支給する' : '登録する'}
			</button>
		{:else}
			<button type="submit" form={formId} class={btn.primary} disabled={busy}>保存する</button>
		{/if}
	{/snippet}
</Dialog>
