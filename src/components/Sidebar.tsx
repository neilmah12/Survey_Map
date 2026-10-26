import { useEffect, useRef, useState } from 'react';
import type { Building, Survey, Unit } from '../types';
import { fileToDataUrl } from '../lib/image';
import { safeUrl } from '../lib/safeUrl';
import { DRAG_TYPE } from '../lib/dnd';
import { autoAmount, explainIncentive, netOf, partAmount, unitNet, type NetPart } from '../lib/net';
import type { NetSettings } from '../types';
import { formatDate, money, parseLatLng } from '../lib/format';
import { localDate } from '../lib/dates';

interface Props {
  survey: Survey;
  selectedId: string | null;
  placingId: string | null;
  onSelect: (id: string) => void;
  onSurvey: (patch: Partial<Survey>) => void;
  onBuilding: (id: string, patch: Partial<Building>) => void;
  onUnit: (buildingId: string, unitId: string, patch: Partial<Unit>) => void;
  onToggleSubject: (id: string) => void;
  onStartPlace: (id: string | null) => void;
  onDelete: (id: string) => void;
  onAddBuilding: () => void;
  onAddUnit: (buildingId: string) => void;
  onRemoveUnit: (buildingId: string, unitId: string) => void;
}

const numOrNull = (s: string) => {
  const n = parseFloat(s.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function Field(props: { label: string; value: string; onChange: (v: string) => void; wide?: boolean }) {
  return (
    <label className={props.wide ? 'field wide' : 'field'}>
      <span>{props.label}</span>
      <input value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

/** A dollar box that is empty until you type: empty means "work it out from the text". Accepts a minus sign while typing. */
function AmountField({
  label,
  value,
  auto,
  onChange,
  counted,
  onCount,
  note,
  warn,
}: {
  label: string;
  value: number | null | undefined;
  auto?: number | null;
  onChange: (v: number | null) => void;
  /** Whether this part counts toward net rent (a survey-wide setting). Undefined: no tag. */
  counted?: boolean;
  onCount?: () => void;
  note?: string;
  warn?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value == null ? '' : String(value));
  }, [value]);
  const hint = auto === undefined ? '' : auto == null ? 'not read' : String(Math.round(auto * 100) / 100);
  return (
    <label className={counted === false ? 'field amount off' : 'field amount'}>
      <span>
        {label}
        {counted !== undefined && (
          <button
            type="button"
            className={counted ? 'count-tag on' : 'count-tag'}
            title={`${counted ? 'Counted' : 'Not counted'} in net rent for every building. Click to change it for the whole survey.`}
            onClick={(e) => {
              e.preventDefault();
              onCount?.();
            }}
          >
            {counted ? 'counted' : 'not counted'}
          </button>
        )}
      </span>
      <input
        inputMode="decimal"
        value={text}
        placeholder={hint ? `auto ${hint}` : ''}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(value == null ? '' : String(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') onChange(null);
          else {
            const n = numOrNull(e.target.value);
            if (n != null) onChange(n);
          }
        }}
      />
      {warn && <span className="amount-warn">{warn}</span>}
      {!warn && note && <span className="amount-note">{note}</span>}
    </label>
  );
}

const PART_TEXT: Record<Exclude<NetPart, 'misc'>, 'parking' | 'utilities' | 'incentive'> = { parking: 'parking', utilities: 'utilities', incentives: 'incentive' };

/** A warning when a counted part has sheet text but no amount could be read from it and none was typed. */
function unreadWarning(u: Unit, k: Exclude<NetPart, 'misc'>, net: NetSettings): string | undefined {
  const text = u[PART_TEXT[k]].trim();
  if (!net[k] || !text || partAmount(u, k, net.termMonths) != null) return undefined;
  return `"${text.length > 60 ? `${text.slice(0, 57)}...` : text}" could not be read. Type an amount.`;
}

/** How the free rent was spread, for example "1 month free over a 13-month lease (from the text): $1,499 x 1 / 13". */
function incentiveNote(u: Unit, net: NetSettings): string | undefined {
  if (u.incentiveAmt != null) return undefined;
  const c = explainIncentive(u.incentive, u.rate, net.termMonths);
  if (!c || c.freeMonths == null || c.term == null || u.rate == null) return undefined;
  const m = Math.round(c.freeMonths * 100) / 100;
  return `${m} month${m === 1 ? '' : 's'} free over a ${c.term}-month lease (${c.termFromText ? 'from the text' : 'default'}): ${money(u.rate)} x ${m} / ${c.term} = ${money(c.amount)}/mo`;
}

/** One line showing the suite's net rent and how it adds up. */
function NetLine({ u, net }: { u: Unit; net: NetSettings }) {
  if (!net.enabled) return null;
  const total = unitNet(u, net);
  if (typeof u.netOverride === 'number') return <div className="net-line">Net rent: <b>{money(u.netOverride)}</b> (override)</div>;
  if (total == null) return <div className="net-line">Net rent: - (no rent)</div>;
  const parts: string[] = [`${money(u.rate ?? 0)} base`];
  const off: string[] = [];
  const amt = (k: NetPart) => partAmount(u, k, net.termMonths) ?? 0;
  // A part whose text could not be read adds nothing; say so rather than show $0.
  const unread = (k: Exclude<NetPart, 'misc'>) => partAmount(u, k, net.termMonths) == null;
  const add = (k: Exclude<NetPart, 'misc'>, sign: '+' | '-', name: string) =>
    net[k] ? parts.push(unread(k) ? `${sign} ${name} (not read, left out)` : `${sign} ${money(amt(k))} ${name}`) : off.push(k);
  add('parking', '+', 'parking');
  add('utilities', '+', 'utilities');
  add('incentives', '-', 'incentive');
  if (net.misc) {
    const m = amt('misc');
    parts.push(`${m < 0 ? '-' : '+'} ${money(Math.abs(m))} ${u.miscLabel?.trim() || 'misc'}`);
  } else off.push('misc');
  return (
    <div className="net-line">
      Net rent: <b>{money(total)}</b> = {parts.join(' ')}
      {off.length > 0 && <span className="muted"> ({off.join(', ')} not counted)</span>}
    </div>
  );
}

function CoordInput({ b, onBuilding }: { b: Building; onBuilding: Props['onBuilding'] }) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  return (
    <div className="coord">
      <input
        placeholder="Paste lat, lng (e.g. 53.5461, -113.4938)"
        value={text}
        className={bad ? 'bad' : ''}
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const ll = parseLatLng(text);
          if (ll) {
            onBuilding(b.id, { lngLat: ll });
            setText('');
          } else setBad(true);
        }}
      />
      <span className="hint">Enter to set</span>
    </div>
  );
}

