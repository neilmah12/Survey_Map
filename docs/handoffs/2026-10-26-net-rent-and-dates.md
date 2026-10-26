# Handoff 2026-10-26: net rent, dates, then Firebase

- Status: current
- Branch: `claude/stoic-sagan-476fvl`, commit `7bdea1c` (handoff doc added after it)
- Session: https://claude.ai/code/session_01YJAknm7DcFB5xK5h9L69tj
- Next task: Firebase (auth, saved surveys, publish, hosting, deploy)

## Prompt to paste into a new conversation

```
Project handoff: Avison Young rental market survey map (Edmonton multifamily)

REPO AND BRANCH
- GitHub repo: neilmah12/survey_map (add it to this session with push access).
- Work branch: claude/stoic-sagan-476fvl. There is no main branch and no PR yet.
- If the session starts in a different folder (for example RVTH-Pleasantview-supply-map), ignore that repo. Keep it clean. Do not commit app code there.
- Read docs/handoffs/README.md, then the newest handoff it lists, then README.md (features and decisions).
- Baseline check: npm install, npm test (163 tests pass), npm run build:single (builds dist-single/index.html, the single-file editor).

WHAT THE APP IS
A map plus survey-spreadsheet tool. Stack: Vite, React, TypeScript, MapLibre, ExcelJS. There is no backend today.
- Editor (src/App.tsx): upload an Excel survey, place or drag pins, edit values, filters (bedrooms, bathrooms, renovation), market summary (average or median, subject vs market), distance rings, Checks, undo and redo, Update from Excel (merge), Export Excel (writes pins, photos, edits and new buildings back into the workbook), Export image / PDF, Export client file.
- Client viewer (src/client/main.tsx): a separate read-only bundle that reads an allow-listed snapshot (src/lib/snapshot.ts) embedded in the HTML. It has no editor, Excel or storage code. scripts/check-client-bundle.mjs fails the build if editor code leaks in. Never widen the snapshot allow-list casually. Notes, contact details, the uploaded workbook and sheet net rent are never sent.
- Autosave is in browser localStorage (key survey-map:draft). Save file and Open give a JSON backup.

DONE IN THE LAST SESSION (all pushed, tested)
1. Net rent settings (src/lib/net.ts, saved on survey.net):
   - Checkboxes: Show net rent, Parking, Utilities, Incentives, Misc. Nothing is ticked by default, so net equals base rent until chosen.
   - Net = base + parking + utilities + misc, less incentives, each only when ticked.
   - The definition text follows the ticks. It shows under the metric buttons, in the summary and on exports.
   - Per-suite amounts in the sidebar (Net rent amounts): parkingAmt, utilitiesAmt, incentiveAmt (positive discount), miscAmt (signed) with miscLabel, and netOverride. An empty box means "read from the sheet text".
   - Text is parsed: "$225 underground", "-$158", "1 month free" spread over a 12-month term. Ambiguous text is not guessed: "$500 gift card" and "1 month free, $500 bonus" return null.
   - Checks warn when a ticked part has text but no readable amount.
   - The sheet's own Net Rent column is kept for reference and write-back only. "Use it as the override" copies it into netOverride.
   - "Clients can change these" lets the client page tick the same boxes (only those with data). Client choices are not saved.
   - The snapshot carries the worked-out amounts (parkingAmt and so on) and the net settings.
2. Popups have a "vs mkt" column: each suite against the market average for its unit type, using the current metric, stat and filters.
3. Dates:
   - As of is the rent date clients see. Update from Excel asks for it in the merge dialog. It defaults to today if rents, SF, incentives or units changed, and stays unchanged if only pins, names or photos did. It can be set to any date.
   - Sidebar: As of field plus "Set As of to today". "Last edited" (updatedAt) is stamped on every change and is internal only.
   - Dates use the local time zone (src/lib/dates.ts), not UTC.
4. Merge keeps per-suite exclusions and net amounts, matched by unit type.

NEXT TASK: FIREBASE (not started; no firebase.json, workflow or secret exists)
Project ID: avison-young-rental-survey. Free Spark plan: Authentication, Firestore, Hosting only.
1. Google sign-in limited to exactly 3 emails (I will supply them). Enforce the allowlist in Firestore security rules, not just the UI.
2. Saved surveys in Firestore, shared by the 3 users. Keep documents under 1 MB: store the workbook (base64) and photos as separate documents. Keep localStorage as the offline cache and Save file as a backup.
3. Publish button: build a snapshot (reuse toClientSnapshot and runChecks), store it at an unguessable id, show a private link, support Unpublish and re-publish. Rules: published snapshots readable by id (get, not list). Everything else is restricted to the 3 users.
4. Optional per-survey password: only by encrypting in the browser (WebCrypto). Explain the trade-offs and ask me before building it.
5. Hosting: editor at /, client viewer at /s/<id>, using a normal multi-page Vite build with a rewrite for /s/**. Verify the MapLibre worker still loads (src/lib/workerUrl.ts).
6. Firestore rules in the repo, with tests on the Firebase emulator: signed-out and non-allowlisted users cannot read or write surveys, anyone can read a published snapshot by id, nobody can list published snapshots.
7. GitHub Actions deploy. I will store a Firebase service-account key in a GitHub repo secret. Tell me the exact roles needed (the Admin SDK key often lacks Hosting and Rules deploy roles) and the exact console and GitHub steps. I will add the secret myself. NEVER ask for or print the key, and never commit keys. Deploy on push to main and use preview channels on PRs.
8. Create main from the feature branch via a PR when ready, and tell me the steps. Do not open a PR until I ask.

Tell me about any risk or mistake in this plan before building.

OUTSTANDING (non-blocking)
- Things only I can check: the real Edmonton basemap in exports, and a published client link on a real phone (layout, tapping pins, summary panel). The sandbox cannot load map tiles.
- Ideas not built: optional pin delta vs subject (second line on the pin, or a coloured pin edge, with fill left free), vector PDF (the current PDF is a picture), per-suite checkbox in the sidebar, Colab script for listing photo URLs, client Excel export (on hold), satellite basemap (declined), change log (declined).
- Known limits: Net Rent cells are blank for rows of buildings added in the app. Write-back skips formula cells, and new rows need empty space under the table.

HOW I WORK
Concise and direct, no em dashes. Build in small steps and test in real browser runs (Playwright with /opt/pw-browsers/chromium; launch with executablePath). Say plainly what you could not verify. Deliver preview files by copying dist-single/index.html to a scratch location and sending it, not by committing it.
When this session ends, add a new dated file in docs/handoffs/ and update its index. Do not overwrite older handoffs.

The 3 allowed emails: [paste here]
```
