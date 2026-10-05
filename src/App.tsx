import logo from './assets/avison-young-logo.png';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_SUMMARY, type Building, type LngLat, type Survey, type Unit, type ViewSettings } from './types';
import { parseSurvey } from './lib/parse';
import { toBase64 } from './lib/base64';
import { exportWithCoordinates } from './lib/exportXlsx';
import { mergeSurvey, type MergeSummary } from './lib/merge';
import { downloadBlob, downloadJson, loadDraft, saveDraft } from './lib/store';
import { NO_FILTERS } from './lib/groups';
import { useUndoable } from './hooks/useUndoable';
import MergeDialog from './components/MergeDialog';
import ClientViewer from './components/ClientViewer';
import SummaryPanel from './components/SummaryPanel';
import ChecksDialog, { ChecksList } from './components/ChecksDialog';
import ExportDialog from './components/ExportDialog';
import { countBySeverity, runChecks, type Check } from './lib/checks';
import { excelChecks } from './lib/excelChecks';
import { embedSnapshot, snapshotToSurvey, snapshotToView, summarizeSnapshot, toClientSnapshot, type SnapshotResult } from './lib/snapshot';
import { getClientTemplate } from './lib/clientTemplate';
import ConfirmDialog from './components/ConfirmDialog';
import Header from './components/Header';
import Controls, { DEFAULT_RINGS } from './components/Controls';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';

const DEFAULT_VIEW: ViewSettings = { metric: 'rate', summary: DEFAULT_SUMMARY, filters: NO_FILTERS, rings: false, ringsKm: DEFAULT_RINGS };

