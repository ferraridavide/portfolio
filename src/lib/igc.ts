/* Parsing for IGC flight logs (the FAI format every vario and flight app
   exports). Deliberately free of Cesium: the viewer turns these fixes into
   Cartesians, but the parsing, the elapsed-time bookkeeping and the altitude
   sparkline are plain numbers and stay testable on their own. */

export interface IgcFix {
	/** Unix epoch milliseconds, UTC — the IGC clock is always UTC */
	timeMs: number;
	/** Seconds since the first fix of the flight */
	elapsedSeconds: number;
	latitude: number;
	longitude: number;
	altitudeMeters: number;
}

interface RawFix {
	secondsOfDay: number;
	latitude: number;
	longitude: number;
	altitudeMeters: number;
	valid: boolean;
}

/** Fixes in chronological order. Throws when the file holds fewer than two. */
export function parseIgc(text: string): IgcFix[] {
	if (!text.trim()) throw new Error('The IGC file is empty.');

	const lines = normalizeLines(text);
	const dayStartMs = parseFlightDate(lines);
	const fixes: IgcFix[] = [];
	const counts = { fix: 0, malformed: 0, invalid: 0 };
	/* B records only carry a time of day, so a flight crossing midnight UTC
	   would otherwise jump backwards; a big negative step means a new day. */
	let dayOffsetSeconds = 0;
	let previousSeconds = -1;

	for (const line of lines) {
		if (!line.startsWith('B')) continue;
		counts.fix += 1;

		const fix = parseFix(line);
		if (!fix) {
			counts.malformed += 1;
			continue;
		}
		if (!fix.valid) {
			counts.invalid += 1;
			continue;
		}

		if (previousSeconds >= 0 && fix.secondsOfDay < previousSeconds - 43_200) {
			dayOffsetSeconds += 86_400;
		}
		previousSeconds = fix.secondsOfDay;

		const timeMs = dayStartMs + (dayOffsetSeconds + fix.secondsOfDay) * 1000;
		/* Some loggers repeat a second; a non-monotonic clock breaks both the
		   interpolation and Cesium's sampled position, so drop the duplicate. */
		if (fixes.length > 0 && timeMs <= fixes[fixes.length - 1]!.timeMs) continue;

		fixes.push({
			timeMs,
			elapsedSeconds: 0,
			latitude: fix.latitude,
			longitude: fix.longitude,
			altitudeMeters: fix.altitudeMeters,
		});
	}

	assertEnoughFixes(fixes, counts);

	const startMs = fixes[0]!.timeMs;
	for (const fix of fixes) fix.elapsedSeconds = (fix.timeMs - startMs) / 1000;
	return fixes;
}

function normalizeLines(text: string): string[] {
	return text.split(/\r\n|\r|\n/).map((line) => line.trim());
}

function assertEnoughFixes(fixes: IgcFix[], counts: { fix: number; malformed: number; invalid: number }): void {
	if (fixes.length >= 2) return;
	if (counts.fix === 0) {
		throw new Error(
			'The fetched file contains no IGC B records. Check that the track URL returns raw IGC text rather than an HTML page.',
		);
	}
	throw new Error(
		`The IGC file contains ${fixes.length} usable fixes from ${counts.fix} B records ` +
			`(${counts.malformed} malformed, ${counts.invalid} marked invalid); at least 2 are required.`,
	);
}

/** `HFDTE230225` -> midnight UTC on 2025-02-23. Falls back to the epoch. */
function parseFlightDate(lines: string[]): number {
	const header = lines.find((line) => line.startsWith('HFDTE'));
	const match = header?.slice(5).match(/(\d{2})(\d{2})(\d{2})/);
	if (!match) return Date.UTC(1970, 0, 1);
	/* Two-digit years, per the spec's pivot: 70-99 are 1900s, 00-69 are 2000s */
	const shortYear = Number(match[3]);
	const year = shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
	return Date.UTC(year, Number(match[2]) - 1, Number(match[1]));
}

/** `B` + HHMMSS + DDMMmmmN + DDDMMmmmE + validity + pressure alt + GNSS alt */
function parseFix(line: string): RawFix | null {
	if (line.length < 35) return null;

	const hours = parseDigits(line.slice(1, 3));
	const minutes = parseDigits(line.slice(3, 5));
	const seconds = parseDigits(line.slice(5, 7));
	const latitude = parseCoordinate(line.slice(7, 14), line[14], 2);
	const longitude = parseCoordinate(line.slice(15, 23), line[23], 3);
	const pressureAltitude = parseSignedDigits(line.slice(25, 30));
	const gnssAltitude = parseSignedDigits(line.slice(30, 35));

	if (hours === null || minutes === null || seconds === null) return null;
	if (latitude === null || longitude === null) return null;
	if (hours > 23 || minutes > 59 || seconds > 59) return null;

	return {
		secondsOfDay: hours * 3600 + minutes * 60 + seconds,
		latitude,
		longitude,
		altitudeMeters: gnssAltitude ?? pressureAltitude ?? 0,
		valid: line[24] === 'A',
	};
}

/** Degrees, whole minutes and thousandths of a minute, packed as digits. */
function parseCoordinate(value: string, hemisphere: string | undefined, degreeDigits: number): number | null {
	if (!/^\d+$/.test(value) || !hemisphere || !'NSEW'.includes(hemisphere)) return null;
	const degrees = Number(value.slice(0, degreeDigits));
	const minutes = Number(value.slice(degreeDigits, degreeDigits + 2));
	const thousandths = Number(value.slice(degreeDigits + 2));
	if (minutes >= 60) return null;
	const coordinate = degrees + (minutes + thousandths / 1000) / 60;
	return hemisphere === 'S' || hemisphere === 'W' ? -coordinate : coordinate;
}

function parseDigits(value: string): number | null {
	return /^\d+$/.test(value) ? Number(value) : null;
}

function parseSignedDigits(value: string): number | null {
	return /^-?\d+$/.test(value) ? Number(value) : null;
}

/** `7:32` under an hour, `1:07:32` above it. */
export function formatDuration(seconds: number): string {
	const rounded = Math.max(0, Math.round(seconds));
	const hours = Math.floor(rounded / 3600);
	const minutes = Math.floor((rounded % 3600) / 60);
	const remainder = rounded % 60;
	return hours > 0
		? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
		: `${minutes}:${String(remainder).padStart(2, '0')}`;
}

/**
 * Closed SVG path for the barograph behind the scrubber, drawn in a fixed
 * 1000x80 viewBox that the timeline stretches to whatever width it has.
 */
export function buildAltitudePath(fixes: IgcFix[], durationSeconds: number): string {
	const altitudes = fixes.map((fix) => fix.altitudeMeters);
	const minimum = Math.min(...altitudes);
	const range = Math.max(1, Math.max(...altitudes) - minimum);
	/* ~400 points is past the width of the track in CSS pixels, so thinning
	   here costs nothing visible and keeps the `d` attribute small */
	const stride = Math.max(1, Math.floor(fixes.length / 400));
	const selected = fixes.filter((_, index) => index % stride === 0);
	if (selected[selected.length - 1] !== fixes[fixes.length - 1]) selected.push(fixes[fixes.length - 1]!);

	const points = selected.map((fix) => {
		const x = (fix.elapsedSeconds / durationSeconds) * 1000;
		const y = 72 - ((fix.altitudeMeters - minimum) / range) * 58;
		return `${x.toFixed(1)},${y.toFixed(1)}`;
	});
	return `M 0,80 L ${points.join(' L ')} L 1000,80 Z`;
}
