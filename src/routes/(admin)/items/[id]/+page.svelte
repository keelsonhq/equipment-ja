<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { page } from '$app/state';
	import type { AssignmentView } from '#lib/server/domain/assignments.ts';
	import type { EventView } from '#lib/server/domain/events.ts';
	import type { ItemView } from '#lib/server/domain/items.ts';
	import { errorCode, getJson, sendJson } from '#lib/api.ts';
	import AssetTag from '#lib/components/items/AssetTag.svelte';
	import AssignmentLedger from '#lib/components/assignments/AssignmentLedger.svelte';
	import AttachmentList from '#lib/components/items/AttachmentList.svelte';
	import CorrectDialog from '#lib/components/assignments/CorrectDialog.svelte';
	import Empty from '#lib/components/ui/Empty.svelte';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import EventsTable from '#lib/components/events/EventsTable.svelte';
	import IssueDialog from '#lib/components/assignments/IssueDialog.svelte';
	import ItemFormDialog, { ITEM_FIELD_LABELS } from '#lib/components/items/ItemFormDialog.svelte';
	import Menu from '#lib/components/ui/Menu.svelte';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';
	import Person from '#lib/components/people/Person.svelte';
	import ReturnDialog from '#lib/components/assignments/ReturnDialog.svelte';
	import StatusChip, { REASON_LABELS } from '#lib/components/items/StatusChip.svelte';
	import SuspendDialog from '#lib/components/items/SuspendDialog.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import { formatDateTime } from '#lib/format.ts';
	import { messageFor } from '#lib/messages.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { showErrorToast, showToast } from '#lib/state/toast.svelte.ts';
	import { btn, menu, section } from '#lib/ui.ts';
	import { returnTargetOfItem } from '#lib/components/assignments/returnTarget.ts';
	import PageTitle from '#lib/components/PageTitle.svelte';

	const T = {
		resumed: '利用を再開しました。',
	};

	type Tab = 'ledger' | 'history' | 'attachments';

	const itemId = $derived(Number(page.params.id));
	let tab = $state<Tab>('ledger');
	let stampId = $state<string | null>(null);

	let issuing = $state(false);
	let returning = $state(false);
	let editing = $state(false);
	let suspending = $state(false);
	let correcting = $state<AssignmentView | null>(null);

	// The item, its assignment ledger and its history, read together so the
	// three always agree.
	const detail = loader(() => `/api/items/${itemId}`, {
		fetch: async (url) => {
			const [item, ledger, events] = await Promise.all([
				getJson<ItemView>(url),
				getJson<AssignmentView[]>(`${url}/assignments`),
				getJson<EventView[]>(`${url}/events`),
			]);
			return { item, ledger, events };
		},
	});
	const item = $derived(detail.data?.item ?? null);
	const ledger = $derived(detail.data?.ledger ?? []);
	const events = $derived(detail.data?.events ?? []);

	// Another item starts without the stamp of a return made here.
	$effect(() => {
		void itemId;
		stampId = null;
	});

	async function resume() {
		try {
			await sendJson('POST', `/api/items/${itemId}/resume`);
			showToast(T.resumed);
		} catch (err) {
			showErrorToast(messageFor(errorCode(err)).title);
		}
		await detail.reload();
	}

	const current = $derived(ledger.find((a) => a.returnedOn === null) ?? null);
	const today = $derived(session.me?.today ?? '');
</script>

<PageTitle title={item ? `${item.assetTag} ${item.name}` : '物品'} />

