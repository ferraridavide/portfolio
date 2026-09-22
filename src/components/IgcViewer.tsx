import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCesium } from '../lib/cesium';
import { formatDuration, parseIgc } from '../lib/igc';
import { FlightScene, type CameraSettings, type Telemetry } from '../lib/igc-scene';
import styles from './IgcViewer.module.css';

/* The ion token is public by design — it is sent to the browser on every load
   and is scoped to read-only access on Cesium's own terrain and imagery. */
const ION_TOKEN =
	import.meta.env.PUBLIC_CESIUM_ION_TOKEN ??
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI2ZTM1OThjYi1mNTU4LTRmNDctOWNhNS0wNWI2MTA1ZGU2NjIiLCJpZCI6Mjk3MzE1LCJpYXQiOjE3NDU2MjYwNTd9.aJytwthdrinNHz2hVJ5J-Ry62xFzy4alE_-uVgWvg9U';

export interface IgcViewerProps {
	/** URL of the IGC file, fetched at runtime */
	track: string;
	/** Accessible name for the figure, e.g. "Alpe Giumello flight replay" */
	label?: string;
	/** Seconds of flight per second of playback */
	playbackRate?: number;
	trailLengthMeters?: number;
	showGhostRoute?: boolean;
	camera?: Partial<CameraSettings>;
}

const EMPTY_TELEMETRY: Telemetry = {
	elapsedSeconds: 0,
	altitudeMeters: Number.NaN,
	speedKph: Number.NaN,
	varioMps: Number.NaN,
	distanceKm: Number.NaN,
};

