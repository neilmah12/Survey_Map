import { useState } from 'react';
import type { LngLat, Survey, ViewSettings } from '../types';
import logoUrl from '../assets/avison-young-logo.png';
import { PAGES, type PageKind } from '../lib/exportLayout';
import { canvasToBlob, renderExport, type ExportResult } from '../lib/exportImage';
import { pdfFromJpeg } from '../lib/pdf';
import { downloadBlob } from '../lib/store';

export const DEFAULT_SOURCE = 'Source: Avison Young Research';

interface Props {
  /** Buildings with a pin only. */
  survey: Survey;
  view: ViewSettings;
  /** The area the map is showing right now. */
  getBounds: () => [LngLat, LngLat] | null;
  initialSource: string;
  /** Called when the source line is changed, so it is remembered for next time and shown on the client page. */
  onSource: (s: string) => void;
  onClose: () => void;
}

const fileBase = (title: string) => title.replace(/[^\w.-]+/g, '_') || 'survey';

export default function ExportDialog({ survey, view, getBounds, initialSource, onSource, onClose }: Props) {
  const [page, setPage] = useState<PageKind>('letter-landscape');
  const [dpi, setDpi] = useState(300);
  const [extent, setExtent] = useState<'view' | 'all'>('view');
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeLegend, setIncludeLegend] = useState(true);
  const [source, setSource] = useState(initialSource || DEFAULT_SOURCE);
  const [status, setStatus] = useState<'idle' | 'rendering' | 'ready' | 'error'>('idle');
  const [stale, setStale] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    if (status === 'ready') setStale(true);
  };

  const render = async () => {
    setStatus('rendering');
    setError('');
    setStale(false);
    try {
      const r = await renderExport({
        survey, view, page, dpi, extent, viewBounds: getBounds(), includeSummary, includeLegend, sourceNote: source, logoUrl,
      });
      const small = document.createElement('canvas');
      small.width = Math.min(1100, r.canvas.width);
      small.height = Math.round((small.width / r.canvas.width) * r.canvas.height);
      small.getContext('2d')!.drawImage(r.canvas, 0, 0, small.width, small.height);
      setPreview(small.toDataURL('image/jpeg', 0.88));
      setResult(r);
      setStatus('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the page');
      setStatus('error');
    }
  };

  const remember = () => {
    if (source.trim() !== (initialSource ?? '').trim()) onSource(source.trim());
  };

  const savePng = async () => {
    if (!result) return;
    remember();
    downloadBlob(await canvasToBlob(result.canvas, 'image/png'), `${fileBase(survey.title)}_map.png`);
  };

  const savePdf = async () => {
    if (!result) return;
    remember();
    const jpeg = new Uint8Array(await (await canvasToBlob(result.canvas, 'image/jpeg', 0.93)).arrayBuffer());
    const { wIn, hIn } = PAGES[page];
    const pdf = pdfFromJpeg(jpeg, result.canvas.width, result.canvas.height, wIn * 72, hIn * 72, `${survey.title} - Rental Market Survey`);
    downloadBlob(new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${fileBase(survey.title)}_map.pdf`);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Export image or PDF">
      <div className="modal wide export-modal">
        <h2>Export image or PDF</h2>
        <div className="export-grid">
          <label className="field">
            <span>Page</span>
            <select value={page} onChange={(e) => change(setPage)(e.target.value as PageKind)}>
              {(Object.keys(PAGES) as PageKind[]).map((k) => (
                <option key={k} value={k}>{PAGES[k].label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Quality</span>
            <select value={dpi} onChange={(e) => change(setDpi)(Number(e.target.value))}>
              <option value={150}>Standard (150 dpi): Word, email</option>
              <option value={300}>High (300 dpi): print</option>
            </select>
          </label>
          <label className="field">
            <span>Map area</span>
            <select value={extent} onChange={(e) => change(setExtent)(e.target.value as 'view' | 'all')}>
              <option value="view">What I see now</option>
              <option value="all">All buildings (and rings)</option>
            </select>
          </label>
          <div className="export-checks-row">
            <label className="check"><input type="checkbox" checked={includeSummary} onChange={(e) => change(setIncludeSummary)(e.target.checked)} />Market summary table</label>
            <label className="check"><input type="checkbox" checked={includeLegend} onChange={(e) => change(setIncludeLegend)(e.target.checked)} />Legend</label>
          </div>
        </div>
        <label className="field wide">
          <span>Source line (printed under the map)</span>
          <input value={source} onChange={(e) => change(setSource)(e.target.value)} />
        </label>
        <p className="hint">
          The page uses the metric, unit filters, summary settings and switched-off properties you have set now. Buildings without a pin are left out.
        </p>

        {status === 'rendering' && <p className="notice">Drawing the map... this can take a few seconds.</p>}
        {status === 'error' && <p className="error">{error}</p>}
        {result && !result.basemapLoaded && (
          <p className="notice warn">The street map could not load, so the page has a plain background. Check your internet connection and update the preview.</p>
        )}
        {preview && (
          <div className={stale ? 'export-preview stale' : 'export-preview'}>
            <img src={preview} alt="Preview of the page" />
            {stale && <div className="stale-note">Options changed. Update the preview before saving.</div>}
          </div>
        )}

        <div className="row-actions">
          <button className="btn" onClick={render} disabled={status === 'rendering'}>
            {status === 'ready' ? 'Update preview' : 'Create preview'}
          </button>
          <button className="btn primary" onClick={savePng} disabled={status !== 'ready' || stale}>Save PNG</button>
          <button className="btn primary" onClick={savePdf} disabled={status !== 'ready' || stale}>Save PDF</button>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
