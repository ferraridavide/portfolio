/* The Cesium half of the flight viewer: it owns the globe, the track entities
   and the chase camera, and reports telemetry back through `onFrame`. Kept
   out of the React component so the component is only markup and wiring.
   Everything here is imperative on purpose — Cesium drives its own render
   loop and React should not re-render at 60 Hz to keep up with it. */

import type { CesiumApi } from './cesium';
import { buildAltitudePath, type IgcFix } from './igc';

export interface CameraSettings {
	/** How far behind the glider the camera sits */
	distanceMeters: number;
	/** How high above it, measured from the horizon */
	elevationAngleDegrees: number;
	/** Aims slightly ahead of the glider so it never hugs the frame edge */
	lookAheadSeconds: number;
	lagSeconds: number;
	/** Width of the Gaussian that smooths GPS jitter out of the camera path */
	followSmoothingSeconds: number;
	headingSmoothingSeconds: number;
	/** Applied only when the camera follows the track's own heading */
	headingOffsetDegrees: number;
	/** A compass-locked camera reads far calmer than a heading-locked one on a
	   paraglider track, where every thermal turn would otherwise spin the view */
	fixedHeadingEnabled: boolean;
	fixedHeadingDegrees: number;
	/** Long lens: the terrain stays compressed and cinematic */
	fieldOfViewDegrees: number;
	minimumTerrainClearanceMeters: number;
}

export const DEFAULT_CAMERA: CameraSettings = Object.freeze({
	distanceMeters: 5000,
	elevationAngleDegrees: 20,
	lookAheadSeconds: 0.35,
	lagSeconds: 0,
	followSmoothingSeconds: 1.5,
	headingSmoothingSeconds: 8,
	headingOffsetDegrees: 180,
	fixedHeadingEnabled: true,
	fixedHeadingDegrees: 0,
	fieldOfViewDegrees: 25,
	minimumTerrainClearanceMeters: 30,
});

export interface Telemetry {
	elapsedSeconds: number;
	altitudeMeters: number;
	speedKph: number;
	varioMps: number;
	distanceKm: number;
}

export interface FlightSceneOptions {
	cesium: CesiumApi;
	/** Element the globe is rendered into */
	container: HTMLElement;
	/** Element Cesium writes its imagery and terrain attribution into */
	creditContainer: HTMLElement;
	fixes: IgcFix[];
	ionToken: string;
	/** Seconds of flight per second of playback */
	playbackRate?: number;
	/** How much of the track stays lit behind the glider */
	trailLengthMeters?: number;
	/** Draws the whole route faintly before it has been flown */
	showGhostRoute?: boolean;
	camera?: Partial<CameraSettings>;
	onFrame: (telemetry: Telemetry, isPlaying: boolean) => void;
	onCameraModeChange?: (mode: 'auto' | 'manual') => void;
	/* Terrain or imagery failed to load. The track, the telemetry and the
	   playback all still work, so this is a degraded view, not a failure. */
	onAssetError?: (message: string) => void;
}

interface Sample {
	time: any;
	position: any;
	cartographic: any;
	elapsedSeconds: number;
	altitudeMeters: number;
	distanceMeters: number;
	speedMps: number;
}

interface InterpolatedSample {
	lowerIndex: number;
	position: any;
	altitudeMeters: number;
	speedMps: number;
	distanceMeters: number;
}

const TRACK_COLOR = '#efad38';
const GLIDER_COLOR = '#fff4d6';
const GHOST_COLOR = '#e7f4ef';
/** Window the climb rate is averaged over; shorter and it reads as noise */
const VARIO_WINDOW_SECONDS = 5;

export class FlightScene {
	private readonly cesium: CesiumApi;
	private readonly options: Required<
		Omit<FlightSceneOptions, 'camera' | 'onCameraModeChange' | 'onAssetError'>
	> & {
		camera: CameraSettings;
		onCameraModeChange?: FlightSceneOptions['onCameraModeChange'];
		onAssetError?: FlightSceneOptions['onAssetError'];
	};
	private readonly samples: Sample[];
	private readonly viewer: any;
	private readonly tickListener: (clock: any) => void;
	private readonly onInteract: () => void;

	private trailPositions: any[] = [];
	private isAutoCameraEnabled = true;
	private lastElapsedSeconds = Number.NaN;
	private destroyed = false;

