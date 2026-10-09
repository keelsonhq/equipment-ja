<script lang="ts" module>
	/** What the trigger button spreads: `<button {...props} …>`. */
	export interface MenuTriggerProps {
		type: 'button';
		'aria-expanded': boolean;
		onclick: (e: MouseEvent & { currentTarget: HTMLElement }) => void;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { menu } from '#lib/ui.ts';

	// Menu / dropdown (DESIGN.md §8.14). The caller draws the trigger button
	// (spreading `props` on it, next to its own class, label and data-testid)
	// and the items (`menu.item` / `menu.danger` from ui.ts). This opens and
	// closes the panel:
	// - the trigger toggles it; a click anywhere outside or Escape closes it;
	// - choosing an item (any link or button in the panel) closes it and puts
	//   the focus back on the trigger, so a dialog the item opens returns there;
	// - a checklist (label + checkbox) keeps it open while boxes are ticked.
	let {
		trigger,
		children,
		align = 'right',
		class: className = '',
	}: {
		trigger: Snippet<[MenuTriggerProps]>;
		children: Snippet;
		/** Which edge of the trigger the panel lines up with. */
		align?: 'left' | 'right';
		/** Classes of the wrapper (it is the item in the caller's layout). */
		class?: string;
	} = $props();

	let open = $state(false);
	let root: HTMLElement | undefined = $state();
	let button: HTMLElement | null = null;

	function close(refocus: boolean) {
		open = false;
		if (refocus) {
			button?.focus();
		}
	}

	const triggerProps: MenuTriggerProps = $derived({
		type: 'button',
		'aria-expanded': open,
		onclick: (e) => {
			button = e.currentTarget;
			open = !open;
		},
	});

	function onWindowClick(e: MouseEvent) {
		if (open && !root?.contains(e.target as Node)) {
			close(false);
		}
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') {
			// Back to the trigger only when the focus is in this menu.
			close(root?.contains(document.activeElement) ?? false);
		}
	}

	function onPanelClick(e: MouseEvent) {
		if ((e.target as Element).closest('a, button')) {
			close(true);
		}
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="relative {className}" bind:this={root}>
	{@render trigger(triggerProps)}
	{#if open}
		<!-- Clicks bubble up from the items; the items themselves are the controls. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="absolute {align === 'left' ? 'left-0' : 'right-0'} z-30 mt-1 {menu.panel}"
			onclick={onPanelClick}
		>
			{@render children()}
		</div>
	{/if}
</div>
