import { describe, expect, it } from 'vite-plus/test';
import { addDays, zonedDayStartIso } from '#lib/server/dates.ts';

describe('addDays', () => {
	it('moves a calendar date across months, years and leap days', () => {
		expect(addDays('2025-01-15', 1)).toBe('2025-01-16');
		expect(addDays('2025-01-31', 1)).toBe('2025-02-01');
		expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
		expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
		expect(addDays('2025-04-01', 30)).toBe('2025-05-01');
	});

	it('goes back with a negative count and stays with zero', () => {
		expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
		expect(addDays('2026-01-01', -365)).toBe('2025-01-01');
		expect(addDays('2025-06-10', 0)).toBe('2025-06-10');
	});
});

describe('zonedDayStartIso', () => {
	it('gives the UTC instant a local day starts at', () => {
		expect(zonedDayStartIso('2025-04-01', 'Asia/Tokyo')).toBe('2025-03-31T15:00:00.000Z');
		expect(zonedDayStartIso('2025-04-01', 'UTC')).toBe('2025-04-01T00:00:00.000Z');
		// Daylight saving time: New York is UTC-4 in July, UTC-5 in January.
		expect(zonedDayStartIso('2025-07-01', 'America/New_York')).toBe('2025-07-01T04:00:00.000Z');
		expect(zonedDayStartIso('2025-01-01', 'America/New_York')).toBe('2025-01-01T05:00:00.000Z');
	});
});
