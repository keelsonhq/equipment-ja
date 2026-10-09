import { readPref, writePref } from './prefs.ts';

// List density (DESIGN.md §8.3). Comfortable by default; the ledger's density
// button switches every table to the compact tokens (`.density-dense` on
// <main>, see src/app.css). Remembered per browser.
export const density = $state<{ dense: boolean }>({ dense: readPref('density.dense', false) });

export function toggleDensity(): void {
	density.dense = !density.dense;
	writePref('density.dense', density.dense);
}