	/** Seconds of flight from the first fix to the last */
	readonly durationSeconds: number;
	/** `d` for the barograph drawn behind the scrubber */
	readonly altitudePath: string;

	constructor(options: FlightSceneOptions) {
		this.cesium = options.cesium;
		this.options = {
			playbackRate: 10,
			trailLengthMeters: 5000,
			showGhostRoute: false,
			...options,
			camera: { ...DEFAULT_CAMERA, ...options.camera },
		};

		this.samples = this.buildSamples(options.fixes);
		this.durationSeconds = this.samples[this.samples.length - 1]!.elapsedSeconds;
		this.altitudePath = buildAltitudePath(options.fixes, this.durationSeconds);

		this.viewer = this.createViewer();
		this.renderTrack();

		this.tickListener = (clock: any) => this.updateAtTime(clock.currentTime);
		this.viewer.clock.onTick.addEventListener(this.tickListener);

		/* Any drag, pinch or wheel hands the camera to the reader for good */
		this.onInteract = () => this.setAutoCamera(false);
		options.container.addEventListener('pointerdown', this.onInteract);
		options.container.addEventListener('wheel', this.onInteract, { passive: true });

		this.updateAtTime(this.viewer.clock.currentTime, true);
	}

	/* --- playback ------------------------------------------------------- */

	get isPlaying(): boolean {
		return this.viewer.clock.shouldAnimate;
	}

	setPlaying(playing: boolean): void {
		this.viewer.clock.shouldAnimate = playing;
		this.updateAtTime(this.viewer.clock.currentTime, true);
	}

	/** Jumps to `elapsedSeconds` from the start of the flight and pauses. */
	seek(elapsedSeconds: number): void {
		const { JulianDate } = this.cesium;
		this.viewer.clock.shouldAnimate = false;
		this.viewer.clock.currentTime = JulianDate.addSeconds(
			this.samples[0]!.time,
			clamp(elapsedSeconds, 0, this.durationSeconds),
			new JulianDate(),
		);
		this.updateAtTime(this.viewer.clock.currentTime, true);
	}

	/** Back to the chase camera after the reader has dragged the globe. */
	setAutoCamera(enabled: boolean): void {
		if (this.isAutoCameraEnabled === enabled) return;
		this.isAutoCameraEnabled = enabled;
		this.options.onCameraModeChange?.(enabled ? 'auto' : 'manual');
		if (enabled) this.updateAtTime(this.viewer.clock.currentTime, true);
	}

	/** Cesium sizes its canvas from the container, which fullscreen changes. */
	resize(): void {
		if (this.destroyed) return;
		this.viewer.resize();
		this.viewer.scene.requestRender();
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.options.container.removeEventListener('pointerdown', this.onInteract);
		this.options.container.removeEventListener('wheel', this.onInteract);
		this.viewer.clock.onTick.removeEventListener(this.tickListener);
		if (!this.viewer.isDestroyed()) this.viewer.destroy();
	}

	/* --- setup ---------------------------------------------------------- */

	/** Turns parsed fixes into Cesium geometry, with cumulative distance and
	   ground speed derived from the gap between consecutive fixes. */
	private buildSamples(fixes: IgcFix[]): Sample[] {
		const { Cartesian3, Cartographic, EllipsoidGeodesic, JulianDate } = this.cesium;

		const samples: Sample[] = fixes.map((fix) => {
			const position = Cartesian3.fromDegrees(fix.longitude, fix.latitude, fix.altitudeMeters);
			return {
				time: JulianDate.fromDate(new Date(fix.timeMs)),
				position,
				cartographic: Cartographic.fromCartesian(position),
				elapsedSeconds: fix.elapsedSeconds,
				altitudeMeters: fix.altitudeMeters,
				distanceMeters: 0,
				speedMps: 0,
			};
		});

		let cumulativeDistance = 0;
		for (let index = 1; index < samples.length; index += 1) {
			const previous = samples[index - 1]!;
			const current = samples[index]!;
			/* Surface distance, so a climb does not read as ground speed */
			const distance = new EllipsoidGeodesic(previous.cartographic, current.cartographic).surfaceDistance;
			const seconds = current.elapsedSeconds - previous.elapsedSeconds;
			cumulativeDistance += distance;
			current.distanceMeters = cumulativeDistance;
			current.speedMps = seconds > 0 ? distance / seconds : previous.speedMps;
		}
		return samples;
	}

