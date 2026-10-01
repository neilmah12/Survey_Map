// maplibre 6 locates its worker next to the main bundle, which a bundler breaks; bundle it explicitly.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export default workerUrl;
