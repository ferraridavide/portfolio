/* CesiumJS is ~10 MB of JS plus its own worker and asset tree, so it is pulled
   from the official CDN on demand rather than bundled: nothing here is fetched
   until a viewer actually mounts. The prebuilt bundle derives its own base URL
   from the script tag, so `CESIUM_BASE_URL` does not need setting. */

const VERSION = '1.142';
const SCRIPT_URL = `https://cesium.com/downloads/cesiumjs/releases/${VERSION}/Build/Cesium/Cesium.js`;
const STYLE_URL = `https://cesium.com/downloads/cesiumjs/releases/${VERSION}/Build/Cesium/Widgets/widgets.css`;

/* Cesium ships no types for the CDN build, and the npm `@types` would drag in
   the package this module exists to avoid. */
export type CesiumApi = any;

declare global {
	interface Window {
		Cesium?: CesiumApi;
	}
}

let pending: Promise<CesiumApi> | undefined;

/** Resolves with `window.Cesium`, loading it once per page. */
export function loadCesium(): Promise<CesiumApi> {
	if (window.Cesium) return Promise.resolve(window.Cesium);
	pending ??= injectCesium();
	return pending;
}

function injectCesium(): Promise<CesiumApi> {
	if (!document.querySelector(`link[href="${STYLE_URL}"]`)) {
		const style = document.createElement('link');
		style.rel = 'stylesheet';
		style.href = STYLE_URL;
		document.head.append(style);
	}

	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
		const script = existing ?? document.createElement('script');
		script.addEventListener('load', () => {
			if (window.Cesium) resolve(window.Cesium);
			else reject(new Error('CesiumJS loaded but did not define window.Cesium.'));
		});
		script.addEventListener('error', () => {
			/* Let a later mount retry instead of latching the rejection forever */
			pending = undefined;
			script.remove();
			reject(new Error('CesiumJS could not be loaded from the CDN.'));
		});
		if (!existing) {
			script.src = SCRIPT_URL;
			script.async = true;
			document.head.append(script);
		}
	});
}
