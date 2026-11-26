import { useEffect, useRef, useState } from 'react';
import logo from '../assets/avison-young-logo.png';
import type { Survey } from '../types';
import { formatDate } from '../lib/format';

interface Props {
  survey: Survey;
  /** Client page: saves the report as a PDF. Absent when the editor has not allowed it. */
  onDownload?: () => void;
  downloading?: boolean;
  downloadError?: string;
}

/** "Contact": a small button that opens a card with the team's names and emails, so it is there without being in the way. */
function ContactMenu({ survey }: { survey: Survey }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const contacts = survey.contacts ?? [];
  if (contacts.length === 0) return null;
  return (
    <div className="contact-menu" ref={root}>
      <button className="btn header-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        Contact our team
      </button>
      {open && (
        <div className="contact-card" role="dialog" aria-label="Contact our team">
          <div className="contact-title">Questions, or a different comparison?</div>
          <div className="contact-sub">Talk to our team.</div>
          <ul>
            {contacts.map((c) => (
              <li key={c.email}>
                <span className="contact-name">{c.name}</span>
                <span className="contact-role">{c.title}</span>
                <a href={`mailto:${c.email}`}>{c.email}</a>
              </li>
            ))}
          </ul>
          {survey.contactUrl && (
            <a className="contact-more" href={survey.contactUrl} target="_blank" rel="noopener noreferrer">
              More from our multifamily team
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export default function Header({ survey, onDownload, downloading, downloadError }: Props) {
  const hasContacts = (survey.contacts?.length ?? 0) > 0;
  return (
    <header className="header">
      <img className="logo" src={logo} alt="Avison Young" />
      <div className="title-block">
        <div className="title-strong">Rental Market Survey</div>
        <div className="title-main">{survey.title}</div>
        <div className="title-sub">{survey.location}</div>
      </div>
      <div className="header-right">
        <div className="asof">As of {formatDate(survey.asOf)}</div>
        {(hasContacts || onDownload) && (
          <div className="header-actions">
            {onDownload && (
              <button className="btn header-btn" onClick={onDownload} disabled={downloading} title="Save this survey as a PDF">
                {downloading ? 'Preparing PDF...' : 'Download PDF'}
              </button>
            )}
            <ContactMenu survey={survey} />
          </div>
        )}
        {downloadError && <div className="pdf-err">{downloadError}</div>}
      </div>
    </header>
  );
}
