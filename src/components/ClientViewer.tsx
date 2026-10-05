import { useState, type ReactNode } from 'react';
import type { Survey, ViewSettings } from '../types';
import Header from './Header';
import Controls from './Controls';
import MapView from './MapView';
import SummaryPanel from './SummaryPanel';

const noop = () => {};

interface Props {
  survey: Survey;
  initialView: ViewSettings;
  /** The editor shows a banner above its preview; the real client page has none. */
  banner?: ReactNode;
}

/** The read-only client page. Shared by the editor's preview and the exported client file, so they cannot differ. */
export default function ClientViewer({ survey: initialSurvey, initialView, banner }: Props) {
  // On a phone the summary starts closed so the map is what you see first; the Market summary button opens it.
  const [view, setView] = useState<ViewSettings>(() =>
    typeof window !== 'undefined' && window.innerWidth <= 900 ? { ...initialView, summary: { ...initialView.summary, open: false } } : initialView,
  );
  // A local copy, so a client who is allowed to switch properties off changes only what they see.
  const [survey, setSurvey] = useState(initialSurvey);
  const canToggle = Boolean(survey.clientCanToggle);
  const toggleBuilding = (id: string) =>
    setSurvey((s) => ({ ...s, buildings: s.buildings.map((b) => (b.id === id ? { ...b, excluded: !b.excluded } : b)) }));
  const toggleUnit = (bid: string, uid: string) =>
    setSurvey((s) => ({
      ...s,
      buildings: s.buildings.map((b) => (b.id === bid ? { ...b, units: b.units.map((u) => (u.id === uid ? { ...u, excluded: !u.excluded } : u)) } : b)),
    }));
  return (
    <div className="app view">
      {banner}
      <Header survey={survey} />
      <div className="body">
        <div className="stage">
          <Controls survey={survey} view={view} onChange={setView} editable={false} />
          <div className="stage-main">
            <MapView
              survey={survey}
              view={view}
              editable={false}
              selectedId={null}
              placingId={null}
              onSelect={noop}
              onMove={noop}
              onPlace={noop}
              fitKey={0}
            />
            <SummaryPanel survey={survey} view={view} onView={setView} canToggle={canToggle} onToggleBuilding={toggleBuilding} onToggleUnit={toggleUnit} />
          </div>
        </div>
      </div>
      {survey.sourceNote && <footer className="source-note">{survey.sourceNote}</footer>}
    </div>
  );
}
