import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BLANK_STYLE, initialStyle } from '../lib/basemap';
import { layoutPins as planPins } from '../lib/pinLayout';
import type { Building, LngLat, Survey, ViewSettings } from '../types';
import { safeUrl } from '../lib/safeUrl';
import { DRAG_TYPE } from '../lib/dnd';
import { normalizeUnitType } from '../lib/unitText';
import { circleCoords, ringTop } from '../lib/geo';
import { money, pinLabel, psf, unitNet, unitPsf } from '../lib/format';
import { kindContext, unitKind, visibleUnits, type UnitFilter } from '../lib/groups';

const EDMONTON: LngLat = [-113.4938, 53.5461];

interface Props {
  survey: Survey;
  view: ViewSettings;
  editable: boolean;
  selectedId: string | null;
  placingId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, lngLat: LngLat) => void;
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

function pinElement(b: Building, label: string, selected: boolean, excluded: boolean): HTMLElement {
  const root = el('div', `pin${b.isSubject ? ' subject' : ''}${selected ? ' selected' : ''}${excluded ? ' excluded' : ''}`);
  const pill = el('div', 'pin-pill');
  pill.append(el('span', 'pin-rate', label));
  if (b.units.some((u) => u.incentive)) pill.append(el('span', 'pin-badge', 'Inc'));
  const head = el('div', 'pin-head');
  head.append(pill, el('div', 'pin-leader'));
  root.append(head, el('div', 'pin-name', b.name), el('div', 'pin-tip'));
  return root;
}

function popupContent(b: Building, filter: UnitFilter): HTMLElement {
  const root = el('div', 'popup');
  const imgSrc = safeUrl(b.imageUrl, true);
  const listing = safeUrl(b.url);
  if (imgSrc) {
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
    img.src = imgSrc;
  }
  root.append(el('div', 'popup-title', b.name));
  if (b.isSubject) root.append(el('div', 'popup-tag', 'Subject property'));
  root.append(el('div', 'popup-sub', b.address));
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
  const rows = units.map((u) => ({ u, p: unitPsf(u), n: unitNet(u) }));
  const cols = [
    { h: 'Unit', show: true, cell: (r: (typeof rows)[number]) => el('td', undefined, normalizeUnitType(r.u.type)) },
    { h: 'SF', show: rows.some((r) => r.u.sf), cell: (r: (typeof rows)[number]) => el('td', 'num', r.u.sf ? r.u.sf.toLocaleString('en-CA') : '-') },
    { h: 'Rent', show: true, cell: (r: (typeof rows)[number]) => el('td', 'num', r.u.rate != null ? money(r.u.rate) : '-') },
    { h: 'PSF', show: rows.some((r) => r.p != null), cell: (r: (typeof rows)[number]) => el('td', 'num', r.p != null ? psf(r.p) : '-') },
    { h: 'Net', show: rows.some((r) => r.n != null), cell: (r: (typeof rows)[number]) => el('td', 'num', r.n != null ? money(r.n) : '-') },
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

  const lines = new Map<string, string>();
  for (const u of units) {
    if (u.parking) lines.set('Parking', u.parking);
    if (u.utilities) lines.set('Utilities', u.utilities);
    if (u.incentive) lines.set('Incentive', u.incentive);
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
  return root;
}

const toRect = (r: DOMRect) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });

/** Measures every pin on screen, plans the layout with the shared algorithm, and applies it. */
function layoutPins(markers: Map<string, maplibregl.Marker>, selectedId: string | null) {
  const items = [...markers.entries()].map(([id, m], i) => {
    const root = m.getElement();
    root.style.setProperty('--lift', '0px');
    root.classList.remove('name-hidden');
    const pill = (root.querySelector('.pin-pill') as HTMLElement).getBoundingClientRect();
    const name = (root.querySelector('.pin-name') as HTMLElement).getBoundingClientRect();
    return { id, root, box: { id, pill: toRect(pill), name: toRect(name), order: id === selectedId ? -2 : root.classList.contains('subject') ? -1 : i } };
  });
  const plan = new Map(planPins(items.map((i) => i.box)).map((p) => [p.id, p]));
  for (const { id, root } of items) {
    const p = plan.get(id)!;
    root.style.setProperty('--lift', `${p.lift}px`);
    root.classList.toggle('name-hidden', p.nameHidden);
  }
}

export default function MapView(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const ringMarkers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [dropReady, setDropReady] = useState(false);
  // Bumped on every style (re)load so ring layers get re-added and re-filled.
  const [styleVersion, setStyleVersion] = useState(0);

  const ctx = useMemo(() => kindContext(p.survey), [p.survey]);
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
    const relayout = () => layoutPins(markers.current, live.current.selectedId);
    const reportBounds = () => {
      const bb = map.getBounds();
      live.current.onBounds?.([[bb.getWest(), bb.getSouth()], [bb.getEast(), bb.getNorth()]]);
    };
    map.on('zoomend', relayout);
    map.on('moveend', () => {
      relayout();
      reportBounds();
    });
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
      const label = pinLabel(b, filter, p.view.metric);
      const shown = visibleUnits(b, filter);
      const element = pinElement(b, label, b.id === live.current.selectedId, Boolean(b.excluded) || shown.every((u) => u.excluded));
      // Rebuilding a marker closes its popup, so remember and restore it.
      const old = markers.current.get(b.id);
      const wasOpen = old?.getPopup()?.isOpen() ?? false;
      old?.remove();
      const marker = new maplibregl.Marker({ element, draggable: p.editable, anchor: 'bottom' })
        .setLngLat(b.lngLat)
        .setPopup(
          new maplibregl.Popup({ offset: 14, maxWidth: window.innerWidth < 520 ? '88vw' : '380px', closeButton: true }).setDOMContent(
            popupContent(b, filter),
          ),
        )
        .addTo(map);
      element.addEventListener('click', () => live.current.onSelect(b.id));
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        live.current.onMove(b.id, [ll.lng, ll.lat]);
      });
      if (wasOpen) marker.togglePopup();
      markers.current.set(b.id, marker);
    }
    // Wait a frame so the new pins are laid out, then untangle any that overlap.
    requestAnimationFrame(() => layoutPins(markers.current, live.current.selectedId));
    for (const [id, m] of markers.current) {
      if (!seen.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
  }, [p.survey.buildings, filter, p.view.metric, p.editable, ready]);

  // Selection only changes the highlight, so it must not rebuild markers (that would close the popup).
  useEffect(() => {
    for (const [id, m] of markers.current) m.getElement().classList.toggle('selected', id === p.selectedId);
    layoutPins(markers.current, p.selectedId);
  }, [p.selectedId, p.survey.buildings, filter, p.view.metric, ready]);

  // Distance rings around the subject property.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    ringMarkers.current.forEach((m) => m.remove());
    ringMarkers.current = [];
    const subjects = p.survey.buildings.filter((b) => b.isSubject && b.lngLat);
    const src = map.getSource('rings') as maplibregl.GeoJSONSource;
    if (subjects.length === 0 || !p.view.rings) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    // Rings go around every subject (a portfolio has several); only the first is labelled.
    src.setData({
      type: 'FeatureCollection',
      features: subjects.flatMap((s) =>
        p.view.ringsKm.map((km) => ({
          type: 'Feature' as const,
          properties: { km },
          geometry: { type: 'LineString' as const, coordinates: circleCoords(s.lngLat!, km) },
        })),
      ),
    });
    const c = subjects[0].lngLat!;
    const labels = p.view.ringsKm.map((km) => ({
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
  }, [p.survey.buildings, p.view.rings, p.view.ringsKm, ready, styleVersion]);

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