	private createViewer(): any {
		const { Ion, Terrain, ImageryLayer, Viewer } = this.cesium;
		Ion.defaultAccessToken = this.options.ionToken;

		const terrain = Terrain.fromWorldTerrain({ requestVertexNormals: true, requestWaterMask: true });
		const baseLayer = ImageryLayer.fromWorldImagery({});
		terrain.errorEvent.addEventListener(() =>
			this.options.onAssetError?.('Cesium World Terrain could not load. Check the ion token and its scopes.'),
		);
		baseLayer.errorEvent.addEventListener(() =>
			this.options.onAssetError?.('Cesium World Imagery could not load. Check the ion token and its scopes.'),
		);

		const viewer = new Viewer(this.options.container, {
			/* Every widget is off: the component draws its own chrome */
			animation: false,
			baseLayerPicker: false,
			fullscreenButton: false,
			geocoder: false,
			homeButton: false,
			infoBox: false,
			navigationHelpButton: false,
			sceneModePicker: false,
			selectionIndicator: false,
			timeline: false,
			baseLayer,
			terrain,
			scene3DOnly: true,
			/* Nothing moves while paused, so frames are drawn on request only */
			requestRenderMode: true,
			maximumRenderTimeChange: Number.POSITIVE_INFINITY,
			msaaSamples: 4,
			creditContainer: this.options.creditContainer,
			contextOptions: { webgl: { antialias: true, powerPreference: 'high-performance' } },
		});
		/* Without this the track draws through the ridge it flies behind */
		viewer.scene.globe.depthTestAgainstTerrain = true;
		viewer.scene.globe.maximumScreenSpaceError = 1.5;
		return viewer;
	}

	private renderTrack(): void {
		const {
			CallbackProperty,
			ClockRange,
			Color,
			LinearApproximation,
			NearFarScalar,
			PolylineOutlineMaterialProperty,
			SampledPositionProperty,
			TimeInterval,
			TimeIntervalCollection,
		} = this.cesium;

		const positions = this.samples.map((sample) => sample.position);
		const start = this.samples[0]!.time;
		const stop = this.samples[this.samples.length - 1]!.time;

		const position = new SampledPositionProperty();
		for (const sample of this.samples) position.addSample(sample.time, sample.position);
		/* Linear, not the default Lagrange: a higher degree overshoots on the
		   sharp corners of a thermalling track and the glider leaves its line */
		position.setInterpolationOptions({
			interpolationDegree: 1,
			interpolationAlgorithm: LinearApproximation,
		});

		if (this.options.showGhostRoute) {
			this.viewer.entities.add({
				polyline: { positions, width: 3, material: Color.fromCssColorString(GHOST_COLOR).withAlpha(0.22) },
			});
		}

		this.viewer.entities.add({
			polyline: {
				/* Re-read every frame: the trail is a moving window of the track */
				positions: new CallbackProperty(() => this.trailPositions, false),
				width: 5,
				material: new PolylineOutlineMaterialProperty({
					color: Color.fromCssColorString(TRACK_COLOR),
					outlineColor: Color.BLACK.withAlpha(0.85),
					outlineWidth: 2,
				}),
			},
		});

		this.viewer.entities.add({
			availability: new TimeIntervalCollection([new TimeInterval({ start, stop })]),
			position,
			point: {
				color: Color.fromCssColorString(GLIDER_COLOR),
				pixelSize: 11,
				outlineColor: Color.BLACK.withAlpha(0.85),
				outlineWidth: 3,
				scaleByDistance: new NearFarScalar(100, 1.4, 20_000, 0.7),
			},
		});

		const clock = this.viewer.clock;
		clock.startTime = start.clone();
		clock.stopTime = stop.clone();
		clock.currentTime = start.clone();
		clock.clockRange = ClockRange.LOOP_STOP;
		clock.multiplier = this.options.playbackRate;
		clock.shouldAnimate = false;

		this.frameTrack(positions);
	}

	/** Opening shot: the whole flight in frame before playback starts. */
	private frameTrack(positions: any[]): void {
		const { BoundingSphere, HeadingPitchRange } = this.cesium;
		const sphere = BoundingSphere.fromPoints(positions);
		this.viewer.camera.flyToBoundingSphere(sphere, {
			duration: 0,
			offset: new HeadingPitchRange(0, -0.6, Math.max(1200, sphere.radius * 2.25)),
		});
		this.viewer.scene.requestRender();
	}

