<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import FileText from '@lucide/svelte/icons/file-text';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import type { AttachmentView } from '#lib/server/domain/attachments.ts';
	import { errorCode, getJson, sendJson, uploadFile } from '#lib/api.ts';
	import { formatBytes, formatDateTime } from '#lib/format.ts';
	import Menu from '#lib/components/ui/Menu.svelte';
	import { messageFor } from '#lib/messages.ts';
	import { showErrorToast, showToast } from '#lib/state/toast.svelte.ts';
	import { btn, menu } from '#lib/ui.ts';

	const T = {
		added: '添付しました。',
		deleted: '添付を削除しました。',
	};

	// Attachments as rows, not a thumbnail grid (DESIGN.md §8.16). Admin only.
	let { itemId }: { itemId: number } = $props();

	let rows = $state<AttachmentView[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let busy = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();

	async function load() {
		loading = true;
		try {
			rows = await getJson<AttachmentView[]>(`/api/items/${itemId}/attachments`);
			error = null;
		} catch (err) {
			error = errorCode(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void itemId;
		void load();
	});

	async function upload(e: Event & { currentTarget: HTMLInputElement }) {
		const files = [...(e.currentTarget.files ?? [])];
		e.currentTarget.value = '';
		if (files.length === 0) {
			return;
		}
		busy = true;
		try {
			for (const file of files) {
				await uploadFile<AttachmentView>(`/api/items/${itemId}/attachments`, file);
			}
			showToast(T.added);
		} catch (err) {
			showErrorToast(messageFor(errorCode(err)).title);
		} finally {
			busy = false;
			await load();
		}
	}

	async function remove(a: AttachmentView) {
		try {
			await sendJson('DELETE', `/api/attachments/${encodeURIComponent(a.id)}`);
			showToast(T.deleted);
		} catch (err) {
			showErrorToast(messageFor(errorCode(err)).title);
		}
		await load();
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between gap-4">
		<p class="text-xs text-ink-muted">
			PNG / JPEG / WebP の画像と PDF。1 ファイル 10 MB まで、1 物品 20 件まで。
		</p>
		<input
			bind:this={fileInput}
			type="file"
			class="sr-only"
			accept="image/png,image/jpeg,image/webp,application/pdf"
			multiple
			onchange={upload}
			tabindex="-1"
		/>
		<button type="button" class={btn.secondary} disabled={busy} onclick={() => fileInput?.click()}>
			<Paperclip class="size-4 stroke-[1.5]" />ファイルを添付
		</button>
	</div>
	<div class="border border-rule rounded-sm bg-surface">
		{#if loading}
			<p class="h-10 px-3 flex items-center text-sm text-ink-muted">読み込み中…</p>
		{:else if error}
			<div class="flex items-center gap-3 h-10 px-3 text-sm text-red-800">
				{messageFor(error).title}
				<button type="button" class={btn.ghost} onclick={load}>再読み込み</button>
			</div>
		{:else}
			{#each rows as a (a.id)}
				<div class="flex items-center gap-3 h-10 px-3 border-b border-rule last:border-0 text-sm">
					{#if a.contentType.startsWith('image/')}
						<img
							src="/api/attachments/{encodeURIComponent(a.id)}"
							alt=""
							class="size-8 rounded-xs border border-rule object-cover"
							loading="lazy"
						/>
					{:else}
						<FileText class="size-4 stroke-[1.5] text-ink-muted" />
					{/if}
					<a
						class="truncate hover:underline underline-offset-2"
						href="/api/attachments/{encodeURIComponent(a.id)}"
						target="_blank"
						rel="noreferrer">{a.fileName}</a
					>
					<span class="font-mono text-xs text-ink-muted whitespace-nowrap"
						>{formatBytes(a.size)}</span
					>
					<span class="text-xs text-ink-muted whitespace-nowrap max-sm:hidden"
						>{a.uploadedByName}</span
					>
					<span class="ml-auto font-mono text-xs text-ink-muted whitespace-nowrap max-sm:hidden"
						>{formatDateTime(a.createdAt)}</span
					>
					<Menu class="max-sm:ml-auto">
						{#snippet trigger(props)}
							<button {...props} class={btn.ghostSm} aria-label="{a.fileName} の操作">
								<Ellipsis class="size-4 stroke-[1.5]" />
							</button>
						{/snippet}
						<a class={menu.item} href="/api/attachments/{encodeURIComponent(a.id)}?download=1"
							>保存する</a
						>
						<button type="button" class={menu.danger} onclick={() => remove(a)}>削除する</button>
					</Menu>
				</div>
			{:else}
				<p class="h-10 px-3 flex items-center text-sm text-ink-muted">添付はありません。</p>
			{/each}
		{/if}
	</div>
</div>
