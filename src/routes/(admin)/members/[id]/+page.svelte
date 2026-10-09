<script lang="ts">
	import { page } from '$app/state';
	import type { AssignmentView } from '#lib/server/domain/assignments.ts';
	import type { Holding, PersonPage } from '#lib/server/domain/people.ts';
	import AssignmentLedger from '#lib/components/assignments/AssignmentLedger.svelte';
	import CorrectDialog from '#lib/components/assignments/CorrectDialog.svelte';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import HoldingsTable from '#lib/components/assignments/HoldingsTable.svelte';
	import IssueDialog from '#lib/components/assignments/IssueDialog.svelte';
	import NameCard from '#lib/components/people/NameCard.svelte';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';
	import ReturnDialog from '#lib/components/assignments/ReturnDialog.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { loader } from '#lib/state/loader.svelte.ts';
	import {
		returnTargetOfHolding,
		type ReturnTarget,
	} from '#lib/components/assignments/returnTarget.ts';
	import { btn, section } from '#lib/ui.ts';

	// A person's page (DESIGN.md §9-C, the face of this app): name tag, what they
	// hold now and what they still owe back, and their full ledger.
	const userId = $derived(page.params.id ?? '');
	let issuing = $state(false);
	let exchanging = $state(false);
	let returnTarget = $state<ReturnTarget | null>(null);
	let correcting = $state<AssignmentView | null>(null);
	let stampId = $state<string | null>(null);

	const person = loader<PersonPage>(() => `/api/members/${encodeURIComponent(userId)}`);
	const data = $derived(person.data);

	// Another person starts without the stamp of a return made here.
	$effect(() => {
		void userId;
		stampId = null;
	});

	function openReturn(h: Holding) {
		if (!data) return;
		returnTarget = returnTargetOfHolding(h, data.person.name);
	}

	const held = $derived(data?.holdings.filter((h) => !h.pendingReturn).length ?? 0);
	const pending = $derived(data?.holdings.filter((h) => h.pendingReturn).length ?? 0);
</script>

<PageTitle title={data?.person.name ?? '社員'} />

{#if person.error}
	<ErrorBox code={person.error} onretry={person.reload} />
{:else if !data}
	<PageLoading />
{:else}
	<NameCard
		name={data.person.name}
		email={data.person.email}
		former={data.person.membership === 'former'}
		imageUrl={data.person.imageUrl}
		assigned={held}
		{pending}
	>
		{#snippet actions()}
			{#if data?.person.membership !== 'former'}
				<button type="button" class={btn.primary} onclick={() => (issuing = true)}>支給</button>
				<button
					data-testid="member-exchange"
					type="button"
					class={btn.secondary}
					onclick={() => (exchanging = true)}>交換</button
				>
			{/if}
		{/snippet}
	</NameCard>

	<div class="px-6 py-4 space-y-6 max-md:px-4">
		<HoldingsTable holdings={data.holdings} linkItems onreturn={openReturn} />
		<section class="space-y-3">
			<h2 class={section.heading}>割当台帳</h2>
			<AssignmentLedger
				rows={data.ledger}
				variant="person"
				{stampId}
				oncorrect={(a) => (correcting = a)}
			/>
		</section>
	</div>

	{#if issuing || exchanging}
		<IssueDialog
			recipient={data.person}
			exchangeHoldings={exchanging ? data.holdings : null}
			onclose={() => {
				issuing = false;
				exchanging = false;
			}}
			ondone={() => {
				issuing = false;
				exchanging = false;
				void person.reload();
			}}
		/>
	{/if}
	{#if returnTarget}
		<ReturnDialog
			target={returnTarget}
			onclose={() => (returnTarget = null)}
			ondone={(a) => {
				returnTarget = null;
				stampId = a.id;
				void person.reload();
			}}
		/>
	{/if}
	{#if correcting}
		<CorrectDialog
			assignment={correcting}
			onclose={() => (correcting = null)}
			ondone={() => {
				correcting = null;
				void person.reload();
			}}
		/>
	{/if}
{/if}