	/* --- per-frame ------------------------------------------------------ */

	private updateAtTime(time: any, force = false): void {
		if (this.destroyed) return;
		const { JulianDate } = this.cesium;
		const elapsed = clamp(JulianDate.secondsDifference(time, this.samples[0]!.time), 0, this.durationSeconds);
		/* The clock ticks every animation frame even while paused; without this
		   a paused viewer would re-render the globe and React 60 times a second */
		if (!force && elapsed === this.lastElapsedSeconds) return;
		this.lastElapsedSeconds = elapsed;

		const current = interpolate(this.cesium, this.samples, elapsed);
		this.trailPositions = this.buildTrail(current);
		if (this.isAutoCameraEnabled) this.applyAutoCamera(elapsed);

		this.options.onFrame(
			{
				elapsedSeconds: elapsed,
				altitudeMeters: current.altitudeMeters,
				speedKph: current.speedMps * 3.6,
				varioMps: this.calculateVariometer(elapsed),
				distanceKm: current.distanceMeters / 1000,
			},
			this.viewer.clock.shouldAnimate,
		);
		this.viewer.scene.requestRender();
	}

	/** The lit tail behind the glider: the last `trailLengthMeters` of track. */
	private buildTrail(current: InterpolatedSample): any[] {
		const startDistance = Math.max(0, current.distanceMeters - this.options.trailLengthMeters);
		let startIndex = current.lowerIndex;
		while (startIndex > 0 && this.samples[startIndex]!.distanceMeters > startDistance) startIndex -= 1;
		return [
			...this.samples.slice(startIndex, current.lowerIndex + 1).map((sample) => sample.position),
			current.position,
		];
	}

	/** Climb rate averaged over the trailing few seconds, as a vario reads it. */
	private calculateVariometer(elapsedSeconds: number): number {
		const startSeconds = Math.max(0, elapsedSeconds - VARIO_WINDOW_SECONDS);
		const duration = elapsedSeconds - startSeconds;
		if (duration <= 0) return 0;
		const current = interpolate(this.cesium, this.samples, elapsedSeconds);
		const start = interpolate(this.cesium, this.samples, startSeconds);
		return (current.altitudeMeters - start.altitudeMeters) / duration;
	}

	private applyAutoCamera(elapsedSeconds: number): void {
		const settings = this.options.camera;
		/* The smoothing windows are expressed in flight seconds, so a faster
		   playback has to widen them to stay equally steady on screen */
		const rate = this.options.playbackRate;
		const focusTime = elapsedSeconds - settings.lagSeconds * rate;
		const smoothing = settings.followSmoothingSeconds * rate;
		const focus = this.smoothPosition(focusTime, smoothing);
		const target = this.smoothPosition(focusTime + settings.lookAheadSeconds * rate, smoothing);

		const destination = this.calculateCameraDestination(focus, target, settings);
		this.applyTerrainClearance(destination, settings.minimumTerrainClearanceMeters);
		this.applyCameraView(destination, target, settings.fieldOfViewDegrees);
	}

	/** Five-tap Gaussian over the track, which removes GPS jitter from the
	   camera without the lag a running average would add. */
	private smoothPosition(elapsedSeconds: number, windowSeconds: number): any {
		const { Cartesian3 } = this.cesium;
		if (windowSeconds <= 0) return interpolate(this.cesium, this.samples, elapsedSeconds).position;

		const offsets = [-2, -1, 0, 1, 2];
		const weights = [0.0545, 0.2442, 0.4026, 0.2442, 0.0545];
		const position = new Cartesian3(0, 0, 0);
		const weighted = new Cartesian3();
		offsets.forEach((offset, index) => {
			const sample = interpolate(this.cesium, this.samples, elapsedSeconds + offset * windowSeconds);
			Cartesian3.multiplyByScalar(sample.position, weights[index], weighted);
			Cartesian3.add(position, weighted, position);
		});
		return position;
	}

