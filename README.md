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

Survey checks (Phase C):

- The **Checks** button (badge = count of things to fix) lists mistakes before a client sees the map:
  buildings with no pin, no subject, duplicate buildings or shared pins, a pin far from the rest, rents or
  SF that look like typos, bedroom counts not recognised, placeholder text such as "TBC" in client-visible
  fields, unfinished internal notes ("need to confirm"), missing rents, an old or invalid as-of date,
  rents far from the market median (a prompt to switch them off in the summary), and units switched off.
  Excel checks (edits or added buildings not yet in the workbook) run when the dialog opens. Each line has a
  Show button that selects the building.
- Errors (no pins at all) block "Export client file"; warnings are listed in its dialog and the button
  becomes "Save anyway". Logic is `src/lib/checks.ts` and `src/lib/excelChecks.ts`.

Edits back to Excel:

- Export Excel also writes values changed in the app for buildings already in the sheet (unit type, SF,
  rent, net rent, parking, utilities, incentive, notes; building name, address, years, configuration,
  notes, contact). Cells that hold formulas are never overwritten and are reported; Excel is told to
  recalculate on open. Numeric cells stay numeric. See `pendingEdits` in `src/lib/exportXlsx.ts`.

Pins, measures and phones:

- Crowded pins stay readable: pills that would overlap lift straight up with a thin line to their spot, and
  a building name that would land on something is hidden until hover. Pin positions never change.
- Net rent and Rent PSF are offered only when some unit has a net figure or SF.
- A linked photo can be saved into the survey ("Save a copy in the survey") so it cannot disappear; the
  copy is kept over the sheet's link on re-upload.
- On a phone the client page uses a one-line swipeable controls strip, starts with the summary closed,
  and shows the summary under the map.

Market summary (Phase D):

- A panel beside the map, in the editor and in the client file, compares the subject with the market
  by unit type: market figure, subject figure and the difference in dollars and percent, plus a total
  row. It follows the metric (base rent, rent PSF, net rent) and the unit filters.
- The market is every building that is not a subject, so the subject is never compared with itself.
  Several subjects are averaged together. Average or median; default is that each building counts
  once (its own average per unit type first), and a switch makes every unit count instead.
- Rows are bedrooms (Studio, 1 Bed, 1 + Den, ...) with optional splits by bathrooms and renovation level.
- A whole building, or a single suite, can be switched off (an outlier). It stays on the map, greyed,
  and the summary says how many units are not counted. Switched-off flags survive a re-upload. Clients
  can only switch properties on and off if the survey allows it, and their changes are not saved.
- Only buildings with a pin are counted, so the editor and the client file show the same numbers.
- The engine is `src/lib/summary.ts`. Its tests reproduce the pivot tables in the Glenora, River
  Valley and Boardwalk sample sheets (unit level, as those pivots average rows) and hand-worked
  building-level examples.

Client file (Phase B):

- "Export client file" saves a single HTML file that opens in any browser with no login. It holds a
  snapshot built from an allow-list of fields (see `src/lib/snapshot.ts`): building and unit details a
  client should see, pins, photos, listing links and the starting view. Notes, contact details,
  unrecognised columns, the uploaded workbook and editor flags are never copied. Buildings without a
  pin are left out and listed in the export dialog. Stacked / non-stacked shows for townhomes only.
- The file contains the client viewer only (`src/client/main.tsx`), not the editor. `npm run build:single`
  builds the viewer first and fails if it contains editor, Excel or storage code
  (`scripts/check-client-bundle.mjs`), then embeds it as the editor's export template.
- "Preview client view" renders the same snapshot through the same viewer, so it matches the file.
- Firebase publishing will host this same viewer and load the same snapshot.

Adding buildings in the app:

- Drag a building from the Buildings list onto the map to place (or move) its pin; Undo reverts it.
- "Add building" (toolbar or the Buildings list) creates a building, then waits for a click on the
  map to place it. Add or remove units and fill in its details in the sidebar.
- "Export Excel" writes added buildings into the empty rows directly under the sheet's table, copying
  the look of an existing building (banding, number formats, row height, merged name/year/address
  cells, live rent PSF formula). Rows are never inserted, because that would also have to move pivot
  tables, pictures and formulas below the table. If there is not enough room, the app says how many
  blank rows to insert in Excel; then use Update from Excel and export again.
- A building added in the app is kept when the sheet is re-uploaded until the sheet contains it.

Unit filters and subjects:

- Filters are independent multi-select chips that combine: Bedrooms (Studio, 1 Bed, 1 + Den,
  2 Beds, 2 + Den, 3 Beds, 3 + Den, 4+), Bathrooms (1, 1.5, 2, 2.5, 3+) and Renovation (from a trailing
  "- Partial Reno" in the unit type). There is no townhome / apartment filter or split: a survey is
  normally one or the other. Choices within a
  detail are OR, details combine with AND, and empty means any. So "2 Beds" with bathrooms 1, 2 and
  2.5 shows all three, and "2 Beds" alone ignores bathrooms. Only choices present in the data are
  offered, and a building with no matching unit leaves the map.
- Townhome or apartment is still detected (the building's Property type setting, a "TH" or "Townhome"
  marker, the building name, the survey title) but only to decide whether Stacked / non-stacked shows.
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
