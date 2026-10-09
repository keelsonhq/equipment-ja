<script lang="ts">
	import Plus from '@lucide/svelte/icons/plus';
	import type { MasterEntry } from '#lib/server/domain/masters.ts';
	import { sendJson } from '#lib/api.ts';
	import FieldError from '#lib/components/ui/FieldError.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import TableState from '#lib/components/ui/TableState.svelte';
	import Tabs from '#lib/components/ui/Tabs.svelte';
	import PageTitle from '#lib/components/PageTitle.svelte';
	import { focusFirstInvalid, splitError } from '#lib/forms.ts';
	import { loader } from '#lib/state/loader.svelte.ts';
	import { loadMasters } from '#lib/state/masters.svelte.ts';
	import { messageFor } from '#lib/messages.ts';
	import { showErrorToast, showToast } from '#lib/state/toast.svelte.ts';
	import { btn, input, table } from '#lib/ui.ts';
	import { MASTER_NAME_MAX } from '#lib/limits.ts';

	const T = {
		added: '追加しました。',
		saved: '保存しました。',
		tabs: { types: '種類', places: '使用場所' },
		usage: { types: '物品', places: '支給中' },
	};

	type Kind = 'types' | 'places';

	let tab = $state<Kind>('types');
	let newName = $state('');
	let editingId = $state<number | null>(null);
	let editName = $state('');
	// Field error (`name`) of the add form and of the row being renamed.
	let addError = $state<string | null>(null);
	let editError = $state<string | null>(null);
	let busy = $state(false);
	let addForm: HTMLFormElement | undefined = $state();
	let tableEl: HTMLTableElement | undefined = $state();

	const entries = loader<MasterEntry[]>(() => `/api/masters/${tab}`, { keepPreviousData: true });
	// Header cells below: keep in step with the <th>s.
	const COLS = 4;

	// Another tab starts with nothing being added or renamed.
	function selectTab(next: Kind) {
		if (next === tab) {
			return;
		}
		tab = next;
		editingId = null;
		newName = '';
		addError = null;
		editError = null;
	}

	// A failed save: the name's problem goes under the input, anything else
	// to a toast.
	function failed(err: unknown): string | null {
		const { fields, general } = splitError(err, ['name']);
		if (general) {
			showErrorToast(messageFor(general).title);
		}
		return fields.name ?? null;
	}

	async function add(e: SubmitEvent) {
		e.preventDefault();
		addError = newName.trim() === '' ? 'required' : null;
		if (addError) {
			void focusFirstInvalid(addForm);
			return;
		}
		busy = true;
		try {
			await sendJson('POST', `/api/masters/${tab}`, { name: newName });
			newName = '';
			showToast(T.added);
			await Promise.all([entries.reload(), loadMasters(true)]);
		} catch (err) {
			addError = failed(err);
			void focusFirstInvalid(addForm);
		} finally {
			busy = false;
		}
	}

	// Save a change to one entry. Once saved, no row is being renamed any more.
	async function save(id: number, change: { name: string } | { active: boolean }) {
		await sendJson('PATCH', `/api/masters/${tab}/${id}`, change);
		editingId = null;
		editError = null;
		showToast(T.saved);
		await Promise.all([entries.reload(), loadMasters(true)]);
	}

	async function rename(id: number) {
		editError = editName.trim() === '' ? 'required' : null;
		if (editError) {
			void focusFirstInvalid(tableEl);
			return;
		}
		busy = true;
		try {
			await save(id, { name: editName });
		} catch (err) {
			editError = failed(err);
			void focusFirstInvalid(tableEl);
		} finally {
			busy = false;
		}
	}

	async function setActive(id: number, active: boolean) {
		busy = true;
		try {
			await save(id, { active });
		} catch (err) {
			failed(err);
		} finally {
			busy = false;
		}
	}

	function startEdit(row: MasterEntry) {
		editingId = row.id;
		editName = row.name;
		editError = null;
	}
</script>

<PageTitle title="マスタ管理" />

<PageHeader title="マスタ管理" />

