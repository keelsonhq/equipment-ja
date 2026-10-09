// Small UI-side shapes shared between components. API response types are
// imported (type-only) from the server modules that produce them.

/** An item as shown at the top of a dialog (any item row: ItemView, AvailableItem). */
export interface ItemRef {
	id: number;
	assetTag: string;
	name: string;
}

/** A person as shown on name cards and dialogs. */
export interface PersonRef {
	id: string;
	name: string;
	email: string | null;
	imageUrl: string | null;
}
