import {
  collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, runTransaction, serverTimestamp, setDoc, writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import type { Survey } from '../types';
import { db } from './firebase';
import { joinSurvey, referencedFileIds, splitSurvey } from './cloudSplit';
import { removePublished } from './publish';

/**
 * Saved surveys shared by the team.
 *   surveys/{id}                small metadata document (title, revision, who saved last)
 *   surveys/{id}/files/main     the survey as JSON, without workbook or photos
 *   surveys/{id}/files/w_*, p_* the uploaded workbook and each photo, one document each
 * Every document stays far below Firestore's 1 MB limit.
 */
export interface CloudEntry {
  id: string;
  title: string;
  location: string;
  asOf: string;
  buildings: number;
  rev: number;
  updatedAt: Date | null;
  updatedBy: string;
  /** Set while a client link is live. */
  publishedId: string | null;
}

export class ConflictError extends Error {
  constructor(public updatedBy: string, public rev: number) {
    super('The cloud copy was changed by someone else');
  }
}

const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000;
const uploaded = new Set<string>(); // "surveyId/fileId" known to exist, so unchanged files are not sent again

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const metaRef = (id: string) => doc(db, 'surveys', id);
const fileRef = (id: string, fileId: string) => doc(db, 'surveys', id, 'files', fileId);

const toEntry = (id: string, d: Record<string, unknown>): CloudEntry => ({
  id,
  title: String(d.title ?? ''),
  location: String(d.location ?? ''),
  asOf: String(d.asOf ?? ''),
  buildings: Number(d.buildings ?? 0),
  rev: Number(d.rev ?? 0),
  updatedAt: (d.updatedAt as Timestamp | undefined)?.toDate?.() ?? null,
  updatedBy: String(d.updatedBy ?? ''),
  publishedId: d.published === true && typeof d.publishedId === 'string' ? d.publishedId : null,
});

export async function listSurveys(): Promise<CloudEntry[]> {
  const snap = await getDocs(query(collection(db, 'surveys'), orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => toEntry(d.id, d.data()));
}

export async function getEntry(id: string): Promise<CloudEntry | null> {
  const snap = await getDoc(metaRef(id));
  return snap.exists() ? toEntry(snap.id, snap.data()) : null;
}

export async function loadSurvey(id: string): Promise<{ survey: Survey; entry: CloudEntry }> {
  const [meta, main] = await Promise.all([getDoc(metaRef(id)), getDoc(fileRef(id, 'main'))]);
  if (!meta.exists() || !main.exists()) throw new Error('That survey no longer exists in the cloud');
  const mainJson = String(main.data().data);
  const files = new Map<string, { data: string; name?: string }>();
  await Promise.all(
    referencedFileIds(mainJson).map(async (fid) => {
      const f = await getDoc(fileRef(id, fid));
      if (f.exists()) {
        files.set(fid, { data: String(f.data().data), name: f.data().name });
        uploaded.add(`${id}/${fid}`);
      }
    }),
  );
  return { survey: joinSurvey(mainJson, files), entry: toEntry(id, meta.data()) };
}

/**
 * Saves a survey. `expectedRev` is the revision this browser last saw (0 for a new survey); if the cloud copy
 * has moved on, a ConflictError is thrown rather than overwriting someone else's work.
 */
export async function saveSurvey(id: string | null, survey: Survey, expectedRev: number, email: string): Promise<{ id: string; rev: number }> {
  const parts = await splitSurvey(survey);
  const sid = id ?? newId();
  // Files first, so the survey document never points at a file that is not there yet.
  await Promise.all(
    parts.files
      .filter((f) => !uploaded.has(`${sid}/${f.id}`))
      .map(async (f) => {
        await setDoc(fileRef(sid, f.id), { kind: f.kind, data: f.data, ...(f.name ? { name: f.name } : {}), createdAt: Date.now() });
        uploaded.add(`${sid}/${f.id}`);
      }),
  );
  const rev = await runTransaction(db, async (tx) => {
    const cur = await tx.get(metaRef(sid));
    const curRev = cur.exists() ? Number(cur.data().rev ?? 0) : 0;
    if (curRev !== expectedRev) throw new ConflictError(String(cur.data()?.updatedBy ?? 'someone'), curRev);
    tx.set(metaRef(sid), { ...parts.meta, rev: curRev + 1, updatedAt: serverTimestamp(), updatedBy: email }, { merge: true });
    tx.set(fileRef(sid, 'main'), { kind: 'main', data: parts.main, rev: curRev + 1 });
    return curRev + 1;
  });
  void pruneFiles(sid, new Set([...referencedFileIds(parts.main), 'main']));
  return { id: sid, rev };
}

/** Removes files no longer used (replaced photos). Only files older than a few minutes, so a save in progress is safe. */
async function pruneFiles(sid: string, keep: Set<string>) {
  try {
    const snap = await getDocs(collection(db, 'surveys', sid, 'files'));
    await Promise.all(
      snap.docs
        .filter((d) => !keep.has(d.id) && Date.now() - Number(d.data().createdAt ?? 0) > ORPHAN_MIN_AGE_MS)
        .map((d) => {
          uploaded.delete(`${sid}/${d.id}`);
          return deleteDoc(d.ref);
        }),
    );
  } catch {
    // best effort
  }
}

export async function deleteSurvey(id: string): Promise<void> {
  // A deleted survey must not leave a live client link behind.
  const meta = await getDoc(metaRef(id));
  if (typeof meta.data()?.publishedId === 'string') await removePublished(meta.data()!.publishedId as string);
  const snap = await getDocs(collection(db, 'surveys', id, 'files'));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(metaRef(id));
  await batch.commit();
  for (const k of [...uploaded]) if (k.startsWith(`${id}/`)) uploaded.delete(k);
}