function ImageField({ b, onBuilding }: { b: Building; onBuilding: Props['onBuilding'] }) {
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const img = b.imageUrl ?? '';
  const isData = img.startsWith('data:');
  const preview = safeUrl(img, true);
  // Stay collapsed until there is something to show or the user asks to add it.
  const [open, setOpen] = useState(Boolean(img || b.url));
  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        + Add photo or listing link
      </button>
    );
  }
  return (
    <div>
      <div className="editor-title">Photo and listing</div>
      <Field
        label={isData ? 'Image (uploaded photo)' : 'Image URL'}
        value={isData ? '' : img}
        onChange={(v) => onBuilding(b.id, { imageUrl: v.trim() })}
        wide
      />
      <Field label="Listing URL" value={b.url} onChange={(v) => onBuilding(b.id, { url: v.trim() })} wide />
      {preview && <img className="thumb" src={preview} alt="" referrerPolicy="no-referrer" onError={() => setErr('This image address does not load')} onLoad={() => setErr('')} />}
      {err && <div className="hint" style={{ color: '#b42318' }}>{err}</div>}
      <div className="row-actions">
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              onBuilding(b.id, { imageUrl: await fileToDataUrl(f) });
              setErr('');
            } catch {
              setErr('Could not read that image');
            }
          }}
        />
        <button className="btn" onClick={() => file.current?.click()}>Upload photo</button>
        {/^https?:\/\//i.test(img) && (
          <button
            className="btn"
            disabled={busy}
            title="Keeps a copy inside the survey, so the photo cannot disappear if the site removes it"
            onClick={async () => {
              setBusy(true);
              try {
                const res = await fetch(img, { mode: 'cors', referrerPolicy: 'no-referrer' });
                if (!res.ok) throw new Error(String(res.status));
                const blob = await res.blob();
                onBuilding(b.id, { imageUrl: await fileToDataUrl(new File([blob], 'photo', { type: blob.type })) });
                setErr('');
              } catch {
                setErr('That site does not allow copying its photos. Save the image to your computer and use Upload photo instead.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving...' : 'Save a copy in the survey'}
          </button>
        )}
        {img && <button className="btn" onClick={() => onBuilding(b.id, { imageUrl: '' })}>Remove photo</button>}
      </div>
    </div>
  );
}

