// What the return dialog needs to know about the assignment being closed,
// built from the two rows a screen can start a return from: an item (the
// ledger, the home screen, the item page, the return dialog's own picker) or a
// holding on a person's page.

import type { ItemView } from '#lib/server/domain/items.ts';
import type { Holding } from '#lib/server/domain/people.ts';

export interface ReturnTarget {
	assignmentId: string;
	assetTag: string;
	itemName: string;
	issuedOn: string;
	userName: string;
	/** Prefills the storage place (admins): the item's own, when the row carries it. */
	storageLocation: string | null;
}

/**
 * The open assignment of an item, or null when nobody holds it. The API sets
 * the assignment, its issue date and the holder together, so a missing one
 * means "nothing to return", never a blank to fill in.
 */
export function returnTargetOfItem(item: ItemView): ReturnTarget | null {
	if (!item.assignmentId || !item.issuedOn || !item.holder) {
		return null;
	}
	return {
		assignmentId: item.assignmentId,
		assetTag: item.assetTag,
		itemName: item.name,
		issuedOn: item.issuedOn,
		userName: item.holder.name,
		storageLocation: item.storageLocation,
	};
}

/**
 * A holding on the page of `userName`. A holding does not carry the item's
 * storage place, so the dialog starts with it empty.
 */
export function returnTargetOfHolding(holding: Holding, userName: string): ReturnTarget {
	return {
		assignmentId: holding.assignmentId,
		assetTag: holding.assetTag,
		itemName: holding.itemName,
		issuedOn: holding.issuedOn,
		userName,
		storageLocation: null,
	};
}
