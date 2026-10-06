import { firebaseConfig } from './firebaseConfig';
import { isSnapshot, type ClientSnapshot } from './snapshot';
import { PUBLISH_ID } from './publishSplit';

// Used by the client page. Reads published documents with a plain fetch to the Firestore REST API, with no
// sign-in and no Firebase SDK, so the client bundle carries no auth or editing code. The Firestore rules
// allow exactly this: get by id, never list.
const usingEmulator = import.meta.env.VITE_USE_EMULATORS === '1';
const root = `${usingEmulator ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com'}/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
const keyParam = firebaseConfig.apiKey.startsWith('REPLACE') ? '' : `?key=${encodeURIComponent(firebaseConfig.apiKey)}`;

export type PublishedResult = { status: 'ok'; snapshot: ClientSnapshot } | { status: 'missing' } | { status: 'error' };

async function getString(path: string): Promise<{ found: false } | { found: true; data: string }> {
  const res = await fetch(`${root}/${path}${keyParam}`);
  if (res.status === 404) return { found: false };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { fields?: { data?: { stringValue?: string } } };
  const data = json.fields?.data?.stringValue;
  if (typeof data !== 'string') throw new Error('Unexpected response');
  return { found: true, data };
}

export async function fetchPublished(id: string): Promise<PublishedResult> {
  if (!PUBLISH_ID.test(id)) return { status: 'missing' };
  try {
    const r = await getString(`published/${id}`);
    if (!r.found) return { status: 'missing' };
    const parsed: unknown = JSON.parse(r.data);
    return isSnapshot(parsed) ? { status: 'ok', snapshot: parsed } : { status: 'error' };
  } catch {
    return { status: 'error' };
  }
}

/** A photo as a data URL, loaded when its popup opens. */
export async function fetchPhoto(pubId: string, photoId: string): Promise<string> {
  if (!PUBLISH_ID.test(pubId) || !/^p_[a-f0-9]{32}$/.test(photoId)) throw new Error('bad id');
  const r = await getString(`published/${pubId}/photos/${photoId}`);
  if (!r.found) throw new Error('missing');
  return r.data;
}
