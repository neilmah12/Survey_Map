import logo from './assets/avison-young-logo.png';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Building, LngLat, Survey, Unit, ViewSettings } from './types';
import { parseSurvey } from './lib/parse';
import { toBase64 } from './lib/base64';
import { exportWithCoordinates } from './lib/exportXlsx';
import { mergeSurvey, type MergeSummary } from './lib/merge';
import { downloadBlob, downloadJson, loadDraft, saveDraft } from './lib/store';
import { useUndoable } from './hooks/useUndoable';
import MergeDialog from './components/MergeDialog';
import Header from './components/Header';
import Controls, { DEFAULT_RINGS } from './components/Controls';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';

const DEFAULT_VIEW: ViewSettings = { metric: 'rate', beds: [], rings: false, ringsKm: DEFAULT_RINGS };

/** Parses a workbook and keeps the original bytes so coordinates can be written back later. */
async function readWorkbook(file: File): Promise<Survey> {
  const data = await file.arrayBuffer();
  const survey = await parseSurvey(data);
  return { ...survey, source: { name: file.name, data: toBase64(data) } };
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export default function App() {
  const { state: survey, set: setSurvey, reset: resetSurvey, undo, redo, canUndo, canRedo } = useUndoable<Survey | null>(() => loadDraft());
  const [pending, setPending] = useState<{ fileName: string; survey: Survey; summary: MergeSummary } | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null);
  const mergeInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);
  const [preview, setPreview] = useState(false);
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

  const loadExcel = async (file: File) => {
    setError('');
    if (survey && !confirm('Start a new survey from this file? The current survey will be replaced. Use "Update from Excel" to keep your pins and photos.')) return;
    try {
      resetSurvey(await readWorkbook(file));
      setSelectedId(null);
      setPlacingId(null);
      setFitKey((k) => k + 1);
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
      const { data, name } = await exportWithCoordinates(survey);
      downloadBlob(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
      const pins = survey.buildings.filter((b) => b.lngLat).length;
      setNotice({
        text: `Exported ${pins} of ${survey.buildings.length} pin${pins === 1 ? '' : 's'} to ${name}`,
        warn: pins < survey.buildings.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export the workbook');
    }
  };

  const loadJson = async (file: File) => {
    setError('');
    try {
      const next = JSON.parse(await file.text()) as Survey;
      if (!Array.isArray(next.buildings)) throw new Error('Not a survey file');
      resetSurvey(next);
      setFitKey((k) => k + 1);
    } catch {
      setError('Could not read that survey file');
    }
  };

  const hiddenInputs = (
    <>
      <input ref={excelInput} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && loadExcel(e.target.files[0])} />
      <input ref={jsonInput} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && loadJson(e.target.files[0])} />
      <input ref={mergeInput} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && startMerge(e.target.files[0])} />
    </>
  );

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

  const editable = !preview;
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
            <button className="btn" onClick={() => mergeInput.current?.click()} title="Re-upload a revised sheet; keeps your pins and photos">Update from Excel</button>
            <button className="btn" onClick={exportExcel} disabled={!survey.source} title={survey.source ? 'Write pin coordinates and photo URLs back into your workbook' : 'Upload the Excel file again to enable export'}>Export Excel</button>
            <span className="sep" />
            <button className="btn" onClick={() => excelInput.current?.click()}>New from Excel</button>
            <button className="btn" onClick={() => jsonInput.current?.click()}>Open</button>
            <button className="btn" onClick={() => downloadJson(survey)}>Save file</button>
            <button className="btn" onClick={() => setFitKey((k) => k + 1)}>Fit map</button>
            <button className="btn primary" onClick={() => setPreview(true)}>Preview client view</button>
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => setPreview(false)}>Back to editing</button>
            <span>Client preview: this is what the client will see. Press Esc to return.</span>
          </>
        )}
        {error && <span className="error">{error}</span>}
        {notice && editable && <span className={notice.warn ? 'notice warn' : 'notice'}>{notice.text}</span>}
      </div>
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
            onSetSubject={(id) =>
              setSurvey((s) => s && { ...s, buildings: s.buildings.map((b) => ({ ...b, isSubject: b.id === id })) }, { commit: true })
            }
            onStartPlace={setPlacingId}
            onDelete={(id) => {
              setSurvey((s) => s && { ...s, buildings: s.buildings.filter((b) => b.id !== id) }, { commit: true });
              setSelectedId(null);
            }}
          />
        )}
        <div className="stage">
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
            fitKey={fitKey}
          />
          <Controls survey={survey} view={view} onChange={setView} editable={editable} />
        </div>
      </div>
    </div>
  );
}
