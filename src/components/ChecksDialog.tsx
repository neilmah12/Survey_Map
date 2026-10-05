import type { Check, Severity } from '../lib/checks';

const LABEL: Record<Severity, string> = { error: 'Must fix', warn: 'Worth fixing', info: 'Good to know' };

interface Props {
  title?: string;
  checks: Check[];
  /** True while the slower Excel checks are still running. */
  loadingMore?: boolean;
  onShow: (buildingId: string) => void;
  onClose: () => void;
}

export function ChecksList({ checks, onShow }: { checks: Check[]; onShow?: (buildingId: string) => void }) {
  if (checks.length === 0) return <p className="check-ok">Nothing to flag.</p>;
  const sev: Severity[] = ['error', 'warn', 'info'];
  return (
    <div className="checks">
      {sev.map((s) => {
        const items = checks.filter((c) => c.severity === s);
        if (items.length === 0) return null;
        return (
          <section key={s}>
            <h3 className={`sev ${s}`}>
              {LABEL[s]} ({items.length})
            </h3>
            <ul>
              {items.map((c) => (
                <li key={c.id} className={`check-item ${s}`}>
                  <span className="dot" aria-hidden />
                  <div className="check-body">
                    <div className="check-title">
                      <span className="check-group">{c.group}</span> {c.title}
                    </div>
                    {c.detail && <div className="check-detail">{c.detail}</div>}
                  </div>
                  {c.buildingId && onShow && (
                    <button className="link-btn" onClick={() => onShow(c.buildingId!)}>
                      Show
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export default function ChecksDialog({ title = 'Survey checks', checks, loadingMore, onShow, onClose }: Props) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal wide">
        <h2>{title}</h2>
        <ChecksList checks={checks} onShow={onShow} />
        {loadingMore && <p className="hint">Checking the Excel workbook...</p>}
        <div className="row-actions">
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
