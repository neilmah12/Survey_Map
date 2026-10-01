import logo from './assets/avison-young-logo.png';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Building, LngLat, Survey, Unit, ViewSettings } from './types';
import { parseSurvey } from './lib/parse';
import { downloadJson, loadDraft, saveDraft } from './lib/store';
import Header from './components/Header';
import Controls from './components/Controls';
import Sidebar from './components/Sidebar';
import MapView from './components/MapView';

const DEFAULT_VIEW: ViewSettings = { metric: 'rate', beds: [], rings: true, ringsKm: [0.5, 1, 2] };

export default function App() {
  const [survey, setSurvey] = useState<Survey | null>(() => loadDraft());
  const [view, setView] = useState<ViewSettings>(DEFAULT_VIEW);
  const [preview, setPreview] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [error, setError] = useState('');
  const excelInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => saveDraft(survey), [survey]);

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
    try {
      const next = await parseSurvey(await file.arrayBuffer());
      setSurvey(next);
      setSelectedId(null);
      setPlacingId(null);
      setFitKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that workbook');
    }
  };

  const loadJson = async (file: File) => {
    setError('');
    try {
      const next = JSON.parse(await file.text()) as Survey;
      if (!Array.isArray(next.buildings)) throw new Error('Not a survey file');
      setSurvey(next);
      setFitKey((k) => k + 1);
    } catch {
      setError('Could not read that survey file');
    }
  };

  const hiddenInputs = (
    <>
      <input ref={excelInput} type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && loadExcel(e.target.files[0])} />
      <input ref={jsonInput} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && loadJson(e.target.files[0])} />
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
      <div className="toolbar">
        {editable ? (
          <>
            <button className="btn" onClick={() => excelInput.current?.click()}>Upload Excel</button>
            <button className="btn" onClick={() => jsonInput.current?.click()}>Open</button>
            <button className="btn" onClick={() => downloadJson(survey)}>Save file</button>
            <button className="btn" onClick={() => setFitKey((k) => k + 1)}>Fit map</button>
            <button className="btn primary" onClick={() => setPreview(true)}>Preview client view</button>
          </>
        ) : (
          <button className="btn" onClick={() => setPreview(false)}>Back to editing</button>
        )}
        {error && <span className="error">{error}</span>}
      </div>
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
              setSurvey((s) => s && { ...s, buildings: s.buildings.map((b) => ({ ...b, isSubject: b.id === id })) })
            }
            onStartPlace={setPlacingId}
            onDelete={(id) => {
              setSurvey((s) => s && { ...s, buildings: s.buildings.filter((b) => b.id !== id) });
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
