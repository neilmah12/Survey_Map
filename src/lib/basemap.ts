import * as maplibregl from 'maplibre-gl';
import workerUrl from './workerUrl';

// maplibre 6 locates its worker next to the main bundle, which a bundler breaks; point it at the bundled one.
maplibregl.setWorkerUrl(workerUrl);

/** The basemap style: OpenFreeMap by default, or VITE_BASEMAP_STYLE (a style URL, or "blank" for no map). */
export const STYLE_URL = (import.meta.env.VITE_BASEMAP_STYLE as string | undefined) ?? 'https://tiles.openfreemap.org/styles/positron';

/** Plain background used when the basemap cannot load, so pins stay usable. */
export const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e6ebf2' } }],
};

export const initialStyle = (): string | maplibregl.StyleSpecification => (STYLE_URL === 'blank' ? BLANK_STYLE : STYLE_URL);

/** Credit required wherever a map made from this basemap is shown or exported. */
export const MAP_CREDIT = '© OpenStreetMap contributors, OpenMapTiles, OpenFreeMap';
