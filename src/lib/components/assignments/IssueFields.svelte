<script lang="ts">
	import { type FieldErrors, without } from '#lib/forms.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { input } from '#lib/ui.ts';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import MemberCombobox from '#lib/components/people/MemberCombobox.svelte';
	import { ISSUE_NOTE_MAX } from '#lib/limits.ts';
	import { activePlaces, type IssueBlock, type IssueValues } from './issueForm.ts';

	const T = { note: '備考' };

	// The inputs of an issue (DESIGN.md §9-E): the person, the place of use, the
	// issue and due dates and a note. Shared by the issue dialog and "issue on
	// registration" in the register form. The dialog holds the values and the
	// errors; the fields carry `name` = the request's field name, so the form's
	// `oninput` clears an edited field's error. The values' start, checks and
	// request body are in issueForm.ts.
	let {
		values = $bindable(),
		errors = $bindable(),
		prefix = '',
		pickPerson = true,
		noteLabel = T.note,
	}: IssueBlock & {
		values: IssueValues;
		errors: FieldErrors;
		noteLabel?: string;
	} = $props();

	const uid = $props.id();
	const today = $derived(session.me?.today ?? '');
	const places = $derived(activePlaces());
	const field = (name: string) => `${prefix}${name}`;
</script>

{#if pickPerson}
	<div>
		<label class={input.label} for="{uid}-person">社員</label>
		<MemberCombobox
			id="{uid}-person"
			bind:selected={values.person}
			invalid={!!errors[field('userId')]}
			onselect={() => (errors = without(errors, field('userId')))}
		/>
		<FieldError field={field('userId')} reason={errors[field('userId')]} />
	</div>
{/if}

<div>
	<label class={input.label} for="{uid}-place">使用場所</label>
	<select
		id="{uid}-place"
		name={field('placeId')}
		class={input.select}
		bind:value={values.placeId}
		aria-invalid={!!errors[field('placeId')] || undefined}
	>
		{#each places as p (p.id)}
			<option value={String(p.id)}>{p.name}</option>
		{/each}
	</select>
	<FieldError field={field('placeId')} reason={errors[field('placeId')]} />
</div>

<div class="grid grid-cols-2 gap-4">
	<div>
		<label class={input.label} for="{uid}-date">支給日</label>
		<input
			id="{uid}-date"
			name={field('issuedOn')}
			type="date"
			class="{input.text} font-mono tabular-nums"
			max={today}
			bind:value={values.issuedOn}
			aria-invalid={!!errors[field('issuedOn')] || undefined}
		/>
		<FieldError field={field('issuedOn')} reason={errors[field('issuedOn')]} />
	</div>
	<div>
		<label class={input.label} for="{uid}-due"
			>返却予定日 <span class="text-ink-faint">(任意)</span></label
		>
		<input
			id="{uid}-due"
			name={field('dueOn')}
			type="date"
			class="{input.text} font-mono tabular-nums"
			min={values.issuedOn}
			bind:value={values.dueOn}
			aria-invalid={!!errors[field('dueOn')] || undefined}
		/>
		<FieldError field={field('dueOn')} reason={errors[field('dueOn')]} />
	</div>
</div>

<div>
	<label class={input.label} for="{uid}-note"
		>{noteLabel} <span class="text-ink-faint">(任意)</span></label
	>
	<textarea
		id="{uid}-note"
		name={field('note')}
		class={input.textarea}
		maxlength={ISSUE_NOTE_MAX}
		bind:value={values.note}
		aria-invalid={!!errors[field('note')] || undefined}></textarea>
	<FieldError field={field('note')} reason={errors[field('note')]} />
</div>
