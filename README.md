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

Image and PDF export (Phase E):

- "Export image / PDF" builds a report page: AY header with the as-of date, the map drawn fresh at print
  size (so it is sharp at any page size), pins and rings exactly as in the app, scale bar, the map credit
  OpenFreeMap requires, an optional market summary table and legend, and a source line. Pick Letter
  landscape, Letter portrait or a 16:9 slide, 150 dpi (Word, email) or 300 dpi (print), and "what I see
  now" or all buildings. One preview, then Save PNG or Save PDF.
- It follows the current metric, unit filters, summary settings and switched-off properties, and leaves
  out buildings with no pin, so it matches the client file. Crowded pins use the same layout algorithm as
  the map (`src/lib/pinLayout.ts`). If the street map cannot load, the page has a plain background and the
  dialog says so.
- The PDF is a print-resolution picture of the page (`src/lib/pdf.ts` writes it, no library). Text in the
  PDF is therefore not selectable; a vector version is possible later.
- The source line is a survey field (Survey section of the sidebar); it is also shown on the client page.

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
- Firebase publishing hosts this same viewer and loads the same snapshot by id (see "Firebase").

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

Firebase (sign-in, saved surveys, client links, hosting): see "Firebase" below.

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


## Reminders

- When the app is hosted on Firebase: open an exported client file on a phone and test the layout
  (controls strip, popups, summary under the map) on real devices and the real basemap.
- Excel client export is on hold; the analyst supplies the Excel as the follow-up.


## Firebase

Project `avison-young-rental-survey`, Spark (free) plan: Authentication, Firestore and Hosting only. No Cloud
Storage, no Functions.

- **Two Hosting sites, one project.** The editor is on the dev site (`avison-young-rental-survey-dev.web.app`, `/`).
  Clients only ever see the client site (`avison-young-rental-survey.web.app/s/<id>`), which is built separately
  (`vite.hosting-client.config.ts`) and contains the viewer only. `scripts/check-client-bundle.mjs` fails the build if
  editor, Excel, storage or sign-in code reaches it. Targets are named in `.firebaserc`: `editor` and `client`.
- **Sign-in:** Google only. A person is on the team when a document exists at `allowedUsers/<lowercase email>` in
  Firestore. Add or remove people in the Firebase console (Firestore Database > allowedUsers); no deploy needed. The
  Firestore rules enforce it (verified email required); the sign-in screen only reflects it.
- **Saved surveys** (`src/lib/cloud.ts`, `cloudSplit.ts`, `hooks/useCloudSync.ts`): `surveys/{id}` is a small metadata
  document, `surveys/{id}/files/main` holds the survey JSON, and the uploaded workbook and each photo are separate
  documents named by a hash of their content. Every document stays under 1 MB (a file over about 0.9 MB is refused
  with a message). Changes autosave a moment after each edit. Each save checks a revision number, so if a teammate
  saved first you get a choice (keep mine, load theirs) instead of a silent overwrite. The browser copy in
  localStorage stays as the offline cache, and "Save file" / "Open" still make and read a backup file. Signing out
  clears the browser copy.
- **Client link** (`src/lib/publish.ts`, `publishSplit.ts`): "Client link" builds the same snapshot as the preview,
  runs the same checks, and stores it at `published/<128-bit random id>` with photos in `published/<id>/photos`.
  Update link re-publishes to the same id; Unpublish deletes the public documents but keeps the id reserved on the
  survey, so Publish again gives the same link. Deleting a survey also unpublishes it.
- **Client page** (`src/client/main.tsx`, `lib/publishedRead.ts`): reads the snapshot with a plain `fetch` to the Firestore
  REST API (no sign-in, no Firebase SDK), and loads each photo only when its popup opens.
- **Rules** (`firestore.rules`): published documents can be read by exact id (get) and never listed; every other
  read and write needs a team member. Tests: `npm run test:rules` (starts the Firestore emulator; needs Java).

### Run locally against the emulators

```
npx firebase emulators:start --only auth,firestore      # in one terminal
VITE_USE_EMULATORS=1 npm run dev                         # in another
```

In emulator mode there is a console helper for browser tests: `await window.__testSignIn('you@gmail.com')`
(the real Google pop-up needs Google's servers). Add that email first at `allowedUsers/<email>` through the
emulator. This helper does not exist in production builds. Real keys are never needed locally.

### Build

```
npm run build:hosting    # dist/editor and dist/client, with the client bundle check
```

### Deploying

`.github/workflows/deploy.yml` runs typecheck, unit tests, the rules tests and both builds on every pull request and
every push to `main`. Pull requests then get preview copies of both sites; a push to `main` deploys Firestore rules
and both sites. It needs the repository secret `FIREBASE_SERVICE_ACCOUNT` (the service account JSON key, never
committed) and the repository variable `VITE_FIREBASE_API_KEY` (the public web API key, not a secret). Until the secret
exists the deploy and preview steps skip with a warning instead of failing.

Preview sites cannot sign in (each preview has its own random address, which Google sign-in does not trust). They are
for checking the layout and the build. Test sign-in on the live dev site.

## Security notes

- The client page cannot hide what it shows: anyone with a published link can read that snapshot, and could save or
  share it. Send links only to the client, and use Unpublish to withdraw one.
- The editor's JavaScript is served to anyone who finds the dev site's address (static hosting cannot do otherwise).
  It is useless without a team sign-in, and the data is protected by the Firestore rules, not by hiding the page.
