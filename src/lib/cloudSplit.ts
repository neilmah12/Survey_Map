import type { Survey } from '../types';

/**
 * Firestore documents are limited to 1 MB, so a survey is stored as several documents: a small metadata
 * document for lists, a "main" document with the survey as JSON, and one document per uploaded workbook and
 * per uploaded photo. File documents are named by a hash of their content, so they never change once written
 * and an unchanged photo is never uploaded twice.
 */
export const PHOTO_MARK = 'cloud-photo:';

/** Safety margin under Firestore's 1,048,576 byte document limit. */
export const MAX_DOC_BYTES = 950_000;

export interface FilePart {
  id: string;
  kind: 'photo' | 'workbook';
  /** A data URL for photos, base64 for the workbook. */
  data: string;
  name?: string;
}

export interface CloudMeta {
  title: string;
  location: string;
  asOf: string;
  buildings: number;
}

export interface CloudParts {
  meta: CloudMeta;
  /** JSON string: the survey without its workbook or embedded photos, plus pointers to them. */
  main: string;
  files: FilePart[];
}

interface MainDoc {
  survey: Survey;
  workbook?: { id: string; name: string };
}

export async function shortHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

export async function splitSurvey(survey: Survey): Promise<CloudParts> {
  const files = new Map<string, FilePart>();
  const { source, ...rest } = survey;
  const buildings = await Promise.all(
    rest.buildings.map(async (b) => {
      if (!b.imageUrl?.startsWith('data:')) return b;
      const id = `p_${await shortHash(b.imageUrl)}`;
      files.set(id, { id, kind: 'photo', data: b.imageUrl });
      return { ...b, imageUrl: PHOTO_MARK + id };
    }),
  );
  const doc: MainDoc = { survey: { ...rest, buildings } };
  if (source) {
    const id = `w_${await shortHash(source.data)}`;
    files.set(id, { id, kind: 'workbook', data: source.data, name: source.name });
    doc.workbook = { id, name: source.name };
  }
  const main = JSON.stringify(doc);
  for (const [label, text] of [['The survey', main] as const, ...[...files.values()].map((f) => [f.kind === 'photo' ? 'A photo' : 'The Excel workbook', f.data] as const)]) {
    if (byteLength(text) > MAX_DOC_BYTES) throw new Error(`${label} is too large to save to the cloud (limit about 0.9 MB). Use a smaller file.`);
  }
  return {
    meta: { title: survey.title, location: survey.location, asOf: survey.asOf, buildings: survey.buildings.length },
    main,
    files: [...files.values()],
  };
}

/** Ids of the file documents a main document points to. */
export function referencedFileIds(main: string): string[] {
  const doc = JSON.parse(main) as MainDoc;
  const ids = new Set<string>();
  if (doc.workbook?.id) ids.add(doc.workbook.id);
  for (const b of doc.survey.buildings) if (b.imageUrl?.startsWith(PHOTO_MARK)) ids.add(b.imageUrl.slice(PHOTO_MARK.length));
  return [...ids];
}

/** Rebuilds the survey. A photo that cannot be found is dropped rather than left as a broken marker. */
export function joinSurvey(main: string, files: Map<string, { data: string; name?: string }>): Survey {
  const doc = JSON.parse(main) as MainDoc;
  if (!doc?.survey || !Array.isArray(doc.survey.buildings)) throw new Error('This cloud survey is damaged');
  const buildings = doc.survey.buildings.map((b) => {
    if (!b.imageUrl?.startsWith(PHOTO_MARK)) return b;
    const photo = files.get(b.imageUrl.slice(PHOTO_MARK.length));
    return { ...b, imageUrl: photo?.data ?? '' };
  });
  const survey: Survey = { ...doc.survey, buildings };
  const wb = doc.workbook && files.get(doc.workbook.id);
  if (doc.workbook && wb) survey.source = { name: doc.workbook.name, data: wb.data };
  return survey;
}
