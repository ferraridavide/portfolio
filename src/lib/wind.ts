/* Flyability for my usual launches, from the Open-Meteo forecast. Where I
   have a track.igc from the site, altitude and facing come from its first
   fixes: the heading flown straight after takeoff is the way the slope
   faces. Otherwise they come from the terrain model, with the facing taken
   as the direction the ground falls away fastest around the launch. Either
   way, the facing is where the wind should come from. */

export interface Launch {
	name: string;
	latitude: number;
	longitude: number;
	/* Metres; sent to Open-Meteo so temperatures are corrected to launch height */
	elevation: number;
	/* Degrees the slope faces, i.e. the ideal wind direction */
	facing: number;
}

export const LAUNCHES: Launch[] = [
	{ name: 'Cavallaria', latitude: 45.50764, longitude: 7.80985, elevation: 994, facing: 134 },
	{ name: 'Porlezza', latitude: 46.01327, longitude: 9.16084, elevation: 1593, facing: 358 },
	{ name: 'Campo Tures', latitude: 46.92656, longitude: 11.96744, elevation: 1411, facing: 221 },
];

export type Level = 'flyable' | 'marginal' | 'grounded';

export interface Wind {
	speed: number;
	/* Where the wind comes from, meteorological convention */
	direction: number;
	gusts: number;
}

export interface Forecast {
	launch: Launch;
	now: Wind;
	day: 'today' | 'tomorrow';
	level: Level;
	/* Why the day is not flyable, or what makes it marginal */
	reason?: string;
	/* Local hours, end exclusive: the longest usable run of the day */
	window?: [number, number];
	/* Metres above sea level, estimated from the dew point spread */
	cloudbase?: number;
}

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
/* Only these hours count as flying time */
const FIRST_HOUR = 9;
const LAST_HOUR = 18;
/* After this hour, "today" is over and the forecast looks at tomorrow */
const ROLLOVER_HOUR = 17;
/* Below this, wind from any direction still allows a forward launch */
const LIGHT_WIND = 6;
/* Metres of cloudbase per degree of temperature/dew point spread */
const LCL_PER_DEGREE = 125;

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function compass(degrees: number): string {
	return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

function angleBetween(a: number, b: number): number {
	const d = Math.abs(a - b) % 360;
	return d > 180 ? 360 - d : d;
}

interface Hour extends Wind {
	hour: number;
	precipitation: number;
	temperature: number;
	dewPoint: number;
}

function rate(hour: Hour, launch: Launch): { level: Level; reason?: string } {
	if (hour.precipitation >= 0.1) return { level: 'grounded', reason: 'rain' };
	const off = angleBetween(hour.direction, launch.facing);
	const light = hour.speed < LIGHT_WIND;
	if (!light && off > 90) return { level: 'grounded', reason: 'wind over the back' };
	if (hour.speed > 25 || hour.gusts > 38) return { level: 'grounded', reason: 'too windy' };
	/* Model gusts at 10m run high in the mountains, hence the generous limits */
	if (hour.speed > 20) return { level: 'marginal', reason: 'strong wind' };
	if (hour.gusts > 28) return { level: 'marginal', reason: 'gusty' };
	if (!light && off > 50) return { level: 'marginal', reason: 'crosswind' };
	return { level: 'flyable' };
}

/* The longest run of consecutive hours passing `ok`, as [start, end) */
function longestRun(hours: Hour[], ok: (index: number) => boolean): [number, number] | undefined {
	let best: [number, number] | undefined;
	let start = -1;
	for (let i = 0; i <= hours.length; i++) {
		if (i < hours.length && ok(i)) {
			if (start < 0) start = i;
		} else if (start >= 0) {
			if (!best || i - start > best[1] - best[0]) best = [start, i];
			start = -1;
		}
	}
	return best;
}

function mostCommon(values: string[]): string | undefined {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function forecastLaunch(launch: Launch, data: any): Forecast {
	const current: string = data.current.time;
	const currentHour = Number(current.slice(11, 13));
	const day = currentHour >= ROLLOVER_HOUR ? 'tomorrow' : 'today';
	/* Times are local wall-clock strings; picking the date by string keeps
	   the launch's timezone rather than the visitor's */
	const date = day === 'today' ? current.slice(0, 10) : data.hourly.time[24].slice(0, 10);

	const h = data.hourly;
	const hours: Hour[] = [];
	h.time.forEach((time: string, i: number) => {
		const hour = Number(time.slice(11, 13));
		if (!time.startsWith(date) || hour < FIRST_HOUR || hour >= LAST_HOUR) return;
		if (day === 'today' && hour < currentHour) return;
		hours.push({
			hour,
			speed: h.wind_speed_10m[i],
			direction: h.wind_direction_10m[i],
			gusts: h.wind_gusts_10m[i],
			precipitation: h.precipitation[i],
			temperature: h.temperature_2m[i],
			dewPoint: h.dew_point_2m[i],
		});
	});

	const now: Wind = {
		speed: data.current.wind_speed_10m,
		direction: data.current.wind_direction_10m,
		gusts: data.current.wind_gusts_10m,
	};
	const ratings = hours.map((hour) => rate(hour, launch));

	let level: Level = 'grounded';
	let run = longestRun(hours, (i) => ratings[i].level === 'flyable');
	let reason: string | undefined;
	if (run && run[1] - run[0] >= 2) {
		level = 'flyable';
	} else {
		run = longestRun(hours, (i) => ratings[i].level !== 'grounded');
		if (run) level = 'marginal';
		const pool = ratings.filter((r) => r.level === (run ? 'marginal' : 'grounded'));
		reason = mostCommon(pool.map((r) => r.reason!));
	}

	let window: [number, number] | undefined;
	let cloudbase: number | undefined;
	if (run) {
		window = [hours[run[0]].hour, hours[run[1] - 1].hour + 1];
		const middle = hours[Math.floor((run[0] + run[1] - 1) / 2)];
		const base = launch.elevation + (middle.temperature - middle.dewPoint) * LCL_PER_DEGREE;
		cloudbase = Math.round(base / 50) * 50;
	}

	return { launch, now, day, level, reason: hours.length ? reason : 'no daylight left', window, cloudbase };
}

const RANK: Record<Level, number> = { flyable: 2, marginal: 1, grounded: 0 };

function span(forecast: Forecast): number {
	return forecast.window ? forecast.window[1] - forecast.window[0] : 0;
}

/** Every launch, the best one to fly first. */
export async function fetchForecasts(signal: AbortSignal): Promise<Forecast[]> {
	const params = new URLSearchParams({
		latitude: LAUNCHES.map((l) => l.latitude).join(','),
		longitude: LAUNCHES.map((l) => l.longitude).join(','),
		elevation: LAUNCHES.map((l) => l.elevation).join(','),
		current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
		hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,temperature_2m,dew_point_2m',
		timezone: 'auto',
		forecast_days: '2',
	});
	const response = await fetch(`${ENDPOINT}?${params}`, { signal });
	if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}; expected a successful response.`);
	const body = await response.json();
	/* A single location comes back as an object, several as an array */
	const results: any[] = Array.isArray(body) ? body : [body];
	if (results.length !== LAUNCHES.length || !results.every((r) => r?.current && r?.hourly)) {
		throw new Error(`Invalid Open-Meteo response; expected ${LAUNCHES.length} locations with current and hourly data.`);
	}
	return results
		.map((result, i) => forecastLaunch(LAUNCHES[i], result))
		.sort((a, b) => RANK[b.level] - RANK[a.level] || span(b) - span(a));
}
