import { useMemo, useState, type ReactNode } from 'react';
import type { NetSettings, Survey, ViewSettings } from '../types';
import Header from './Header';
import MapView from './MapView';
import SummaryPanel from './SummaryPanel';
import { scopeSurvey } from '../lib/scope';

const noop = () => {};

interface Props {
  survey: Survey;
  initialView: ViewSettings;
  /** The editor shows a banner above its preview; the real client page has none. */
  banner?: ReactNode;
}

/** The read-only client page. Shared by the editor's preview and the exported client file, so they cannot differ. */
export default function ClientViewer({ survey: initialSurvey, initialView, banner }: Props) {
  // The summary starts open everywhere. On a phone it opens as the small drawer under the map, with the chart first,
  // so the map is still what you see and the comparison is already there; the grab bar makes it full screen.
  const [view, setView] = useState<ViewSettings>(initialView);
  // A local copy, so a client who is allowed to switch properties off changes only what they see.
  const [survey, setSurvey] = useState(initialSurvey);
  const canToggle = Boolean(survey.clientCanToggle);
  // Who is compared with whom, and how far away: marks the buildings the figures leave out.
  const scoped = useMemo(() => scopeSurvey(survey, view), [survey, view.within, view.subjectId]); // eslint-disable-line react-hooks/exhaustive-deps
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
          <div className="stage-main">
            <MapView
              survey={scoped}
              view={view}
              editable={false}
              selectedId={null}
              placingId={null}
              onSelect={noop}
              onToggleBuilding={canToggle ? toggleBuilding : undefined}
              onMove={noop}
              onPlace={noop}
              fitKey={0}
            />
            <SummaryPanel survey={scoped} view={view} onView={setView} canToggle={canToggle} onToggleBuilding={toggleBuilding} onToggleUnit={toggleUnit} onNet={(net: NetSettings) => setSurvey((s) => ({ ...s, net }))} />
          </div>
        </div>
      </div>
      {survey.sourceNote && <footer className="source-note">{survey.sourceNote}</footer>}
    </div>
  );
}