/** Parses a workbook and keeps the original bytes so coordinates can be written back later. */
async function readWorkbook(file: File): Promise<Survey> {
  const data = await file.arrayBuffer();
  const survey = await parseSurvey(data);
  return { ...survey, source: { name: file.name, data: toBase64(data) } };
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export default function App() {
  const [draft] = useState(() => loadDraft());
  const [restoredAt, setRestoredAt] = useState<string | null>(() => (draft ? draft.savedAt ?? 'earlier' : null));
  const { state: survey, set: setSurvey, reset: resetSurvey, undo, redo, canUndo, canRedo } = useUndoable<Survey | null>(() => draft?.survey ?? null);
  const [pendingNew, setPendingNew] = useState<{ fileName: string; survey: Survey } | null>(null);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const [needRows, setNeedRows] = useState<{ buildings: string[]; rows: number; afterRow: number } | null>(null);
  const [pending, setPending] = useState<{ fileName: string; survey: Survey; summary: MergeSummary } | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);
  const [preview, setPreview] = useState(false);
  const [clientExport, setClientExport] = useState<SnapshotResult | null>(null);
  const [checksOpen, setChecksOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const viewBounds = useRef<[LngLat, LngLat] | null>(null);
  const [excelList, setExcelList] = useState<Check[]>([]);
  const [excelLoading, setExcelLoading] = useState(false);
  const [skippedEdits, setSkippedEdits] = useState<{ building: string; field: string; reason: string }[] | null>(null);
  const clientTemplate = useMemo(() => getClientTemplate(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [error, setError] = useState('');
  const excelInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!saveDraft(survey)) setNotice({ text: 'Browser autosave is full. Use "Save file" to keep your work.', warn: true });
  }, [survey]);

  useEffect(() => {
    if (!notice || notice.warn) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!placingId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPlacingId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placingId]);

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo (left alone while typing in a field).
  useEffect(() => {
    if (preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || !(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) (e.preventDefault(), undo());
      else if ((k === 'z' && e.shiftKey) || k === 'y') (e.preventDefault(), redo());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, undo, redo]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPreview(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const patchBuilding = useCallback((id: string, patch: Partial<Building>) => {
    setSurvey((s) => s && { ...s, buildings: s.buildings.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  }, []);

  const patchUnit = useCallback((bid: string, uid: string, patch: Partial<Unit>) => {
    setSurvey(
      (s) =>
        s && {
          ...s,
          buildings: s.buildings.map((b) =>
            b.id === bid ? { ...b, units: b.units.map((u) => (u.id === uid ? { ...u, ...patch } : u)) } : b,
          ),
        },
    );
  }, []);

  const installSurvey = (next: Survey) => {
    resetSurvey(next);
    setView((v) => ({ ...v, filters: NO_FILTERS })); // filter choices belong to the previous survey
    setRestoredAt(null);
    setSelectedId(null);
    setPlacingId(null);
    setFitKey((k) => k + 1);
    const unplaced = next.buildings.filter((b) => !b.lngLat).length;
    setNotice({
      text: `Loaded ${next.buildings.length} buildings.${unplaced ? ` ${unplaced} need a pin: drag each one from the list onto the map.` : ''}`,
    });
  };

  const loadExcel = async (file: File) => {
    setError('');
    try {
      const next = await readWorkbook(file);
      if (survey) setPendingNew({ fileName: file.name, survey: next });
      else installSurvey(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that workbook');
    }
  };

  const startMerge = async (file: File) => {
    setError('');
    try {
      const incoming = await readWorkbook(file);
      const { survey: merged, summary } = mergeSurvey(survey!, incoming);
      setPending({ fileName: file.name, survey: merged, summary });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that workbook');
    }
  };

  const newUnit = (): Unit => ({
    id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: '', beds: null, sf: null, rate: null, netRate: null, parking: '', utilities: '', incentive: '', notes: '', extras: {},
  });

  /** Adds an empty building, selects it, and waits for a click on the map to place its pin. */
  const addBuilding = () => {
    const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    setSurvey(
      (s) =>
        s && {
          ...s,
          buildings: [
            ...s.buildings,
            {
              id, name: 'New building', address: '', yearBuilt: '', yearRenovated: '', configuration: '', isSubject: false,
              addedInApp: true, lngLat: null, propertyNotes: '', contact: '', url: '', imageUrl: '', units: [newUnit()],
            },
          ],
        },
      { commit: true },
    );
    setSelectedId(id);
    setPlacingId(id);
    setNotice({ text: 'Click the map to place the new building (or drag it from the list), then fill in its details.' });
  };

  const applyMerge = () => {
    if (!pending) return;
    setSurvey(pending.survey, { commit: true });
    if (selectedId && !pending.survey.buildings.some((b) => b.id === selectedId)) setSelectedId(null);
    setNotice({ text: 'Updated from Excel. Use Undo to revert.' });
    setPending(null);
  };

  const exportExcel = async () => {
    if (!survey) return;
    setError('');
    try {
      const result = await exportWithCoordinates(survey);
      const { data, name } = result;
      downloadBlob(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
      const pins = survey.buildings.filter((b) => b.lngLat).length;
      const added =
        (result.addedBuildings ? ` and ${result.addedBuildings} new building${result.addedBuildings === 1 ? '' : 's'}` : '') +
        (result.editsWritten ? `, ${result.editsWritten} edit${result.editsWritten === 1 ? '' : 's'}` : '');
      setNotice({
        text: `Exported ${pins} of ${survey.buildings.length} pin${pins === 1 ? '' : 's'}${added} to ${name}`,
        warn: pins < survey.buildings.length,
      });
      if (result.needRows) setNeedRows(result.needRows);
      if (result.editsSkipped.length) setSkippedEdits(result.editsSkipped);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export the workbook');
    }
  };

  const loadJson = async (file: File) => {
    setError('');
    try {
      const next = JSON.parse(await file.text()) as Survey;
      if (!Array.isArray(next.buildings)) throw new Error('Not a survey file');
      installSurvey(next);
    } catch {
      setError('Could not read that survey file');
    }
  };

  // Clearing the input after each pick matters: Chrome ignores a re-pick of a file with the same name,
  // which is exactly what happens when a sheet is edited and saved in place.
  const onPick = (fn: (f: File) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) fn(f);
  };

  const hiddenInputs = (
    <>
      <input ref={excelInput} type="file" accept=".xlsx" hidden onChange={onPick(loadExcel)} />
      <input ref={jsonInput} type="file" accept=".json" hidden onChange={onPick(loadJson)} />
      <input ref={mergeInput} type="file" accept=".xlsx" hidden onChange={onPick(startMerge)} />
    </>
  );

  // The preview shows the same snapshot that the client file contains, so the two cannot differ.
  const previewData = useMemo(() => (preview && survey ? toClientSnapshot(survey, view) : null), [preview, survey, view]);

  const checks = useMemo(() => (survey ? runChecks(survey) : []), [survey]);
  const counts = useMemo(() => countBySeverity(checks), [checks]);

  const openChecks = () => {
    setChecksOpen(true);
    setExcelList([]);
    if (!survey) return;
    setExcelLoading(true);
    excelChecks(survey)
      .then(setExcelList)
      .catch(() => setExcelList([]))
      .finally(() => setExcelLoading(false));
  };
  const showBuilding = (id: string) => {
    setChecksOpen(false);
    setClientExport(null);
    setSelectedId(id);
  };

  // The summary counts only buildings that are on the map, so it matches the client file exactly.
  const placedSurvey = useMemo(
    () => (survey ? { ...survey, buildings: survey.buildings.filter((b) => b.lngLat) } : null),
    [survey],
  );

  const exportClientFile = () => {
    if (!clientExport || !clientTemplate) return;
    const html = embedSnapshot(clientTemplate, clientExport.snapshot);
    const base = (survey?.title ?? 'survey').replace(/[^\w.-]+/g, '_');
    downloadBlob(new Blob([html], { type: 'text/html' }), `${base}_client.html`);
    setNotice({ text: `Client file saved: ${base}_client.html` });
    setClientExport(null);
  };

  if (!survey) {
    return (
      <div className="empty">
        {hiddenInputs}
        <img className="logo" src={logo} alt="Avison Young" />
        <h1>Rental Market Survey Map</h1>
        <p>Upload a survey workbook to place the properties on a map.</p>
        <div className="row-actions">
          <button className="btn primary" onClick={() => excelInput.current?.click()}>Upload Excel survey</button>
          <button className="btn" onClick={() => jsonInput.current?.click()}>Open saved survey</button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  if (previewData) {
    return (
      <ClientViewer
        key="preview"
        survey={snapshotToSurvey(previewData.snapshot)}
        initialView={snapshotToView(previewData.snapshot)}
        banner={
          <div className="toolbar preview">
            <button className="btn primary" onClick={() => setPreview(false)}>Back to editing</button>
            <span>Client preview: exactly what the client file contains. Press Esc to return.</span>
            {previewData.unplaced.length > 0 && <span className="notice warn">Not shown (no pin yet): {previewData.unplaced.join(', ')}</span>}
          </div>
        }
      />
    );
  }

  const editable = true;
  return (
    <div className={editable ? 'app edit' : 'app view'}>
      {hiddenInputs}
      <Header survey={survey} />
      <div className={editable ? 'toolbar' : 'toolbar preview'}>
        {editable ? (
          <>
            <button className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
            <button className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
            <span className="sep" />
            <button className="btn" onClick={addBuilding} title="Add a building without editing the Excel first">Add building</button>
            <button className="btn" onClick={() => mergeInput.current?.click()} title="Re-upload a revised sheet; keeps your pins and photos">Update from Excel</button>
            <button className="btn" onClick={exportExcel} disabled={!survey.source} title={survey.source ? 'Write pin coordinates and photo URLs back into your workbook' : 'Upload the Excel file again to enable export'}>Export Excel</button>
            <span className="sep" />
            <button className="btn" onClick={() => excelInput.current?.click()}>New from Excel</button>
            <button className="btn" onClick={() => jsonInput.current?.click()}>Open</button>
            <button className="btn" onClick={() => downloadJson(survey)}>Save file</button>
            <button className="btn" onClick={() => setConfirmStartOver(true)} title="Close this survey and clear the autosaved copy">Start over</button>
            <button className="btn" onClick={() => setFitKey((k) => k + 1)}>Fit map</button>
            <span className="sep" />
            <button className="btn" onClick={openChecks} title="Look for mistakes before sending a client the map">
              Checks
              <span className={counts.error ? 'checks-badge error' : counts.warn ? 'checks-badge' : 'checks-badge ok'}>
                {counts.error || counts.warn || '0'}
              </span>
            </button>
            <button className="btn" onClick={() => setPreview(true)}>Preview client view</button>
            <button className="btn" onClick={() => setExportOpen(true)} disabled={!survey.buildings.some((b) => b.lngLat)} title="Save the map as a PNG or PDF for a report">
              Export image / PDF
            </button>
            <button
              className="btn primary"
              onClick={() => setClientExport(toClientSnapshot(survey, view))}
              disabled={!clientTemplate}
              title={clientTemplate ? 'Save a read-only copy of the map to send to a client' : 'Not available in this build. Use the file made by npm run build:single'}
            >
              Export client file
            </button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => setPreview(false)}>Back to editing</button>
            <span>Client preview: this is what the client will see. Press Esc to return.</span>
          </>
        )}
        {error && <span className="error">{error}</span>}
        {notice && editable && <span className={notice.warn ? 'notice warn' : 'notice'}>{notice.text}</span>}
        {restoredAt && editable && !notice && (
          <span className="notice warn">
            Restored autosaved work{restoredAt !== 'earlier' ? ` from ${new Date(restoredAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.{' '}
            <button className="link-btn" onClick={() => setRestoredAt(null)}>Dismiss</button>
          </span>
        )}
      </div>
      {pendingNew && (
        <ConfirmDialog
          title="Start a new survey?"
          confirmLabel="Replace survey"
          onCancel={() => setPendingNew(null)}
          onConfirm={() => {
            installSurvey(pendingNew.survey);
            setPendingNew(null);
          }}
        >
          <p>
            Replace the current survey with <strong>{pendingNew.fileName}</strong> ({pendingNew.survey.buildings.length} buildings)? Pins and photos
            will not carry over. To keep them, cancel and use <strong>Update from Excel</strong> instead.
          </p>
        </ConfirmDialog>
      )}
      {clientExport && (() => {
        const sum = summarizeSnapshot(clientExport);
        const v = clientExport.snapshot.view;
        const filtersOn = Object.values(v.filters).some((a) => a.length > 0);
        return (
          <ConfirmDialog title="Export client file" confirmLabel={counts.warn ? "Save anyway" : "Save client file"} confirmDisabled={counts.error > 0} onCancel={() => setClientExport(null)} onConfirm={exportClientFile}>
            <p>
              The file opens in any browser with no login and shows <strong>{sum.buildings} buildings ({sum.units} units)</strong>
              {sum.photos ? ` and ${sum.photos} photo${sum.photos === 1 ? '' : 's'}` : ''}. It starts on {v.metric === 'rate' ? 'base rent' : v.metric === 'psf' ? 'rent PSF' : 'net rent'}
              {v.rings ? ' with distance rings on' : ''}{filtersOn ? ', with your current unit filters applied' : ''}. Clients can change the metric and filters but cannot edit anything.
            </p>
            {(() => {
              const issues = checks.filter((c) => c.severity !== 'info');
              return issues.length > 0 ? (
                <div className="export-checks">
                  <ChecksList checks={issues} onShow={showBuilding} />
                </div>
              ) : (
                <p className="check-ok">Checks passed.</p>
              );
            })()}
            <p className="hint">Never included: notes, contact details, unrecognised columns, and your Excel workbook.</p>
          </ConfirmDialog>
        );
      })()}
      {exportOpen && placedSurvey && (
        <ExportDialog
          survey={placedSurvey}
          view={view}
          getBounds={() => viewBounds.current}
          initialSource={survey.sourceNote ?? ''}
          onSource={(s) => setSurvey((cur) => cur && { ...cur, sourceNote: s })}
          onClose={() => setExportOpen(false)}
        />
      )}
      {checksOpen && (
        <ChecksDialog checks={[...checks, ...excelList]} loadingMore={excelLoading} onShow={showBuilding} onClose={() => setChecksOpen(false)} />
      )}
      {skippedEdits && (
        <ConfirmDialog title="Some edits were not written" confirmLabel="Got it" hideCancel onCancel={() => setSkippedEdits(null)} onConfirm={() => setSkippedEdits(null)}>
          <p>These changes are only in the app. Change them in Excel yourself, or leave them.</p>
          <ul>
            {skippedEdits.map((e, i) => (
              <li key={i}>
                <strong>{e.building}</strong>: {e.field} ({e.reason})
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
      {needRows && (
        <ConfirmDialog title="Your sheet needs more room" confirmLabel="Got it" hideCancel onCancel={() => setNeedRows(null)} onConfirm={() => setNeedRows(null)}>
          <p>
            Pins and photos were exported, but <strong>{needRows.buildings.join(', ')}</strong> could not be written into the sheet:
            there are not enough empty rows right below the last building (row {needRows.afterRow}).
          </p>
          <p>
            In Excel, insert <strong>{needRows.rows} blank row{needRows.rows === 1 ? '' : 's'}</strong> directly below row {needRows.afterRow}, save,
            then use <strong>Update from Excel</strong> and <strong>Export Excel</strong> again. The new building stays in the app meanwhile.
          </p>
        </ConfirmDialog>
      )}
      {confirmStartOver && (
        <ConfirmDialog
          title="Start over?"
          confirmLabel="Close survey"
          onCancel={() => setConfirmStartOver(false)}
          onConfirm={() => {
            resetSurvey(null);
            saveDraft(null);
            setRestoredAt(null);
            setConfirmStartOver(false);
          }}
        >
          <p>This closes the survey and clears the autosaved copy in this browser. Use <strong>Save file</strong> first if you want to keep it.</p>
        </ConfirmDialog>
      )}
      {pending && <MergeDialog fileName={pending.fileName} summary={pending.summary} onApply={applyMerge} onCancel={() => setPending(null)} />}
      <div className="body">
        {editable && (
          <Sidebar
            survey={survey}
            selectedId={selectedId}
            placingId={placingId}
            onSelect={setSelectedId}
            onSurvey={(patch) => setSurvey((s) => s && { ...s, ...patch })}
            onBuilding={patchBuilding}
            onUnit={patchUnit}
            onToggleSubject={(id) =>
              setSurvey((s) => s && { ...s, buildings: s.buildings.map((b) => (b.id === id ? { ...b, isSubject: !b.isSubject } : b)) }, { commit: true })
            }
            onStartPlace={setPlacingId}
            onAddBuilding={addBuilding}
            onAddUnit={(bid) =>
              setSurvey((s) => s && { ...s, buildings: s.buildings.map((b) => (b.id === bid ? { ...b, units: [...b.units, newUnit()] } : b)) }, { commit: true })
            }
            onRemoveUnit={(bid, uid) =>
              setSurvey(
                (s) => s && { ...s, buildings: s.buildings.map((b) => (b.id === bid && b.units.length > 1 ? { ...b, units: b.units.filter((u) => u.id !== uid) } : b)) },
                { commit: true },
              )
            }
            onDelete={(id) => {
              setSurvey((s) => s && { ...s, buildings: s.buildings.filter((b) => b.id !== id) }, { commit: true });
              setSelectedId(null);
              setNotice({ text: 'Building removed. Use Undo to restore it.' });
            }}
          />
        )}
        <div className="stage">
          <Controls survey={survey} view={view} onChange={setView} editable={editable} />
          <div className="stage-main">
            <MapView
              survey={survey}
              view={view}
              editable={editable}
              selectedId={selectedId}
              placingId={editable ? placingId : null}
              onSelect={setSelectedId}
              onMove={(id, ll: LngLat) => patchBuilding(id, { lngLat: ll })}
              onPlace={(ll) => {
                if (placingId) patchBuilding(placingId, { lngLat: ll });
                setPlacingId(null);
              }}
              onDropBuilding={(id, ll) => {
                setSurvey((s) => s && { ...s, buildings: s.buildings.map((b) => (b.id === id ? { ...b, lngLat: ll } : b)) }, { commit: true });
                setSelectedId(id);
                setPlacingId(null);
              }}
              onBounds={(b) => (viewBounds.current = b)}
              fitKey={fitKey}
            />
            <SummaryPanel
              survey={placedSurvey!}
              view={view}
              onView={setView}
              canToggle
              unplaced={survey.buildings.length - placedSurvey!.buildings.length}
              onToggleBuilding={(id) =>
                setSurvey((s) => s && { ...s, buildings: s.buildings.map((b) => (b.id === id ? { ...b, excluded: !b.excluded } : b)) }, { commit: true })
              }
              onToggleUnit={(bid, uid) =>
                setSurvey(
                  (s) => s && { ...s, buildings: s.buildings.map((b) => (b.id === bid ? { ...b, units: b.units.map((u) => (u.id === uid ? { ...u, excluded: !u.excluded } : u)) } : b)) },
                  { commit: true },
                )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}
