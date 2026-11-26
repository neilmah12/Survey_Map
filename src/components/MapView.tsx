import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BLANK_STYLE, initialStyle } from '../lib/basemap';
import { layoutPins as planPins, type PinSpec } from '../lib/pinLayout';
import { pinNumbers } from '../lib/pinNumbers';
import type { Building, LngLat, NetSettings, Survey, ViewSettings } from '../types';
import { safeUrl } from '../lib/safeUrl';
import { PHOTO_MARK } from '../lib/cloudSplit';
import { loadPhoto } from '../lib/photoSource';
import { DRAG_TYPE } from '../lib/dnd';
import { normalizeUnitType } from '../lib/unitText';
import { circleCoords, ringTop } from '../lib/geo';
import { fmtKm, ringRadii } from '../lib/scope';
import { METRIC_LABEL, money, metricValue, pinLabel, psf, unitPsf } from '../lib/format';
import { groupLabel, kindContext, unitKind, visibleUnits, type UnitFilter } from '../lib/groups';
import { pinBadges, type PinBadge } from '../lib/utilities';
import { computeSummary, type SummaryResult } from '../lib/summary';
import { netAvailable, netOf, unitNet } from '../lib/net';

const EDMONTON: LngLat = [-113.4938, 53.5461];

interface Props {
  survey: Survey;
  view: ViewSettings;
  editable: boolean;
  selectedId: string | null;
  placingId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, lngLat: LngLat) => void;
  /** Editor: pins cannot be dragged (hold Shift to move one). Placing and typing coordinates are unaffected. */
  /** Lets a visitor count a building in or out of the figures from its popup. */
  onToggleBuilding?: (id: string) => void;
  pinsLocked?: boolean;
  /** Called when someone tries to drag a locked pin, so the editor can say how to unlock it. */
  onLockedDrag?: () => void;
  onPlace: (lngLat: LngLat) => void;
  /** A building dragged from the list was dropped on the map. */
  onDropBuilding?: (id: string, lngLat: LngLat) => void;
  /** Called with the visible area whenever the map stops moving (used by the image export). */
  onBounds?: (b: [LngLat, LngLat]) => void;
  fitKey: number;
}

