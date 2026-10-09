// Turns an event's JSON detail into display lines. Only structure lives here;
// the words come from the caller's label table (view text stays in the
// component).

export interface DetailLabels {
	fields: Record<string, string>;
	reasons: Record<string, string>;
	returnKinds: Record<string, string>;
	exchange: string;
	arrow: string;
	separator: string;
	empty: string;
}

type Detail = Record<string, unknown> | null;

// Detail values are JSON scalars (no event writes an array or an object here)
// and print as String() prints them. The cast says so to the lint, which
// rejects String() of an `unknown` that could be an object.
type Scalar = string | number | boolean;

function show(value: unknown, labels: DetailLabels): string {
	return value === null || value === undefined || value === ''
		? labels.empty
		: String(value as Scalar);
}

/** One line per fact, e.g. ["Place: Office", "Note: ..."]. */
export function detailLines(kind: string, detail: Detail, labels: DetailLabels): string[] {
	if (!detail) {
		return [];
	}
	const lines: string[] = [];
	const field = (key: string, value: unknown) => {
		if (value !== null && value !== undefined && value !== '') {
			lines.push(`${labels.fields[key] ?? key}${labels.separator}${String(value as Scalar)}`);
		}
	};
	const changes = (detail.changes ?? null) as Record<string, [unknown, unknown]> | null;
	if (changes) {
		for (const [key, [before, after]] of Object.entries(changes)) {
			lines.push(
				`${labels.fields[key] ?? key}${labels.separator}${show(before, labels)}${labels.arrow}${show(after, labels)}`,
			);
		}
	}
	switch (kind) {
		case 'issue':
			if (detail.exchangeFrom) {
				lines.push(labels.exchange);
			}
			field('place', detail.place);
			field('dueOn', detail.dueOn);
			field('note', detail.note);
			break;
		case 'return':
			if (typeof detail.returnKind === 'string') {
				lines.push(labels.returnKinds[detail.returnKind] ?? detail.returnKind);
			}
			field('storageLocation', detail.storageLocation);
			field('note', detail.note);
			break;
		case 'suspend':
			if (typeof detail.reason === 'string') {
				field('reason', labels.reasons[detail.reason] ?? detail.reason);
			}
			field('note', detail.note);
			break;
		case 'correct':
			field('reason', detail.reason);
			break;
		case 'import':
			field('fileName', detail.fileName);
			field('created', detail.created);
			field('assigned', detail.assigned);
			field('excluded', detail.excluded);
			for (const key of ['addedTypes', 'addedPlaces']) {
				const names = detail[key];
				if (Array.isArray(names) && names.length > 0) {
					field(key, names.join(' / '));
				}
			}
			field('failedFromLine', detail.failedFromLine);
			break;
	}
	return lines;
}