export default function IgcViewer({
	track,
	label = 'Flight replay',
	playbackRate,
	trailLengthMeters,
	showGhostRoute,
	camera,
}: IgcViewerProps) {
	const figureRef = useRef<HTMLElement>(null);
	const mapRef = useRef<HTMLDivElement>(null);
	const creditsRef = useRef<HTMLDivElement>(null);
	const sceneRef = useRef<FlightScene | null>(null);

	const [error, setError] = useState<string | null>(null);
	/* Terrain or imagery is missing but the flight itself is playable */
	const [warning, setWarning] = useState<string | null>(null);
	const [status, setStatus] = useState('Loading flight');
	const [duration, setDuration] = useState<number | null>(null);
	const [altitudePath, setAltitudePath] = useState('');
	const [telemetry, setTelemetry] = useState<Telemetry>(EMPTY_TELEMETRY);
	const [isPlaying, setIsPlaying] = useState(false);
	const [isAutoCamera, setIsAutoCamera] = useState(true);
	const [isFullscreen, setIsFullscreen] = useState(false);

	/* The scene is built once per track: everything else is either read from
	   it or pushed into it, so a changed playback option does not rebuild the
	   globe. Options are read through a ref for that reason. */
	const optionsRef = useRef({ playbackRate, trailLengthMeters, showGhostRoute, camera });
	optionsRef.current = { playbackRate, trailLengthMeters, showGhostRoute, camera };

	useEffect(() => {
		let disposed = false;

		(async () => {
			try {
				setStatus('Loading terrain and imagery');
				/* Both are slow and independent: the CDN bundle is ~10 MB and the
				   track is a network round trip, so they overlap */
				const [cesium, response] = await Promise.all([loadCesium(), fetch(track)]);
				if (!response.ok) {
					throw new Error(`Track request failed with ${response.status} ${response.statusText}.`);
				}
				const fixes = parseIgc(await response.text());
				if (disposed || !mapRef.current || !creditsRef.current) return;

				const { playbackRate, trailLengthMeters, showGhostRoute, camera } = optionsRef.current;
				const scene = new FlightScene({
					cesium,
					container: mapRef.current,
					creditContainer: creditsRef.current,
					fixes,
					ionToken: ION_TOKEN,
					...(playbackRate === undefined ? {} : { playbackRate }),
					...(trailLengthMeters === undefined ? {} : { trailLengthMeters }),
					...(showGhostRoute === undefined ? {} : { showGhostRoute }),
					...(camera === undefined ? {} : { camera }),
					onFrame: (frame, playing) => {
						setTelemetry(frame);
						setIsPlaying(playing);
					},
					onCameraModeChange: (mode) => setIsAutoCamera(mode === 'auto'),
					onAssetError: (message) => setWarning(message),
				});

				sceneRef.current = scene;
				setDuration(scene.durationSeconds);
				setAltitudePath(scene.altitudePath);
			} catch (cause) {
				if (disposed) return;
				const message = cause instanceof Error ? cause.message : 'The flight could not be loaded.';
				setError(message);
				console.error(`IGC viewer: ${message}`, cause);
			}
		})();

		return () => {
			disposed = true;
			sceneRef.current?.destroy();
			sceneRef.current = null;
		};
	}, [track]);

	/* Fullscreen is driven by the document, not by this component: Escape and
	   the browser's own chrome change it without going through the button */
	useEffect(() => {
		const onChange = () => {
			setIsFullscreen(document.fullscreenElement === figureRef.current);
			/* Cesium reads the canvas size synchronously, and the element has not
			   been re-laid-out yet when this event fires */
			requestAnimationFrame(() => sceneRef.current?.resize());
		};
		document.addEventListener('fullscreenchange', onChange);
		return () => document.removeEventListener('fullscreenchange', onChange);
	}, []);

	const toggleFullscreen = useCallback(async () => {
		try {
			if (document.fullscreenElement === figureRef.current) await document.exitFullscreen();
			else await figureRef.current?.requestFullscreen();
		} catch {
			/* Denied by the browser (iOS Safari has no element fullscreen);
			   the viewer stays usable inline, so there is nothing to report */
		}
	}, []);

	const isReady = duration !== null && !error;

	return (
		<figure ref={figureRef} className={styles.viewer} aria-label={label}>
			<div ref={mapRef} className={styles.map} />

			{!isReady && !error && (
				<div className={styles.loading} role="status">
					<span className={styles.spinner} aria-hidden="true" />
					<span>{status}</span>
				</div>
			)}

			{error && (
				<div className={styles.error} role="alert">
					{error}
				</div>
			)}

			{warning && !error && (
				<p className={styles.warning} role="status">
					{warning}
				</p>
			)}

			<div className={styles.buttons}>
				{!isAutoCamera && (
					<button
						className={styles.iconButton}
						type="button"
						onClick={() => sceneRef.current?.setAutoCamera(true)}
						aria-label="Follow the glider again"
						title="Follow the glider again"
					>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<circle cx="12" cy="12" r="7" />
							<path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
						</svg>
					</button>
				)}
				<button
					className={styles.iconButton}
					type="button"
					onClick={toggleFullscreen}
					aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
				>
					{isFullscreen ? (
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5" />
						</svg>
					) : (
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
						</svg>
					)}
				</button>
			</div>

			<dl className={styles.telemetry} aria-label="Flight telemetry">
				<div>
					<dt>Altitude</dt>
					<dd>{format(telemetry.altitudeMeters, (value) => `${Math.round(value)} m`)}</dd>
				</div>
				<div>
					<dt>Speed</dt>
					<dd>{format(telemetry.speedKph, (value) => `${value.toFixed(1)} km/h`)}</dd>
				</div>
				<div>
					<dt>Vario</dt>
					<dd>{format(telemetry.varioMps, (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)} m/s`)}</dd>
				</div>
				<div>
					<dt>Distance</dt>
					<dd>{format(telemetry.distanceKm, (value) => `${value.toFixed(2)} km`)}</dd>
				</div>
			</dl>

			<div className={styles.credits} ref={creditsRef} />

			<div className={styles.timeline} hidden={!isReady}>
				<button
					className={styles.play}
					type="button"
					onClick={() => sceneRef.current?.setPlaying(!isPlaying)}
					aria-label={isPlaying ? 'Pause flight' : 'Play flight'}
				>
					{isPlaying ? (
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 7v10M15 7v10" />
						</svg>
					) : (
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="m9 7 8 5-8 5Z" />
						</svg>
					)}
				</button>

				<span className={styles.time}>{formatDuration(telemetry.elapsedSeconds)}</span>

				<div className={styles.scrubberWrap}>
					{/* Fixed viewBox stretched to the track: the barograph is a
					    background, so its aspect ratio does not matter */}
					<svg className={styles.altitude} viewBox="0 0 1000 80" preserveAspectRatio="none" aria-hidden="true">
						<path d={altitudePath} />
					</svg>
					<input
						type="range"
						min={0}
						max={duration ?? 1}
						step={0.1}
						value={telemetry.elapsedSeconds}
						onChange={(event) => sceneRef.current?.seek(Number(event.target.value))}
						aria-label="Flight timeline"
					/>
					<span
						className={styles.progress}
						style={{ width: `${duration ? (telemetry.elapsedSeconds / duration) * 100 : 0}%` }}
					/>
				</div>

				<span className={`${styles.time} ${styles.timeEnd}`}>{formatDuration(duration ?? 0)}</span>
			</div>
		</figure>
	);
}

/** Em dash until the first frame has run, so the panel never shows `NaN`. */
function format(value: number, render: (value: number) => string): string {
	return Number.isFinite(value) ? render(value) : '—';
}
