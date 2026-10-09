import { goto } from '$app/navigation';
import type { Attachment } from 'svelte/attachments';

// A table row that opens a page (DESIGN.md §8.3): `<tr {@attach rowLink(href)}>`.
// The row takes keyboard focus and Enter on it opens the page. A click
// anywhere on the row opens the page too, except on a control inside it (a
// button, a link, a checkbox), which does its own job. Other keys are left to
// the caller (the ledger's Space selects the row).

/** Controls inside a row that handle their own clicks. */
const CONTROLS = 'a, button, input, label, select, textarea';

export function rowLink(href: string): Attachment<HTMLElement> {
	return (row) => {
		function onclick(e: MouseEvent) {
			if (!(e.target as Element).closest(CONTROLS)) {
				void goto(href);
			}
		}
		function onkeydown(e: KeyboardEvent) {
			// Only on the row itself: Enter on a control inside it is the control's.
			if (e.key === 'Enter' && e.target === row) {
				e.preventDefault();
				void goto(href);
			}
		}
		row.tabIndex = 0;
		row.addEventListener('click', onclick);
		row.addEventListener('keydown', onkeydown);
		return () => {
			row.removeEventListener('click', onclick);
			row.removeEventListener('keydown', onkeydown);
		};
	};
}
