# Survey Map

Interactive map companion for rental market surveys. Upload the survey workbook, place
and adjust pins in the browser, then publish a read-only client view.

## Status

Phase 1 (local prototype) is in place:

- Upload an `.xlsx` survey. Townhome and apartment templates both parse: merged building cells,
  varying columns, notes and summary tables below the data, and the subject property
  (dark-filled row) are all handled. See `src/lib/parse.ts` for header aliases.
- Place pins by clicking the map, pasting `lat, lng`, or adding `Latitude` / `Longitude`
  columns to the sheet. Drag pins to adjust. Edit building and unit values in the sidebar.
- Metric toggle (base rent, rent PSF, net rent), unit type filter, incentive badge, as-of date,
  AY header.
- Distance rings from the subject are off by default; toggle them on and set custom distances
  (default 0.5 / 1 / 2 km, add or remove rings in edit mode).
- Property photo in the pin popup: add an `Image URL` column to the sheet (also `Image`, `Photo`),
  paste an image address in the editor, or upload a photo (shrunk to 800 px and stored with the
  survey). The listing `URL` column becomes a "View listing" link and the photo's click target.
- "Preview client view" shows the read-only map. Drafts autosave in the browser; "Save file" and
  "Open" round-trip a `.survey.json`.

Planned: Firebase Auth (3-user allowlist), Firestore drafts, published read-only snapshots at
unguessable URLs, PDF/image export.

## Develop

```
npm install
npm run dev        # http://localhost:5173
npm test           # parser tests against tests/fixtures
npm run build
```

Basemap: OpenFreeMap "positron" by default. Override with `VITE_BASEMAP_STYLE` (a style URL,
or `blank` for a plain background). If the basemap fails to load, the app falls back to a
plain background so pins remain usable.