function Editor({ b, p }: { b: Building; p: Props }) {
  const net = netOf(p.survey);
  const term = net.termMonths;
  const toggle = (k: NetPart) => p.onSurvey({ net: { ...net, [k]: !net[k] } });
  return (
    <div className="editor">
      <div className="editor-title">Edit building</div>
      <Field label="Name" value={b.name} onChange={(v) => p.onBuilding(b.id, { name: v })} wide />
      <Field label="Address" value={b.address} onChange={(v) => p.onBuilding(b.id, { address: v })} wide />
 <label className="field wide">
        <span>Property type (decides whether Stacked / non-stacked shows)</span>
        <select value={b.propertyType ?? ''} onChange={(e) => p.onBuilding(b.id, { propertyType: (e.target.value || undefined) as Building['propertyType'] })}>
          <option value="">Auto-detect</option>
          <option value="Townhome">Townhome</option>
          <option value="Apartment">Apartment</option>
        </select>
      </label>
      <Field label="Unit configuration (for example Stacked)" value={b.configuration} onChange={(v) => p.onBuilding(b.id, { configuration: v })} wide />
      <div className="row2">
        <Field label="Year built" value={b.yearBuilt} onChange={(v) => p.onBuilding(b.id, { yearBuilt: v })} />
        <Field label="Renovated" value={b.yearRenovated} onChange={(v) => p.onBuilding(b.id, { yearRenovated: v })} />
      </div>
      <div className="row-actions">
        <button className={p.placingId === b.id ? 'btn on' : 'btn'} onClick={() => p.onStartPlace(p.placingId === b.id ? null : b.id)}>
          {p.placingId === b.id ? 'Click the map...' : b.lngLat ? 'Re-place on map' : 'Place on map'}
        </button>
        <button className={b.isSubject ? 'btn on' : 'btn'} onClick={() => p.onToggleSubject(b.id)} title="Several buildings can be the subject, for example a portfolio">
          {b.isSubject ? 'Subject property (click to remove)' : 'Mark as subject'}
        </button>
      </div>
      <CoordInput b={b} onBuilding={p.onBuilding} />
      {b.lngLat && (
        <div className="hint">
          {b.lngLat[1].toFixed(5)}, {b.lngLat[0].toFixed(5)} (drag the pin to adjust)
        </div>
      )}

      <ImageField key={b.id} b={b} onBuilding={p.onBuilding} />

      <div className="editor-title">Units</div>
      <div className="units">
        {b.units.map((u) => (
          <div className="unit" key={u.id}>
            <div className="unit-head">
              <Field label="Unit type (for example 2 Bed/1 Bath)" value={u.type} onChange={(v) => p.onUnit(b.id, u.id, { type: v })} wide />
              {b.units.length > 1 && (
                <button className="link-btn" aria-label="Remove this unit" onClick={() => p.onRemoveUnit(b.id, u.id)}>
                  Remove
                </button>
              )}
            </div>
            <div className="row3">
              <Field label="SF" value={u.sf?.toString() ?? ''} onChange={(v) => p.onUnit(b.id, u.id, { sf: numOrNull(v) })} />
              <Field label="Rent" value={u.rate?.toString() ?? ''} onChange={(v) => p.onUnit(b.id, u.id, { rate: numOrNull(v) })} />
              <Field label="Net rent (sheet)" value={u.netRate?.toString() ?? ''} onChange={(v) => p.onUnit(b.id, u.id, { netRate: numOrNull(v) })} />
            </div>
            <Field label="Parking" value={u.parking} onChange={(v) => p.onUnit(b.id, u.id, { parking: v })} wide />
            <Field label="Utilities" value={u.utilities} onChange={(v) => p.onUnit(b.id, u.id, { utilities: v })} wide />
            <Field label="Incentive" value={u.incentive} onChange={(v) => p.onUnit(b.id, u.id, { incentive: v })} wide />
            <div className="unit-sub" title="These feed net rent when ticked above the map. Leave a box empty to use the amount read from the text.">Net rent amounts ($ per month)</div>
            <div className="row2">
              {(['parking', 'utilities'] as const).map((k) => (
                <AmountField
                  key={k}
                  label={k === 'parking' ? 'Parking' : 'Utilities'}
                  value={k === 'parking' ? u.parkingAmt : u.utilitiesAmt}
                  auto={autoAmount(u, k, term)}
                  counted={net.enabled ? net[k] : undefined}
                  onCount={() => toggle(k)}
                  warn={unreadWarning(u, k, net)}
                  onChange={(v) => p.onUnit(b.id, u.id, k === 'parking' ? { parkingAmt: v } : { utilitiesAmt: v })}
                />
              ))}
            </div>
            <AmountField
              label="Incentive (discount)"
              value={u.incentiveAmt}
              auto={autoAmount(u, 'incentives', term)}
              counted={net.enabled ? net.incentives : undefined}
              onCount={() => toggle('incentives')}
              warn={unreadWarning(u, 'incentives', net)}
              note={incentiveNote(u, net)}
              onChange={(v) => p.onUnit(b.id, u.id, { incentiveAmt: v })}
            />
            <AmountField
              label="Misc (+ fee, - credit)"
              value={u.miscAmt}
              counted={net.enabled ? net.misc : undefined}
              onCount={() => toggle('misc')}
              onChange={(v) => p.onUnit(b.id, u.id, { miscAmt: v })}
            />
            <Field label="Misc label (for example Telus package)" value={u.miscLabel ?? ''} onChange={(v) => p.onUnit(b.id, u.id, { miscLabel: v })} wide />
            <AmountField label="Net rent override (beats the settings)" value={u.netOverride} onChange={(v) => p.onUnit(b.id, u.id, { netOverride: v })} />
            <NetLine u={u} net={net} />
            {u.netRate != null && u.netOverride !== u.netRate && (
              <div className="net-hint">
                The sheet's net rent is {money(u.netRate)}.{' '}
                <button className="link-btn" onClick={() => p.onUnit(b.id, u.id, { netOverride: u.netRate })}>Use it as the override</button>
              </div>
            )}
          </div>
        ))}
      </div>
      <button className="btn" onClick={() => p.onAddUnit(b.id)}>
        + Add unit
      </button>{' '}
      <button className="btn danger" onClick={() => p.onDelete(b.id)}>
        Remove building
      </button>
    </div>
  );
}

