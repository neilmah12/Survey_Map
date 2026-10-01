// Single-file build: the worker source is inlined (see scripts/build-single.sh) and served from a blob URL.
// Module workers cannot start from a blob on a file:// page, so the ".cjs" suffix makes maplibre use a
// classic worker (the fragment is ignored when the blob is fetched).
import source from '../generated/maplibre-worker.js?raw';

export default `${URL.createObjectURL(new Blob([source as string], { type: 'text/javascript' }))}#maplibre-worker.cjs`;