	/** Places the camera on a sphere around the glider, in its local frame. */
	private calculateCameraDestination(focus: any, target: any, settings: CameraSettings): any {
		const { Cartesian3, Math: CesiumMath, Matrix4, Transforms } = this.cesium;
		const frame = Transforms.eastNorthUpToFixedFrame(focus);
		const heading = this.calculateOrbitHeading(frame, target, settings);
		const elevation = CesiumMath.toRadians(settings.elevationAngleDegrees);
		const horizontalDistance = Math.cos(elevation) * settings.distanceMeters;
		const localOffset = new Cartesian3(
			-Math.sin(heading) * horizontalDistance,
			-Math.cos(heading) * horizontalDistance,
			Math.sin(elevation) * settings.distanceMeters,
		);
		return Matrix4.multiplyByPoint(frame, localOffset, new Cartesian3());
	}

	private calculateOrbitHeading(frame: any, targetPosition: any, settings: CameraSettings): number {
		const { Cartesian3, Math: CesiumMath, Matrix4 } = this.cesium;
		if (settings.fixedHeadingEnabled) return CesiumMath.toRadians(settings.fixedHeadingDegrees);
		const inverseFrame = Matrix4.inverseTransformation(frame, new Matrix4());
		const localTarget = Matrix4.multiplyByPoint(inverseFrame, targetPosition, new Cartesian3());
		return Math.atan2(localTarget.x, localTarget.y) + CesiumMath.toRadians(settings.headingOffsetDegrees);
	}

	/** Lifts the camera above any ridge it would otherwise be buried in. */
	private applyTerrainClearance(destination: any, minimumClearanceMeters: number): void {
		const { Cartesian3, Cartographic } = this.cesium;
		const cartographic = Cartographic.fromCartesian(destination);
		const terrainHeight = this.viewer.scene.globe.getHeight(cartographic);
		/* Undefined until the tile under the camera has loaded */
		if (terrainHeight === undefined) return;
		cartographic.height = Math.max(cartographic.height, terrainHeight + minimumClearanceMeters);
		Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, cartographic.height, undefined, destination);
	}

	/** `setView` with an explicit basis rather than heading/pitch/roll, so the
	   horizon stays level however steeply the camera looks down. */
	private applyCameraView(destination: any, target: any, fieldOfViewDegrees: number): void {
		const { Cartesian3, Math: CesiumMath, PerspectiveFrustum } = this.cesium;
		const direction = Cartesian3.normalize(
			Cartesian3.subtract(target, destination, new Cartesian3()),
			new Cartesian3(),
		);
		const geodeticUp = Cartesian3.normalize(destination, new Cartesian3());
		const right = Cartesian3.normalize(Cartesian3.cross(direction, geodeticUp, new Cartesian3()), new Cartesian3());
		const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());

		this.viewer.camera.setView({ destination, orientation: { direction, up } });
		if (this.viewer.camera.frustum instanceof PerspectiveFrustum) {
			this.viewer.camera.frustum.fov = CesiumMath.toRadians(fieldOfViewDegrees);
		}
	}
}

/** Linear blend between the two fixes straddling `elapsedSeconds`. */
function interpolate(cesium: CesiumApi, samples: Sample[], elapsedSeconds: number): InterpolatedSample {
	const clamped = clamp(elapsedSeconds, 0, samples[samples.length - 1]!.elapsedSeconds);
	const lowerIndex = findLowerIndex(samples, clamped);
	const lower = samples[lowerIndex]!;
	const upper = samples[Math.min(lowerIndex + 1, samples.length - 1)]!;
	const span = upper.elapsedSeconds - lower.elapsedSeconds;
	const fraction = span > 0 ? (clamped - lower.elapsedSeconds) / span : 0;

	return {
		lowerIndex,
		position: cesium.Cartesian3.lerp(lower.position, upper.position, fraction, new cesium.Cartesian3()),
		altitudeMeters: lerp(lower.altitudeMeters, upper.altitudeMeters, fraction),
		speedMps: lerp(lower.speedMps, upper.speedMps, fraction),
		distanceMeters: lerp(lower.distanceMeters, upper.distanceMeters, fraction),
	};
}

/** Last index whose fix is at or before `elapsedSeconds`, never the final one. */
function findLowerIndex(samples: Sample[], elapsedSeconds: number): number {
	let low = 0;
	let high = samples.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if (samples[middle]!.elapsedSeconds <= elapsedSeconds) low = middle;
		else high = middle - 1;
	}
	return Math.min(low, samples.length - 2);
}

function lerp(start: number, end: number, fraction: number): number {
	return start + (end - start) * fraction;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value));
}
