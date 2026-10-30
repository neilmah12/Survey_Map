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

- Filters are independent multi-select chips that combine: Property type (Apartment, Townhome), Bedrooms
  (Studio, 1 Bed, 1 + Den, 2 Beds, 2 + Den, 3 Beds, 3 + Den, 4+), Bathrooms (1, 1.5, 2, 2.5, 3+) and Renovation
  (from a trailing "- Partial Reno" in the unit type). Choices within a
  detail are OR, details combine with AND, and empty means any. So "2 Beds" with bathrooms 1, 2 and
  2.5 shows all three, and "2 Beds" alone ignores bathrooms. Only choices present in the data are
  offered, and a building with no matching unit leaves the map.
- Property type comes from, in order: the building's Property type setting in the sidebar, a `Product` /
  `Property type` / `Building type` column in the sheet ("Townhouse", "Townhome", "TH", "Apartment"), a "TH" or
  "Townhome" marker in the unit type, the building name, then the survey title. The Property type chips show only
  when the survey has both. The sheet's value wins on Update from Excel; the sidebar setting is not written back.
- A survey with both types loads with the summary split by Property type ("3 Beds Townhome" and "3 Beds Apartment"
  are separate rows), so popups' "vs mkt" compares a townhome with townhomes. The split can be turned off.
- A `Vintage` column is read as Year built.
- Several buildings can be marked as the subject (for example a portfolio). Rings draw around each.

Net rent:

- Net rent is worked out from tick boxes saved with the survey: **Show net rent** (off hides it
  everywhere) and what counts: **Parking, Utilities, Incentives, Misc**. Nothing is ticked by default, so net
  equals base rent until you choose. Net = base + parking + utilities + misc, less incentives, each only
  when ticked. The definition (for example "Net rent = base rent + parking, less incentives") prints
  beside the metric, in the summary, and on image / PDF exports, and follows the boxes.
- Each suite's monthly amounts are read from the sheet's text ("$225 underground", "-$158", "1 month free"
  over the lease term, 12 months) and can be typed over in the sidebar under "Net rent amounts". An empty box
  means "use the text". Incentive is a positive discount; Misc is signed (fee positive, credit negative)
  with an optional label such as a Telus package. "Net rent override" beats the settings for that suite.
  Text with more than one offer ("1 month free, $500 bonus") or no dollar figure ("$500 gift card") is not
  guessed: Checks flags it when its box is ticked, and it is left out until an amount is typed.
- Free rent is spread over the lease term: rent x free months / term months. "1 month free on a 13 month lease"
  at $1,499 is $1,499 x 1 / 13 = $115 a month off. The term comes from the text ("on 15 month lease", "amortized
  over 13-month lease", "1 yr lease"); otherwise the default set beside the Incentives chip (12 months).
- The incentive box takes a dollar discount per month (128), free rent as months free / lease months (1/13, 2/18),
  or words ("2 months on a 24 month lease", "1 month free" on the default term). Free rent typed as a fraction is
  saved as months and term, so it follows the rent. Amount boxes take only a dollar figure: other text is not
  guessed at, the box says it was not read, and the saved value stays as it was.
- In the sidebar, each amount box is tagged "counted" or "not counted" from the survey-wide chips (clicking the
  tag changes it for the whole survey, so every building stays on the same definition). Boxes not counted are
  greyed. A free-rent incentive shows its sum, unreadable text shows a warning, and a line under each suite shows
  its net rent and how it adds up.
- The sheet's own Net Rent column is kept for reference and Excel write-back but no longer drives the
  figures. "Use it as the override" copies it into a suite's override.
- "Clients can change these" lets the client page tick the same boxes (only those the survey has amounts
  for). Their choices are not saved. Otherwise the client sees your selection and cannot change it.
- Popups show a "vs mkt" column: each suite against the market average for its unit type (same metric,
  average or median, and filters as the summary).

Dates:

- **As of** is the rent date clients see. New from Excel sets it to today. Update from Excel asks for it
  in the merge dialog: today when rents, SF, incentives or units changed, unchanged when only names,
  pins or photos did, and it can be set to any date. It can always be edited in the sidebar.
- **Last edited** is internal: stamped on every change and shown only in the editor sidebar.
- Dates use the local time zone, not UTC.

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


## Handoffs

Session handoffs live in `docs/handoffs/` (one dated file per session, newest listed first in its README). Start there when picking the project up in a new conversation.

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

## One-time setup order

Done once, in this order (each step needs the one before it):

1. Firebase console: create the Firestore database (production mode), then add `allowedUsers/<your email>`.
2. Firebase console, Hosting: add the second site `avison-young-rental-survey-dev`.
3. Firebase console, Authentication: enable Google, then add `avison-young-rental-survey-dev.web.app` under Settings, Authorized domains.
4. Firebase console: register a web app (no Hosting setup) and copy its public `apiKey`.
5. Google Cloud, IAM, Service Accounts: create `github-deploy` with Firebase Hosting Admin, Firebase Rules Admin and Service Usage Consumer, then create a JSON key.
6. GitHub: set the default branch to `main`, add secret `FIREBASE_SERVICE_ACCOUNT` (the JSON) and variable `VITE_FIREBASE_API_KEY`, then delete the downloaded key file.
7. Push to `main`. The workflow tests, then deploys the Firestore rules and both sites.

To add a teammate later: Firestore, `allowedUsers`, new document whose ID is their lowercase Gmail address.
