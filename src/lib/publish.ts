import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { clientOrigin } from './firebaseConfig';
import { newPublishId, photoIdsOf, sameContent, splitSnapshot } from './publishSplit';
import type { ClientSnapshot } from './snapshot';

/**
 * Publishing. A snapshot goes to published/{id} (and its photos to published/{id}/photos/{photoId}); the id is
 * 128 random bits, so the link is the only way in. The survey's own document remembers the id, so
 * Unpublish followed by Publish gives back the same link.
 */
export const publishedUrl = (id: string) => `${clientOrigin}/s/${id}`;

export interface PublishState {
  /** The reserved id, kept after Unpublish so re-publishing reuses the link. */
  id: string | null;
  published: boolean;
  /** For a published survey: does the live link show exactly what the editor would publish now. */
  upToDate: boolean | null;
  publishedAt: Date | null;
}

const metaRef = (surveyId: string) => doc(db, 'surveys', surveyId);
const pubRef = (id: string) => doc(db, 'published', id);
const photoRef = (id: string, pid: string) => doc(collection(db, 'published', id, 'photos'), pid);

export async function getPublishState(surveyId: string, snapshot: ClientSnapshot | null): Promise<PublishState> {
  const meta = await getDoc(metaRef(surveyId));
  const id = typeof meta.data()?.publishedId === 'string' ? (meta.data()!.publishedId as string) : null;
  if (!id || !meta.data()?.published) return { id, published: false, upToDate: null, publishedAt: null };
  const live = await getDoc(pubRef(id));
  if (!live.exists()) return { id, published: false, upToDate: null, publishedAt: null };
  let upToDate: boolean | null = null;
  if (snapshot) upToDate = sameContent(String(live.data().data), (await splitSnapshot(snapshot)).main);
  return { id, published: true, upToDate, publishedAt: (live.data().publishedAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null };
}

/** Publishes or re-publishes. Returns the id. Photos no longer used are removed. */
export async function publishSnapshot(surveyId: string, snapshot: ClientSnapshot): Promise<string> {
  const meta = await getDoc(metaRef(surveyId));
  const id = typeof meta.data()?.publishedId === 'string' ? (meta.data()!.publishedId as string) : newPublishId();
  const { main, photos } = await splitSnapshot(snapshot);
  const before = await getDoc(pubRef(id));
  const oldPhotoIds = before.exists() ? photoIdsOf(String(before.data().data)) : [];
  // Photos first, then the snapshot that points at them.
  await Promise.all(photos.map((p) => setDoc(photoRef(id, p.id), { data: p.data })));
  await setDoc(pubRef(id), { data: main, publishedAt: serverTimestamp() });
  await updateDoc(metaRef(surveyId), { publishedId: id, published: true, publishedAt: serverTimestamp() });
  const keep = new Set(photos.map((p) => p.id));
  await Promise.all(oldPhotoIds.filter((p) => !keep.has(p)).map((p) => deleteDoc(photoRef(id, p)).catch(() => {})));
  return id;
}

/** Takes the link down. The id stays reserved on the survey so a later Publish reuses it. */
export async function unpublishSurvey(surveyId: string): Promise<void> {
  const meta = await getDoc(metaRef(surveyId));
  const id = meta.data()?.publishedId as string | undefined;
  if (id) await removePublished(id);
  if (meta.exists()) await updateDoc(metaRef(surveyId), { published: false });
}

/** Deletes a published snapshot and its photos (their ids are read from the snapshot, since nobody can list). */
export async function removePublished(id: string): Promise<void> {
  const live = await getDoc(pubRef(id));
  if (live.exists()) {
    await Promise.all(photoIdsOf(String(live.data().data)).map((p) => deleteDoc(photoRef(id, p)).catch(() => {})));
    await deleteDoc(pubRef(id));
  }
}