export default function Sidebar(p: Props) {
  const selected = p.survey.buildings.find((b) => b.id === p.selectedId) ?? null;
  const unplaced = p.survey.buildings.filter((b) => !b.lngLat).length;
  return (
    <aside className="sidebar">
      <section>
        <div className="editor-title">Survey</div>
        <Field label="Title" value={p.survey.title} onChange={(v) => p.onSurvey({ title: v })} wide />
        <Field label="Source line (shown on exports and the client page)" value={p.survey.sourceNote ?? ''} onChange={(v) => p.onSurvey({ sourceNote: v })} wide />
        <label className="check" title="Off by default. Clients see your selection and cannot change it.">
          <input type="checkbox" checked={Boolean(p.survey.clientCanToggle)} onChange={(e) => p.onSurvey({ clientCanToggle: e.target.checked })} />
          Clients can switch properties on and off in the summary
        </label>
        <div className="row2">
          <Field label="Location" value={p.survey.location} onChange={(v) => p.onSurvey({ location: v })} />
          <label className="field">
            <span>As of</span>
            <input type="date" value={p.survey.asOf} onChange={(e) => p.onSurvey({ asOf: e.target.value })} />
          </label>
        </div>
        <div className="updated">
          <button className="link-btn" onClick={() => p.onSurvey({ asOf: localDate() })} title="Set the As of date, which clients see, to today">Set As of to today</button>
          {p.survey.updatedAt && <span> | Last edited {formatDate(localDate(new Date(p.survey.updatedAt)))} (internal)</span>}
        </div>
      </section>

      <section>
        <div className="editor-title">
          Buildings {unplaced > 0 && <span className="warn">{unplaced} unplaced</span>}
          <button className="link-btn push" onClick={p.onAddBuilding}>
            + Add building
          </button>
        </div>
        {p.survey.buildings.length > 0 && <div className="hint drag-hint">Drag a building onto the map to place its pin.</div>}
        <ul className="blist">
          {p.survey.buildings.map((b) => (
            <li
              key={b.id}
              draggable
              title="Drag onto the map to place its pin"
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, b.id);
                e.dataTransfer.setData('text/plain', b.name);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              <button className={b.id === p.selectedId ? 'brow on' : 'brow'} onClick={() => p.onSelect(b.id)}>
                <span className={b.isSubject ? 'dot subject' : 'dot'} />
                <span className="bname">{b.name}</span>
                {!b.lngLat && <span className="tag">unplaced</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selected && <Editor b={selected} p={p} />}
    </aside>
  );
}
