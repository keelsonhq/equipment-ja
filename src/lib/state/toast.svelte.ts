// One toast at a time (DESIGN.md §8.15): confirmations disappear after 3 s,
// errors stay until closed.
export const toast = $state<{ text: string | null; error: boolean; seq: number }>({
	text: null,
	error: false,
	seq: 0,
});

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string): void {
	clearTimeout(timer);
	toast.text = text;
	toast.error = false;
	toast.seq += 1;
	timer = setTimeout(() => {
		toast.text = null;
	}, 3000);
}

export function showErrorToast(text: string): void {
	clearTimeout(timer);
	toast.text = text;
	toast.error = true;
	toast.seq += 1;
}

export function closeToast(): void {
	clearTimeout(timer);
	toast.text = null;
}
