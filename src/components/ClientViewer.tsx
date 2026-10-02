import { useState, type ReactNode } from 'react';
import type { Survey, ViewSettings } from '../types';
import Header from './Header';
import Controls from './Controls';
import MapView from './MapView';

const noop = () => {};

interface Props {
  survey: Survey;
  initialView: ViewSettings;
  /** The editor shows a banner above its preview; the real client page has none. */
  banner?: ReactNode;
}

/** The read-only client page. Shared by the editor's preview and the exported client file, so they cannot differ. */
export default function ClientViewer({ survey, initialView, banner }: Props) {
  const [view, setView] = useState(initialView);
  return (
    <div className="app view">
      {banner}
      <Header survey={survey} />
      <div className="body">
        <div className="stage">
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
          <Controls survey={survey} view={view} onChange={setView} editable={false} />
        </div>
      </div>
    </div>
  );
}