function el(tag: string, cls?: string, txt?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

const STAR = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M12 2l2.9 6.9 7.1.6-5.4 4.7 1.7 7.1L12 17.3 5.7 21.3l1.7-7.1L2 9.5l7.1-.6z" fill="currentColor"/></svg>';

/**
 * A pin is a dot on the building's exact spot, a short pointer, and a pill: the number (a star for the subject),
 * the name, and the price with any tags. The pill's place and size are set afterwards by layoutPins.
 */
function pinElement(b: Building, label: string, badges: PinBadge[], selected: boolean, excluded: boolean, num: number | undefined): HTMLElement {
  const root = el('div', `pin${b.isSubject ? ' subject' : ''}${selected ? ' selected' : ''}${excluded ? ' excluded' : ''}`);
  root.dataset.order = String(b.isSubject ? 0 : (num ?? 9999)); // nearer buildings are placed first and keep their natural spot
  const pill = el('div', 'pin-pill');
  pill.title = b.name;
  const badge = el('span', 'pin-num');
  if (b.isSubject) badge.innerHTML = STAR;
  else badge.textContent = num != null ? String(num) : '';
  const line2 = el('span', 'pin-line2');
  line2.append(el('span', 'pin-rate', label));
  for (const x of badges) line2.append(el('span', `pin-badge ${x.kind}`, x.text));
  const text = el('span', 'pin-text');
  text.append(el('span', 'pin-name', b.name), line2);
  pill.append(badge, text);
  root.append(el('div', 'pin-leader'), el('div', 'pin-dot'), pill);
  return root;
}

/** What a popup needs beyond the building itself: the net rent settings and the market figures to compare with. */
interface PopupCtx {
  net: NetSettings;
  showNet: boolean;
  metric: ViewSettings['metric'];
  split: ViewSettings['summary']['split'];
  market: SummaryResult;
  /** The number on the building's pin (nearest the subject is 1). */
  num?: number;
  /** Switches the building on or off in the comparison (shown only where the visitor may do that). */
  toggle?: () => void;
}

/** "+4.6%" for a suite against the market figure for its unit type, or '-' when there is nothing to compare. */
function versusMarket(v: number | null, row: SummaryResult['rows'][number] | undefined): { text: string; cls: string } {
  const m = row?.market.value;
  if (v == null || m == null || m === 0) return { text: '-', cls: '' };
  const pct = ((v - m) / m) * 100;
  if (Math.abs(pct) < 0.05) return { text: '0.0%', cls: '' };
  return { text: `${pct > 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%`, cls: pct > 0 ? 'vs-up' : 'vs-down' };
}

function popupContent(b: Building, filter: UnitFilter, pc: PopupCtx): HTMLElement {
  const root = el('div', 'popup');
  const imgSrc = safeUrl(b.imageUrl, true);
  const lazyPhoto = !imgSrc && b.imageUrl?.startsWith(PHOTO_MARK) ? loadPhoto(b.imageUrl.slice(PHOTO_MARK.length)) : null;
  const listing = safeUrl(b.url);
  if (imgSrc || lazyPhoto) {
    const img = document.createElement('img');
    img.className = 'popup-img';
    img.alt = b.name;
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    img.addEventListener('error', () => img.remove());
    if (listing) {
      const a = document.createElement('a');
      a.href = listing;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.append(img);
      root.append(a);
    } else root.append(img);
    if (imgSrc) img.src = imgSrc;
    // Published photos live in their own documents and load only when a popup opens.
    else lazyPhoto?.then((data) => (safeUrl(data, true) ? (img.src = data) : img.remove())).catch(() => img.remove());
  }
  const title = el('div', 'popup-title');
  if (pc.num != null && !b.isSubject) title.append(el('span', 'popup-num', String(pc.num)));
  title.append(document.createTextNode(b.name));
  root.append(title);
  if (b.isSubject) root.append(el('div', 'popup-tag', b.out === 'subject' ? 'Subject property (not the one being compared)' : 'Subject property'));
  root.append(el('div', 'popup-sub', b.address));
  if (b.distKm != null && !b.isSubject) root.append(el('div', 'popup-sub', `${fmtKm(b.distKm)} from the subject${b.out === 'far' ? ', beyond the chosen distance and not counted' : ''}`));
  // Stacked / non-stacked only matters for townhomes.
  const townhome = b.units.some((u) => unitKind(u, b, filter.ctx) === 'Townhome');
  const facts = [
    b.yearBuilt && `Built ${b.yearBuilt}`,
    b.yearRenovated && `Renovated ${b.yearRenovated}`,
    townhome && b.configuration,
  ].filter(Boolean);
  if (facts.length) root.append(el('div', 'popup-sub', facts.join(' | ')));

  const units = visibleUnits(b, filter);
  // Only show columns that have data for at least one visible unit.
  const rows = units.map((u) => ({
    u,
    p: unitPsf(u),
    n: pc.showNet ? unitNet(u, pc.net) : null,
    vs: versusMarket(metricValue(u, pc.metric, pc.net), pc.market.rows.find((r) => r.key === groupLabel(u, b, pc.split, filter.ctx))),
  }));
  const cols = [
    { h: 'Unit', show: true, cell: (r: (typeof rows)[number]) => el('td', undefined, normalizeUnitType(r.u.type)) },
    { h: 'SF', show: rows.some((r) => r.u.sf), cell: (r: (typeof rows)[number]) => el('td', 'num', r.u.sf ? r.u.sf.toLocaleString('en-CA') : '-') },
    { h: 'Rent', show: true, cell: (r: (typeof rows)[number]) => el('td', 'num', r.u.rate != null ? money(r.u.rate) : '-') },
    { h: 'PSF', show: rows.some((r) => r.p != null), cell: (r: (typeof rows)[number]) => el('td', 'num', r.p != null ? psf(r.p) : '-') },
    { h: 'Net', show: rows.some((r) => r.n != null), cell: (r: (typeof rows)[number]) => el('td', 'num', r.n != null ? money(r.n) : '-') },
    {
      h: 'vs mkt',
      show: rows.some((r) => r.vs.text !== '-'),
      cell: (r: (typeof rows)[number]) => el('td', `num ${r.vs.cls}`.trim(), r.vs.text),
    },
  ].filter((c) => c.show);
  const table = el('table', 'popup-table');
  const head = el('tr');
  for (const c of cols) head.append(el('th', undefined, c.h));
  table.append(head);
  for (const r of rows) {
    const tr = el('tr', b.excluded || r.u.excluded ? 'excluded' : undefined);
    for (const c of cols) tr.append(c.cell(r));
    table.append(tr);
  }
  root.append(table);
  if (rows.some((r) => b.excluded || r.u.excluded)) root.append(el('div', 'popup-note', 'Greyed rows are not counted in the market averages.'));
  if (rows.some((r) => r.vs.text !== '-'))
    root.append(el('div', 'popup-note', `vs mkt: ${METRIC_LABEL[pc.metric].toLowerCase()} against the market figure for the same unit type (the subject is not part of the market).`));

  const lines = new Map<string, string>();
  for (const u of units) {
    if (u.parking) lines.set('Parking', u.parking);
    if (u.utilities) lines.set('Utilities', u.utilities);
    if (u.incentive) lines.set('Incentive', u.incentive);
    if (u.miscLabel) lines.set('Other', u.miscLabel);
  }
  for (const [k, v] of lines) {
    const row = el('div', 'popup-line');
    row.append(el('strong', undefined, `${k}: `), document.createTextNode(v));
    root.append(row);
  }
  if (listing) {
    const row = el('div', 'popup-line');
    const a = document.createElement('a');
    a.href = listing;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'View listing';
    row.append(a);
    root.append(row);
  }
  // Counting a building in or out of the figures, for a visitor who is allowed to. Not for the subject, and not for
  // a building beyond the chosen distance (the distance already leaves it out).
  if (pc.toggle && !b.isSubject && b.out !== 'far') {
    const label = document.createElement('label');
    label.className = 'popup-toggle';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !b.excluded;
    box.addEventListener('change', () => pc.toggle?.());
    label.append(box, document.createTextNode(b.excluded ? ' Not counted. Tick to count this building' : ' Counted in the comparison'));
    root.append(label);
  }
  return root;
}

/**
 * How far above the map point a popup must start to clear the pin. The selected pin is placed first, so its pill
 * sits straight above its dot; a popup that started at a fixed small gap would cover it.
 */
function popupOffset(pin: HTMLElement): [number, number] {
  const pill = pin.querySelector('.pin-pill')?.getBoundingClientRect();
  const spot = pin.getBoundingClientRect().top; // the root has no size: its top is the map point
  return [0, -(pill && pill.height > 0 ? Math.max(12, spot - pill.top + 8) : 56)];
}

/** Pans the map just enough that an open popup is fully visible (the popup always opens above its pin). */
function keepPopupInView(map: maplibregl.Map, popup: maplibregl.Popup) {
  const content = popup.getElement()?.querySelector('.maplibregl-popup-content');
  if (!content) return;
  const box = content.getBoundingClientRect();
  const view = map.getContainer().getBoundingClientRect();
  const M = 10;
  const dx = box.left < view.left + M ? view.left + M - box.left : box.right > view.right - M ? view.right - M - box.right : 0;
  const dy = box.top < view.top + M ? view.top + M - box.top : box.bottom > view.bottom - M ? view.bottom - M - box.bottom : 0;
  if (dx || dy) map.panBy([-dx, -dy], { duration: 250 });
}

/** The pill's size in each of its three looks, measured where it stands. */
function pillSizes(root: HTMLElement, pill: HTMLElement) {
  const at = (mode: '' | 'compact' | 'tiny') => {
    root.classList.toggle('compact', mode === 'compact');
    root.classList.toggle('tiny', mode === 'tiny');
    return { w: pill.offsetWidth, h: pill.offsetHeight };
  };
  const sizes = [at(''), at('compact'), at('tiny')];
  at('');
  return sizes;
}

/** Where a pill sits relative to its building, and how it looks: what the layout decided, kept per building. */
interface Placed { cx: number; cy: number; len: number; ang: number; detail: number }

function applyPlacement(root: HTMLElement, p: Placed) {
  root.classList.toggle('compact', p.detail === 1);
  root.classList.toggle('tiny', p.detail === 2);
  root.style.setProperty('--cx', `${p.cx}px`);
  root.style.setProperty('--cy', `${p.cy}px`);
  root.style.setProperty('--len', `${p.len}px`);
  root.style.setProperty('--ang', `${p.ang}rad`);
  root.style.setProperty('--z', String(root.classList.contains('subject') ? 7 : 5));
}

/**
 * Measures every pin, plans the layout with the shared algorithm, and applies it. The plan depends only on where
 * the pins are relative to one another at this zoom. It does not depend on which pin is selected or on which
 * part of the map is showing, so panning the map or tapping a pin never moves a pill: they move only when the
 * zoom changes, or when the buildings change.
 */
function layoutPins(markers: Map<string, maplibregl.Marker>, memory: Map<string, Placed>) {
  const items = [...markers.entries()].map(([id, m], i) => {
    const root = m.getElement();
    const pill = root.querySelector('.pin-pill') as HTMLElement;
    const spot = root.getBoundingClientRect(); // the root has no size, so this is the building's place
    const order = root.classList.contains('subject') ? -1 : Number(root.dataset.order ?? i);
    const spec: PinSpec = { id, x: spot.left, y: spot.top, sizes: pillSizes(root, pill), order };
    return { id, root, spec };
  });
  const plan = new Map(planPins(items.map((i) => i.spec)).map((p) => [p.id, p]));
  memory.clear();
  for (const { id, root, spec } of items) {
    const p = plan.get(id)!;
    const dx = p.attach.x - spec.x;
    const dy = p.attach.y - spec.y;
    const placed: Placed = { cx: p.cx, cy: p.cy, len: Math.hypot(dx, dy), ang: Math.atan2(dy, dx), detail: p.detail };
    memory.set(id, placed);
    applyPlacement(root, placed);
  }
  // A pin that moved changes where an open popup must start.
  for (const [, m] of markers) {
    const pop = m.getPopup();
    if (pop?.isOpen()) pop.setOffset(popupOffset(m.getElement()));
  }
}

export default function MapView(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  // Where each pill was last placed, so a pin rebuilt for any reason starts where it was instead of jumping back.
  const placements = useRef(new Map<string, Placed>());
  const ringMarkers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [dropReady, setDropReady] = useState(false);
  // Bumped on every style (re)load so ring layers get re-added and re-filled.
  const [styleVersion, setStyleVersion] = useState(0);

  const ctx = useMemo(() => kindContext(p.survey), [p.survey]);
  const net = useMemo(() => netOf(p.survey), [p.survey.net]); // eslint-disable-line react-hooks/exhaustive-deps
  const showNet = useMemo(() => netAvailable(p.survey), [p.survey]);
  const numbers = useMemo(() => pinNumbers(p.survey.buildings), [p.survey.buildings]);
  const market = useMemo(
    () => computeSummary({ ...p.survey, buildings: p.survey.buildings.filter((x) => x.lngLat) }, { metric: p.view.metric, filters: p.view.filters, settings: p.view.summary }),
    [p.survey, p.view.metric, p.view.filters, p.view.summary.stat, p.view.summary.split, p.view.summary.perBuilding], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const filter: UnitFilter = useMemo(
    () => ({ filters: p.view.filters, ctx }),
    [p.view.filters, ctx],
  );

  // Latest props for event handlers registered once.
  const live = useRef(p);
  live.current = p;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: initialStyle(),
      center: EDMONTON,
      zoom: 11,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('style.load', () => {
      map.addSource('rings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'rings-line',
        type: 'line',
        source: 'rings',
        paint: { 'line-color': '#002060', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.7 },
      });
      setReady(true);
      setStyleVersion((v) => v + 1);
    });
    const relayout = () => layoutPins(markers.current, placements.current);
    const reportBounds = () => {
      const bb = map.getBounds();
      live.current.onBounds?.([[bb.getWest(), bb.getSouth()], [bb.getEast(), bb.getNorth()]]);
    };
    map.on('zoomend', relayout); // a pan changes nothing about how the pins sit with one another, so only a zoom re-plans
    map.on('moveend', reportBounds);
    map.on('load', reportBounds);
    map.on('click', (e) => {
      if ((e.originalEvent.target as HTMLElement).closest('.pin')) return;
      if (live.current.placingId) live.current.onPlace([e.lngLat.lng, e.lngLat.lat]);
      else live.current.onSelect(null);
    });
    mapRef.current = map;
    // If the basemap style has not loaded after a while, fall back to a plain background.
    const fallback = window.setTimeout(() => {
      if (!map.isStyleLoaded()) map.setStyle(BLANK_STYLE);
    }, 8000);
    return () => {
      window.clearTimeout(fallback);
      map.remove();
      markers.current.clear();
      ringMarkers.current = [];
      mapRef.current = null;
    };
  }, []);

  // Pins: reconcile markers with buildings.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<string>();
    for (const b of p.survey.buildings) {
      if (!b.lngLat) continue;
      const matches = visibleUnits(b, filter).length > 0;
      if (!matches) continue;
      seen.add(b.id);
      const label = pinLabel(b, filter, p.view.metric, net);
      const shown = visibleUnits(b, filter);
      const element = pinElement(b, label, pinBadges(shown), b.id === live.current.selectedId, Boolean(b.excluded) || Boolean(b.out) || shown.every((u) => u.excluded), numbers.get(b.id));
      const before = placements.current.get(b.id);
      if (before) applyPlacement(element, before); // start where it was; the layout below only moves it if it must
      // Rebuilding a marker closes its popup, so remember and restore it.
      const old = markers.current.get(b.id);
      const wasOpen = old?.getPopup()?.isOpen() ?? false;
      old?.remove();
      // Always above the pin. Left to itself MapLibre measures the popup before its photo has loaded, finds it
      // short, and puts it beside the pin on a phone.
      // A popup reopened because the data changed must not take the keyboard focus, or typing in the sidebar
      // stops after one character (MapLibre focuses a popup when it opens).
      const popup = new maplibregl.Popup({ anchor: 'bottom', offset: popupOffset(element), maxWidth: window.innerWidth < 520 ? '88vw' : '380px', closeButton: true, focusAfterOpen: !wasOpen }).setDOMContent(
        popupContent(b, filter, { net, showNet, metric: p.view.metric, split: p.view.summary.split, market, num: numbers.get(b.id), toggle: live.current.onToggleBuilding ? () => live.current.onToggleBuilding?.(b.id) : undefined }),
      );
      popup.on('open', () => {
        popup.setOffset(popupOffset(element));
        requestAnimationFrame(() => keepPopupInView(map, popup));
        // The photo arrives after the popup opens and makes it taller.
        popup.getElement()?.addEventListener('load', () => keepPopupInView(map, popup), true);
      });
      const marker = new maplibregl.Marker({ element, draggable: p.editable, anchor: 'center' })
        .setLngLat(b.lngLat)
        .setPopup(popup)
        .addTo(map);
      element.addEventListener('click', () => live.current.onSelect(b.id));
      // Locked: swallow the press before MapLibre starts a drag (Shift lets one through). Clicks still select.
      // The editor is told when the pointer actually moves, so a plain click does not trigger the hint.
      element.addEventListener(
        'mousedown',
        (e) => {
          if (!live.current.pinsLocked || e.shiftKey) return;
          e.stopPropagation();
          const [x0, y0] = [e.clientX, e.clientY];
          const move = (m: MouseEvent) => {
            if (Math.hypot(m.clientX - x0, m.clientY - y0) < 6) return;
            window.removeEventListener('mousemove', move);
            live.current.onLockedDrag?.();
          };
          window.addEventListener('mousemove', move);
          window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true });
        },
        true,
      );
      element.addEventListener('touchstart', (e) => { if (live.current.pinsLocked) e.stopPropagation(); }, { capture: true, passive: true });
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        live.current.onMove(b.id, [ll.lng, ll.lat]);
      });
      if (wasOpen) marker.togglePopup();
      markers.current.set(b.id, marker);
    }
    // Wait a frame so the new pins are laid out, then untangle any that overlap.
    requestAnimationFrame(() => layoutPins(markers.current, placements.current));
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
  }, [p.survey.buildings, filter, p.view.metric, p.editable, ready, net, showNet, market, numbers]);

  // Selection only changes the highlight. It must not rebuild markers (that would close the popup) and it must
  // not re-plan the layout (that would move the other pills while someone is trying to follow one).
  useEffect(() => {
    for (const [id, m] of markers.current) m.getElement().classList.toggle('selected', id === p.selectedId);
  }, [p.selectedId, p.survey.buildings, filter, p.view.metric, ready]);

  // Distance rings around the subject property.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    ringMarkers.current.forEach((m) => m.remove());
    ringMarkers.current = [];
    const subjects = p.survey.buildings.filter((b) => b.isSubject && !b.out && b.lngLat); // the one being compared
    const radii = ringRadii(p.view);
    const src = map.getSource('rings') as maplibregl.GeoJSONSource;
    if (subjects.length === 0 || radii.length === 0) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    // Rings go around the subject being compared (with several, the chosen one).
    src.setData({
      type: 'FeatureCollection',
      features: subjects.flatMap((s) =>
        radii.map((km) => ({
          type: 'Feature' as const,
          properties: { km },
          geometry: { type: 'LineString' as const, coordinates: circleCoords(s.lngLat!, km) },
        })),
      ),
    });
    const c = subjects[0].lngLat!;
    const labels = radii.map((km) => ({
      km,
      marker: new maplibregl.Marker({ element: el('div', 'ring-label', `${km} km`), anchor: 'bottom' })
        .setLngLat(ringTop(c, km))
        .addTo(map),
    }));
    ringMarkers.current = labels.map((l) => l.marker);
    // Hide a ring's label while the ring is too small on screen to label without clutter.
    const syncLabels = () => {
      const centre = map.project(c);
      for (const { km, marker } of labels) {
        const top = map.project(ringTop(c, km));
        marker.getElement().style.display = Math.abs(centre.y - top.y) < 70 ? 'none' : '';
      }
    };
    syncLabels();
    map.on('zoom', syncLabels);
    return () => {
      map.off('zoom', syncLabels);
    };
  }, [p.survey.buildings, p.view.rings, p.view.ringsKm, p.view.within, ready, styleVersion]);

  // Fit to all placed buildings (and the outermost ring) when asked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pts = p.survey.buildings.map((b) => b.lngLat).filter((x): x is LngLat => !!x);
    if (pts.length === 0) return;
    const bounds = new maplibregl.LngLatBounds(pts[0], pts[0]);
    pts.forEach((x) => bounds.extend(x));
    map.fitBounds(bounds, { padding: { top: 70, bottom: 70, left: 90, right: 90 }, maxZoom: 15, duration: 0 });
  }, [p.fitKey, ready]);

  // Fly to the selected building when it is chosen from the sidebar.
  useEffect(() => {
    const map = mapRef.current;
    const b = p.survey.buildings.find((x) => x.id === p.selectedId);
    if (!map || !ready || !b?.lngLat) return;
    if (!map.getBounds().contains(b.lngLat)) map.easeTo({ center: b.lngLat, duration: 400 });
  }, [p.selectedId, ready]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = p.placingId ? 'crosshair' : '';
  }, [p.placingId, ready]);

  const onDragOver = (e: React.DragEvent) => {
    if (!p.onDropBuilding || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropReady(true);
  };
  const onDrop = (e: React.DragEvent) => {
    setDropReady(false);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const map = mapRef.current;
    if (!id || !map || !p.onDropBuilding) return;
    e.preventDefault();
    const rect = container.current!.getBoundingClientRect();
    const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    p.onDropBuilding(id, [ll.lng, ll.lat]); // the pin's tip lands where the building was dropped
  };

  return (
    <div
      ref={container}
      className={dropReady ? 'map drop-ready' : 'map'}
      onDragOver={onDragOver}
      onDragLeave={() => setDropReady(false)}
      onDrop={onDrop}
    />
  );
}
