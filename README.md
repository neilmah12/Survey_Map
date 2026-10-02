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

Phase A (re-upload and Excel round trip):

- "Update from Excel" merges a revised sheet into the current survey. Buildings are matched by
  name plus address (street words normalised), then address, then name. Pins and photos are kept,
  a summary of changes is shown first, and the whole update can be undone.
- "Export Excel" writes Latitude, Longitude and Image URL columns into the uploaded workbook by
  editing the sheet XML directly, so pivot tables and everything else in the file are untouched.
  A re-upload then places every pin automatically.
- Undo / redo (buttons, Ctrl+Z, Ctrl+Shift+Z) for edits, pin moves and merges.

Unit groups and subjects:

- Unit type filter groups by bedrooms by default. "Split by" adds bathrooms (so 2 bed / 1 bath and
  2 bed / 2 bath are separate), renovation level (from a trailing "- Partial Reno" in the unit type)
  and townhome versus apartment. A split is only offered when the data has at least two values.
- Townhome or apartment comes from the building's Property type setting, then a "TH" or "Townhome"
  marker in the unit type, the building name, the survey title, and finally the rest of the survey.
- Several buildings can be marked as the subject (for example a portfolio). Rings draw around each.

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
