import * as files from '@keelsonhq/files';

// Attachment bytes live in the platform's per-app file store (@keelsonhq/files):
// durable, private, key-addressed. The instance disk is scratch and would lose
// them on restart. Locally (KEELSON_MODE unset) the SDK writes under
// KEELSON_FILES_DIR (default ./.keelson/files).

const ATTACHMENT_PREFIX = 'attachments/';

/** The file-store operations this app uses. */
export interface FileStore {
	write(key: string, data: Uint8Array): Promise<void>;
	read(key: string): Promise<Uint8Array | null>;
	delete(key: string): Promise<void>;
}

const sdkStore: FileStore = {
	write: (key, data) => files.write(key, data),
	read: (key) => files.read(key),
	delete: (key) => files.delete(key),
};

let store: FileStore = sdkStore;

/** Test seam: swap the store (null restores the SDK). */
export function setFileStoreForTest(next: FileStore | null): void {
	store = next ?? sdkStore;
}

export function attachmentKey(itemId: number, attachmentId: string, ext: string): string {
	return `${ATTACHMENT_PREFIX}${itemId}/${attachmentId}.${ext}`;
}

export async function writeFile(key: string, bytes: Uint8Array): Promise<void> {
	await store.write(key, bytes);
}

export async function readFile(key: string): Promise<Uint8Array | null> {
	return store.read(key);
}

/** Best-effort delete; a missing object is not an error. */
export async function deleteFile(key: string): Promise<void> {
	try {
		await store.delete(key);
	} catch (err) {
		console.error('[files] delete failed', key, err);
	}
}