<div class="px-6 py-4 space-y-8 max-w-3xl max-md:px-4">
	<section class="space-y-3">
		<Tabs
			testid="masters-tab"
			tabs={[
				{ key: 'types', label: T.tabs.types },
				{ key: 'places', label: T.tabs.places },
			]}
			bind:selected={() => tab, selectTab}
		>
			<div class="space-y-3">
				<p class="text-xs text-ink-muted">
					{#if tab === 'types'}
						物品の種類です。使わなくなった種類は無効にすると、新しい登録の選択肢から外れます。登録済みの物品の表示はそのまま残ります。
					{:else}
						支給するときに選ぶ使用場所(オフィス・在宅など)です。未割当の物品を置く保管場所とは別です。
					{/if}
				</p>
				<div class={table.wrapPlain}>
					<table class={table.table} bind:this={tableEl}>
						<thead class={table.thead}>
							<tr class={table.headRow}>
								<th class={table.th}>名称</th>
								<th class="{table.thRight} w-[100px]">{T.usage[tab]}</th>
								<th class="{table.th} w-[80px]">状態</th>
								<th class="{table.thRight} w-[200px]"><span class="sr-only">操作</span></th>
							</tr>
						</thead>
						<tbody>
							{#if entries.loading && !entries.data}
								<TableState state="loading" cols={COLS} />
							{:else if entries.error}
								<TableState
									state="error"
									cols={COLS}
									error={entries.error}
									onretry={entries.reload}
								/>
							{:else if entries.data}
								{#each entries.data as row (row.id)}
									<tr data-testid="master-row" class={table.row}>
										<td class={table.td}>
											{#if editingId === row.id}
												<input
													data-testid="master-edit-name"
													type="text"
													class="{input.textSm} w-full"
													maxlength={MASTER_NAME_MAX}
													bind:value={editName}
													aria-label="新しい名称"
													aria-invalid={!!editError || undefined}
													oninput={() => (editError = null)}
													onkeydown={(e) => {
														if (e.key === 'Enter') rename(row.id);
														if (e.key === 'Escape') editingId = null;
													}}
												/>
												<FieldError field="name" reason={editError} />
											{:else}
												<span class={row.active ? 'text-ink' : 'text-ink-faint'}>{row.name}</span>
											{/if}
										</td>
										<td class={table.tdNum}>{row.usage}</td>
										<td
											class="{table.td} text-(length:--meta-text) {row.active
												? 'text-ink-muted'
												: 'text-ink-faint'}">{row.active ? '有効' : '無効'}</td
										>
										<td class="{table.td} text-right">
											{#if editingId === row.id}
												<button
													data-testid="master-save"
													type="button"
													class={btn.ghostSm}
													disabled={busy}
													onclick={() => rename(row.id)}>保存</button
												>
												<button type="button" class={btn.ghostSm} onclick={() => (editingId = null)}
													>キャンセル</button
												>
											{:else}
												<button
													data-testid="master-rename"
													type="button"
													class={btn.ghostSm}
													onclick={() => startEdit(row)}>名前を変更</button
												>
												<button
													type="button"
													class={btn.ghostSm}
													disabled={busy}
													onclick={() => setActive(row.id, !row.active)}
													>{row.active ? '無効にする' : '有効にする'}</button
												>
											{/if}
										</td>
									</tr>
								{:else}
									<TableState state="empty" cols={COLS}>
										{#snippet empty()}登録されている{T.tabs[tab]}はありません。{/snippet}
									</TableState>
								{/each}
							{/if}
							<tr>
								<td colspan={COLS} class="px-4 py-2">
									<form
										class="flex items-start gap-2"
										onsubmit={add}
										bind:this={addForm}
										novalidate
									>
										<div class="w-64 max-sm:w-full">
											<input
												data-testid="master-add-name"
												type="text"
												class="{input.textSm} w-full"
												maxlength={MASTER_NAME_MAX}
												placeholder={tab === 'types' ? '例: タブレット' : '例: サテライトオフィス'}
												aria-label="追加する名称"
												aria-invalid={!!addError || undefined}
												bind:value={newName}
												oninput={() => (addError = null)}
											/>
											<FieldError field="name" reason={addError} />
										</div>
										<button
											data-testid="master-add"
											type="submit"
											class={btn.ghost}
											disabled={busy}
										>
											<Plus class="size-4 stroke-[1.5]" />追加
										</button>
									</form>
								</td>
							</tr>
						</tbody>
					</table>
				</div>
			</div>
		</Tabs>
	</section>
</div>