{#if detail.error}
	<ErrorBox code={detail.error} onretry={detail.reload} />
{:else if !item}
	<PageLoading />
{:else}
	<header
		class="flex items-start justify-between gap-4 px-6 py-4 border-b border-rule max-md:flex-col max-md:px-4"
	>
		<div class="flex flex-wrap items-center gap-3 min-w-0">
			<AssetTag tag={item.assetTag} large />
			<h1 data-testid="item-title" class="text-xl font-semibold tracking-tight text-ink">
				{item.name}
			</h1>
			<StatusChip status={item.status} reason={item.suspendedReason} />
		</div>
		<div class="flex items-center gap-2 shrink-0">
			{#if current}
				<button type="button" class={btn.primary} onclick={() => (returning = true)}
					>返却を記録</button
				>
			{:else if !item.suspendedReason}
				<button type="button" class={btn.primary} onclick={() => (issuing = true)}>支給する</button>
			{/if}
			<button type="button" class={btn.secondary} onclick={() => (editing = true)}>編集</button>
			<Menu>
				{#snippet trigger(props)}
					<button
						{...props}
						data-testid="item-menu"
						class={btn.ghostIcon}
						aria-label="その他の操作"
					>
						<Ellipsis class="size-4 stroke-[1.5]" />
					</button>
				{/snippet}
				{#if item.suspendedReason}
					<button data-testid="item-resume" type="button" class={menu.item} onclick={resume}
						>利用を再開</button
					>
				{:else}
					<button
						data-testid="item-suspend"
						type="button"
						class={menu.item}
						onclick={() => (suspending = true)}>利用停止にする</button
					>
				{/if}
				{#if ledger[0]}
					<button type="button" class={menu.danger} onclick={() => (correcting = ledger[0])}
						>記録を訂正</button
					>
				{/if}
			</Menu>
		</div>
	</header>

	<div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 px-6 py-4 max-md:px-4">
		<dl class="text-sm max-w-2xl">
			<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
				<dt class="text-ink-muted">{ITEM_FIELD_LABELS.typeId}</dt>
				<dd data-testid="item-attr-type" class="text-ink">
					{#if item.typeName}{item.typeName}{:else}<Empty />{/if}
				</dd>
			</div>
			<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
				<dt class="text-ink-muted">{ITEM_FIELD_LABELS.serialNo}</dt>
				<dd data-testid="item-attr-serial" class="text-ink font-mono tabular-nums">
					{#if item.serialNo}{item.serialNo}{:else}<Empty />{/if}
				</dd>
			</div>
			<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
				<dt class="text-ink-muted">{ITEM_FIELD_LABELS.purchasedOn}</dt>
				<dd data-testid="item-attr-purchased" class="text-ink font-mono tabular-nums">
					{#if item.purchasedOn}{item.purchasedOn}{:else}<Empty />{/if}
				</dd>
			</div>
			<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
				<dt class="text-ink-muted">{ITEM_FIELD_LABELS.storageLocation}</dt>
				<dd data-testid="item-attr-storage" class="text-ink">
					{#if item.storageLocation}{item.storageLocation}{:else}<Empty />{/if}
				</dd>
			</div>
			<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
				<dt class="text-ink-muted">{ITEM_FIELD_LABELS.note}</dt>
				<dd data-testid="item-attr-note" class="text-ink whitespace-pre-wrap">
					{#if item.note}{item.note}{:else}<Empty />{/if}
				</dd>
			</div>
			<div class="grid grid-cols-[7rem_1fr] gap-x-4 py-2 border-b border-rule last:border-0">
				<dt class="text-ink-muted">更新</dt>
				<dd class="font-mono text-xs text-ink-muted tabular-nums">
					{formatDateTime(item.updatedAt)}
				</dd>
			</div>
		</dl>

		<section
			class="border border-rule rounded-sm bg-surface p-4 self-start"
			aria-labelledby="current-title"
		>
			<h2 id="current-title" class="{section.heading} mb-3">現在の割当</h2>
			{#if item.suspendedReason}
				<div class="mb-3 rounded-xs border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
					<p class="font-medium">
						利用停止: {REASON_LABELS[item.suspendedReason]}
					</p>
					{#if item.suspendedNote}<p class="mt-1">{item.suspendedNote}</p>{/if}
				</div>
			{/if}
			{#if current}
				<dl class="space-y-2 text-sm">
					<div>
						<dt class="sr-only">社員</dt>
						<dd>
							<a
								data-testid="current-holder"
								class="hover:underline underline-offset-2"
								href="/members/{encodeURIComponent(current.userId)}"
								><Person
									name={current.userName}
									former={current.userMembership === 'former'}
									imageUrl={current.userImageUrl}
								/></a
							>
						</dd>
					</div>
					<div class="flex gap-4">
						<dt class="w-20 text-xs text-ink-muted">使用場所</dt>
						<dd>{current.placeName ?? ''}</dd>
					</div>
					<div class="flex gap-4">
						<dt class="w-20 text-xs text-ink-muted">支給日</dt>
						<dd class="font-mono tabular-nums">{current.issuedOn}</dd>
					</div>
					{#if current.dueOn}
						<div class="flex gap-4">
							<dt class="w-20 text-xs text-ink-muted">返却予定日</dt>
							<dd class="font-mono tabular-nums {current.dueOn < today ? 'text-seal' : ''}">
								{current.dueOn}
							</dd>
						</div>
					{/if}
					{#if current.pendingReturn}
						<p class="text-xs text-ink-muted">交換済み。実際の返却を記録するまで返却待ちです。</p>
					{/if}
				</dl>
				<button type="button" class="{btn.primarySm} mt-3" onclick={() => (returning = true)}
					>返却</button
				>
			{:else}
				<p class="text-sm text-ink-muted">未割当</p>
				{#if !item.suspendedReason}
					<button type="button" class="{btn.primarySm} mt-3" onclick={() => (issuing = true)}
						>支給</button
					>
				{/if}
			{/if}
		</section>
	</div>

	<div class="px-6 pb-8 max-md:px-4">
		<Tabs
			testid="item-tab"
			tabs={[
				{ key: 'ledger', label: '割当台帳', count: ledger.length },
				{ key: 'history', label: '履歴', count: events.length },
				{ key: 'attachments', label: '添付' },
			]}
			bind:selected={tab}
		>
			{#if tab === 'ledger'}
				<AssignmentLedger
					rows={ledger}
					variant="item"
					{stampId}
					oncorrect={(a) => (correcting = a)}
				/>
			{:else if tab === 'history'}
				<EventsTable rows={events} showTarget={false} plain />
			{:else}
				<AttachmentList {itemId} />
			{/if}
		</Tabs>
	</div>

	{#if issuing}
		<IssueDialog
			{item}
			onclose={() => (issuing = false)}
			ondone={() => {
				issuing = false;
				void detail.reload();
			}}
			onconflict={detail.reload}
		/>
	{/if}
	{#if returning}
		<ReturnDialog
			target={returnTargetOfItem(item)}
			onclose={() => (returning = false)}
			ondone={(a) => {
				returning = false;
				stampId = a.id;
				tab = 'ledger';
				void detail.reload();
			}}
		/>
	{/if}
	{#if editing}
		<ItemFormDialog
			{item}
			onclose={() => (editing = false)}
			ondone={() => {
				editing = false;
				void detail.reload();
			}}
		/>
	{/if}
	{#if suspending}
		<SuspendDialog
			{item}
			onclose={() => (suspending = false)}
			ondone={() => {
				suspending = false;
				void detail.reload();
			}}
		/>
	{/if}
	{#if correcting}
		<CorrectDialog
			assignment={correcting}
			onclose={() => (correcting = null)}
			ondone={() => {
				correcting = null;
				void detail.reload();
			}}
		/>
	{/if}
{/if}
