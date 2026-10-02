import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from '../lib/workerUrl';
import type { Building, LngLat, Survey, ViewSettings } from '../types';
import { safeUrl } from '../lib/safeUrl';
import { normalizeUnitType } from '../lib/parse';
import { circleCoords, ringTop } from '../lib/geo';
import { money, pinLabel, psf, unitNet, unitPsf } from '../lib/format';
import { kindContext, visibleUnits, type UnitFilter } from '../lib/groups';

maplibregl.setWorkerUrl(workerUrl);

const STYLE_URL =
  (import.meta.env.VITE_BASEMAP_STYLE as string | undefined) ?? 'https://tiles.openfreemap.org/styles/positron';
/** Plain background used when the basemap cannot load, so pins stay usable. */
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e6ebf2' } }],
};
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
  fitKey: number;
}

function el(tag: string, cls?: string, txt?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function pinElement(b: Building, label: string, selected: boolean): HTMLElement {
  const root = el('div', `pin${b.isSubject ? ' subject' : ''}${selected ? ' selected' : ''}`);
  const pill = el('div', 'pin-pill');
  pill.append(el('span', 'pin-rate', label));
  if (b.units.some((u) => u.incentive)) pill.append(el('span', 'pin-badge', 'Inc'));
  root.append(pill, el('div', 'pin-name', b.name), el('div', 'pin-tip'));
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
  const facts = [
    b.yearBuilt && `Built ${b.yearBuilt}`,
    b.yearRenovated && `Renovated ${b.yearRenovated}`,
    b.configuration,
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
    const tr = el('tr');
    for (const c of cols) tr.append(c.cell(r));
    table.append(tr);
  }
  root.append(table);

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

export default function MapView(p: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, maplibregl.Marker>());
  const ringMarkers = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
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
      style: STYLE_URL === 'blank' ? BLANK_STYLE : STYLE_URL,
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
      const element = pinElement(b, label, b.id === live.current.selectedId);
      // Rebuilding a marker closes its popup, so remember and restore it.
      const old = markers.current.get(b.id);
      const wasOpen = old?.getPopup()?.isOpen() ?? false;
      old?.remove();
      const marker = new maplibregl.Marker({ element, draggable: p.editable, anchor: 'bottom' })
        .setLngLat(b.lngLat)
        .setPopup(
          new maplibregl.Popup({ offset: 14, maxWidth: '380px', closeButton: true }).setDOMContent(
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

  return <div ref={container} className="map" />;
}
