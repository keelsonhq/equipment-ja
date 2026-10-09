<script lang="ts">
	import '../app.css';
	import History from '@lucide/svelte/icons/history';
	import House from '@lucide/svelte/icons/house';
	import List from '@lucide/svelte/icons/list';
	import Menu from '@lucide/svelte/icons/menu';
	import Tags from '@lucide/svelte/icons/tags';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import { APP_NAME } from '#lib/components/PageTitle.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import ErrorBox from '#lib/components/ui/ErrorBox.svelte';
	import PageLoading from '#lib/components/ui/PageLoading.svelte';
	import Toast from '#lib/components/ui/Toast.svelte';
	import { density } from '#lib/state/density.svelte.ts';
	import { loadMasters } from '#lib/state/masters.svelte.ts';
	import { loadSession, session } from '#lib/state/session.svelte.ts';
	import { btn, focusRing } from '#lib/ui.ts';

	const T = {
		nav: {
			home: 'ホーム',
			items: '台帳',
			members: '社員別',
			history: '履歴',
			masters: 'マスタ管理',
			me: '自分のページ',
		},
	};

	// Side navigation (DESIGN.md §8.1): the admin screens, then the user's own page
	// (under its own heading for admins). Members see only their own page.
	interface NavLink {
		href: string;
		label: string;
		icon: typeof House;
	}
	const ADMIN_NAV: NavLink[] = [
		{ href: '/', label: T.nav.home, icon: House },
		{ href: '/items', label: T.nav.items, icon: List },
		{ href: '/members', label: T.nav.members, icon: Users },
		{ href: '/history', label: T.nav.history, icon: History },
		{ href: '/masters', label: T.nav.masters, icon: Tags },
	];
	const MY_NAV: NavLink = { href: '/me', label: T.nav.me, icon: User };

	let { children } = $props();
	let drawer = $state(false);

	$effect(() => {
		void loadSession();
		void loadMasters();
	});

	// Close the mobile drawer on navigation.
	$effect(() => {
		void page.url.pathname;
		drawer = false;
	});

	const me = $derived(session.me);
	const admin = $derived(me?.isAdmin ?? false);

	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') {
			return path === '/';
		}
		return path === href || path.startsWith(`${href}/`);
	}

	const NAV_ITEM = `flex items-center gap-2 h-8 px-2 rounded-xs text-sm border transition-colors duration-150 ${focusRing} pointer-coarse:h-11`;
	const NAV_IDLE = 'border-transparent text-ink-muted hover:bg-stone-200/60 hover:text-ink';
	const NAV_ACTIVE = 'bg-surface border-rule text-ink font-medium';
</script>

{#snippet navLink(link: NavLink)}
	{@const active = isActive(link.href)}
	<a
		href={link.href}
		class="{NAV_ITEM} {active ? NAV_ACTIVE : NAV_IDLE}"
		aria-current={active ? 'page' : undefined}
	>
		<link.icon class="size-4 stroke-[1.5]" />{link.label}
	</a>
{/snippet}

{#snippet nav()}
	<nav class="mt-4 space-y-0.5" aria-label="メインメニュー">
		{#if admin}
			{#each ADMIN_NAV as link (link.href)}
				{@render navLink(link)}
			{/each}
			<p class="px-2 mt-5 mb-1 text-[11px] font-medium text-ink-faint">自分</p>
		{/if}
		{@render navLink(MY_NAV)}
	</nav>
{/snippet}

{#snippet userBlock()}
	{#if me}
		<div class="flex items-center gap-2 h-10 px-2 text-xs text-ink-muted">
			<Avatar name={me.name} imageUrl={me.imageUrl} />
			<span class="truncate text-ink">{me.name}</span>
			{#if admin}
				<span
					class="ml-auto inline-flex items-center h-5 px-1.5 rounded-xs border border-rule-strong bg-surface text-[11px] font-medium text-ink-muted"
					>管理</span
				>
			{/if}
		</div>
	{/if}
{/snippet}

<div class="h-dvh bg-paper text-ink antialiased flex flex-col">
	{#if me?.localPreview}
		<div
			class="flex items-center justify-center gap-2 min-h-8 px-4 py-1 bg-ink text-paper text-xs text-center"
		>
			ローカルプレビュー: 本番では実際のログインと権限が適用されます。{#if !admin}(メンバーとして表示){/if}
		</div>
	{/if}

	<!-- Mobile top bar: the spine moves to the top edge. -->
	<div
		class="md:hidden flex items-center gap-2 h-12 px-4 border-t-4 border-t-accent border-b border-b-rule bg-paper"
	>
		<button
			type="button"
			class={btn.ghostIcon}
			onclick={() => (drawer = true)}
			aria-label="メニューを開く"
		>
			<Menu class="size-4 stroke-[1.5]" />
		</button>
		<span class="text-sm font-semibold tracking-tight text-ink">{APP_NAME}</span>
	</div>

	<div class="flex-1 min-h-0 md:grid md:grid-cols-[240px_1fr]">
		<aside
			class="hidden md:flex md:flex-col border-l-4 border-l-accent border-r border-r-rule bg-paper px-3 py-4 md:h-full md:overflow-y-auto"
		>
			<div class="flex items-center h-8 px-2 text-sm font-semibold tracking-tight text-ink">
				{APP_NAME}
			</div>
			{@render nav()}
			<div class="mt-auto">{@render userBlock()}</div>
		</aside>

		{#if drawer}
			<div class="md:hidden fixed inset-0 z-40">
				<button
					type="button"
					class="absolute inset-0 bg-stone-900/40"
					aria-label="メニューを閉じる"
					onclick={() => (drawer = false)}
				></button>
				<aside
					class="absolute inset-y-0 left-0 flex w-64 flex-col border-l-4 border-l-accent border-r border-r-rule bg-paper px-3 py-4 shadow-md shadow-stone-900/10"
				>
					<div class="flex items-center justify-between h-8 px-2">
						<span class="text-sm font-semibold tracking-tight text-ink">{APP_NAME}</span>
						<button
							type="button"
							class={btn.ghostIcon}
							onclick={() => (drawer = false)}
							aria-label="メニューを閉じる"
						>
							<X class="size-4 stroke-[1.5]" />
						</button>
					</div>
					{@render nav()}
					<div class="mt-auto">{@render userBlock()}</div>
				</aside>
			</div>
		{/if}

		<main class="min-w-0 h-full overflow-y-auto {density.dense ? 'density-dense' : ''}">
			{#if session.error}
				<ErrorBox code={session.error} onretry={loadSession} />
			{:else if me}
				{@render children()}
			{:else}
				<PageLoading />
			{/if}
		</main>
	</div>
</div>

<Toast />
