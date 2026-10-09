import type { Client, Row } from '@libsql/client';
import type { Actor } from '#lib/server/auth/actor.ts';
import { nowIso } from '#lib/server/dates.ts';
import { AppError, ErrorCode } from '#lib/server/errors.ts';
import { attachmentKey, deleteFile, readFile, writeFile } from './files.ts';
import { requireAdmin } from '#lib/server/auth/guard.ts';
import { namedStatement } from '#lib/server/db/named.ts';
import { num, str } from '#lib/server/db/rows.ts';
import {
	ATTACHMENT_BYTES_MAX,
	ATTACHMENT_FILE_NAME_MAX,
	ATTACHMENTS_PER_ITEM_MAX,
} from '#lib/limits.ts';

// Photos and documents attached to an item (purchase receipts, warranty cards,
// photos of damage). Admin only: attachments are management records.
//
// Formats: PNG / JPEG / WebP / PDF, detected from the file's leading bytes
// (never the client-declared type). The size and count limits are in
// src/lib/limits.ts.

type FileKind = 'png' | 'jpeg' | 'webp' | 'pdf';

const MIME: Record<FileKind, string> = {
	png: 'image/png',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	pdf: 'application/pdf',
};

const EXT: Record<FileKind, string> = { png: 'png', jpeg: 'jpg', webp: 'webp', pdf: 'pdf' };

function startsWith(buf: Uint8Array, sig: readonly number[], offset = 0): boolean {
	if (buf.length < offset + sig.length) {
		return false;
	}
	return sig.every((b, i) => buf[offset + i] === b);
}

/** File kind from magic bytes, or null when unsupported. */
function detectKind(buf: Uint8Array): FileKind | null {
	if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
		return 'png';
	}
	if (startsWith(buf, [0xff, 0xd8, 0xff])) {
		return 'jpeg';
	}
	if (startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
		return 'pdf';
	}
	if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
		return 'webp';
	}
	return null;
}

export interface AttachmentView {
	id: string;
	itemId: number;
	fileName: string;
	contentType: string;
	size: number;
	uploadedByName: string;
	createdAt: string;
}

function attachmentViewOf(r: Row): AttachmentView {
	return {
		id: str(r, 'id'),
		itemId: num(r, 'item_id'),
		fileName: str(r, 'file_name'),
		contentType: str(r, 'content_type'),
		size: num(r, 'size'),
		uploadedByName: str(r, 'uploaded_by_name'),
		createdAt: str(r, 'created_at'),
	};
}

export async function listAttachments(
	db: Client,
	actor: Actor,
	itemId: number,
): Promise<AttachmentView[]> {
	requireAdmin(actor);
	const res = await db.execute({
		sql: 'SELECT * FROM attachments WHERE item_id = ? ORDER BY created_at DESC, rowid DESC',
		args: [itemId],
	});
	return res.rows.map(attachmentViewOf);
}

/** Normalize a client-supplied file name: no paths, no control chars, bounded. */
function cleanFileName(name: string | null, kind: FileKind): string {
	const last = (name ?? '').split(/[\\/]/).pop() ?? '';
	// Drop control characters (C0 and DEL).
	const base = Array.from(last)
		.filter((ch) => {
			const code = ch.charCodeAt(0);
			return code >= 0x20 && code !== 0x7f;
		})
		.join('')
		.trim()
		.slice(0, ATTACHMENT_FILE_NAME_MAX);
	return base && base !== '.' && base !== '..' ? base : `attachment.${EXT[kind]}`;
}

export async function addAttachment(
	db: Client,
	actor: Actor,
	itemId: number,
	fileName: string | null,
	bytes: Uint8Array,
): Promise<AttachmentView> {
	requireAdmin(actor);
	if (bytes.byteLength === 0) {
		throw new AppError(ErrorCode.InvalidRequest);
	}
	if (bytes.byteLength > ATTACHMENT_BYTES_MAX) {
		throw new AppError(ErrorCode.AttachmentTooLarge);
	}
	const kind = detectKind(bytes);
	if (!kind) {
		throw new AppError(ErrorCode.AttachmentTypeUnsupported);
	}
	const count = await db.execute(
		namedStatement(
			`SELECT (SELECT COUNT(*) FROM items WHERE id = :itemId) AS item_count,
				(SELECT COUNT(*) FROM attachments WHERE item_id = :itemId) AS n`,
			{ itemId },
		),
	);
	if (Number(count.rows[0]?.item_count ?? 0) === 0) {
		throw new AppError(ErrorCode.ItemNotFound);
	}
	if (Number(count.rows[0]?.n ?? 0) >= ATTACHMENTS_PER_ITEM_MAX) {
		throw new AppError(ErrorCode.AttachmentLimitReached);
	}

	const id = crypto.randomUUID();
	const key = attachmentKey(itemId, id, EXT[kind]);
	try {
		await writeFile(key, bytes);
	} catch (err) {
		console.error('[attachments] write failed', err);
		throw new AppError(ErrorCode.AttachmentStorageFailed);
	}
	const name = cleanFileName(fileName, kind);
	const createdAt = nowIso();
	try {
		await db.execute(
			namedStatement(
				`INSERT INTO attachments (id, item_id, file_key, file_name, content_type, size,
					uploaded_by_id, uploaded_by_name, created_at)
				VALUES (:id, :itemId, :fileKey, :fileName, :contentType, :size,
					:uploadedById, :uploadedByName, :createdAt)`,
				{
					id,
					itemId,
					fileKey: key,
					fileName: name,
					contentType: MIME[kind],
					size: bytes.byteLength,
					uploadedById: actor.id,
					uploadedByName: actor.name,
					createdAt,
				},
			),
		);
	} catch (err) {
		await deleteFile(key);
		throw err;
	}
	return {
		id,
		itemId,
		fileName: name,
		contentType: MIME[kind],
		size: bytes.byteLength,
		uploadedByName: actor.name,
		createdAt,
	};
}

/** One attachment and where its bytes are; `attachment_not_found` when there is none. */
async function loadAttachment(
	db: Client,
	id: string,
): Promise<{ view: AttachmentView; fileKey: string }> {
	const res = await db.execute({ sql: 'SELECT * FROM attachments WHERE id = ?', args: [id] });
	const row = res.rows[0];
	if (!row) {
		throw new AppError(ErrorCode.AttachmentNotFound);
	}
	return { view: attachmentViewOf(row), fileKey: str(row, 'file_key') };
}

export async function readAttachment(
	db: Client,
	actor: Actor,
	id: string,
): Promise<{ meta: AttachmentView; bytes: Uint8Array }> {
	requireAdmin(actor);
	const { view, fileKey } = await loadAttachment(db, id);
	const bytes = await readFile(fileKey);
	if (!bytes) {
		throw new AppError(ErrorCode.AttachmentNotFound);
	}
	return { meta: view, bytes };
}

export async function deleteAttachment(db: Client, actor: Actor, id: string): Promise<void> {
	requireAdmin(actor);
	const { fileKey } = await loadAttachment(db, id);
	await db.execute({ sql: 'DELETE FROM attachments WHERE id = ?', args: [id] });
	await deleteFile(fileKey);
}
