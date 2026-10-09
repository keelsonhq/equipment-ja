// Server-emitted human text: the one server file where Japanese is allowed.
// The API itself never returns prose — only the CSV export, which is a
// document for people, carries labels.

import type { ItemStatus, SuspendReason } from '#lib/server/domain/items.ts';

/**
 * CSV columns shared by the template, the import and the export (import/csv.ts), in
 * file order. The import reads a column by this header (a trailing `*`, which
 * the template uses to mark required columns, is ignored).
 */
export const CSV_COLUMNS = {
	assetTag: '管理番号',
	name: '物品名',
	typeName: '種類',
	serialNo: '製造番号',
	purchasedOn: '購入日',
	storageLocation: '保管場所',
	note: '備考',
	holderEmail: '支給先メール',
	placeName: '使用場所',
	issuedOn: '支給日',
	dueOn: '返却予定日',
} as const;

/** Export-only columns, after the importable ones (the import ignores them). */
export const CSV_READONLY_COLUMNS = {
	status: '状態',
	suspendedReason: '利用停止の理由',
	holderName: '支給先',
	updatedAt: '更新日時',
} as const;

/** Example rows of the import template (one unassigned item, one issued). */
export const CSV_TEMPLATE_EXAMPLES: Record<keyof typeof CSV_COLUMNS, string>[] = [
	{
		assetTag: 'PC-0201',
		name: 'ノートPC 14型 Core Ultra 7 / 32GB',
		typeName: 'ノートPC',
		serialNo: 'SN-7K2Q9A',
		purchasedOn: '2025-04-01',
		storageLocation: '本社 3F 備品庫',
		note: '',
		holderEmail: '',
		placeName: '',
		issuedOn: '',
		dueOn: '',
	},
	{
		assetTag: 'PH-0102',
		name: '社用スマートフォン 128GB',
		typeName: '社用携帯',
		serialNo: '',
		purchasedOn: '2025-04-01',
		storageLocation: '',
		note: '',
		holderEmail: 'taro.yamada@example.com',
		placeName: 'オフィス',
		issuedOn: '2025-04-10',
		dueOn: '',
	},
];

/** Template download file name. */
export const CSV_TEMPLATE_FILE = 'items-template.csv';

export const STATUS_LABELS: Record<ItemStatus, string> = {
	unassigned: '未割当',
	assigned: '支給中',
	pending_return: '返却待ち',
	overdue: '返却期限超過',
	suspended: '利用停止',
};

export const SUSPEND_REASON_LABELS: Record<SuspendReason, string> = {
	repair: '修理中',
	broken: '故障',
	lost: '紛失',
	other: 'その他',
};

/** Download file name prefix: <prefix>-YYYY-MM-DD.csv */
export const CSV_FILE_PREFIX = 'items';
