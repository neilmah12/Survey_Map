import { PHOTO_MARK, MAX_DOC_BYTES, shortHash, type FilePart } from './cloudSplit';
import type { ClientSnapshot } from './snapshot';

/**
 * A published snapshot is stored as one small document plus one document per uploaded photo, so the main
 * document stays far below Firestore's 1 MB limit. The client page loads a photo only when its popup opens.
 */
export interface PublishParts {
  /** JSON string of the snapshot with embedded photos replaced by `cloud-photo:<id>` pointers. */
  main: string;
  photos: FilePart[];
}

export async function splitSnapshot(snapshot: ClientSnapshot): Promise<PublishParts> {
  const photos = new Map<string, FilePart>();
  const buildings = await Promise.all(
    snapshot.buildings.map(async (b) => {
      if (!b.imageUrl.startsWith('data:')) return b;
      const id = `p_${await shortHash(b.imageUrl)}`;
      photos.set(id, { id, kind: 'photo', data: b.imageUrl });
      return { ...b, imageUrl: PHOTO_MARK + id };
    }),
  );
  const main = JSON.stringify({ ...snapshot, buildings });
  const size = (s: string) => new TextEncoder().encode(s).length;
  if (size(main) > MAX_DOC_BYTES) throw new Error('The client snapshot is too large to publish.');
  for (const p of photos.values()) if (size(p.data) > MAX_DOC_BYTES) throw new Error('A photo is too large to publish. Use a smaller photo.');
  return { main, photos: [...photos.values()] };
}

export function photoIdsOf(main: string): string[] {
  const s = JSON.parse(main) as ClientSnapshot;
  return s.buildings.filter((b) => b.imageUrl?.startsWith(PHOTO_MARK)).map((b) => b.imageUrl.slice(PHOTO_MARK.length));
}

/** True when two published documents show the same survey (the publish time is ignored). */
export function sameContent(a: string, b: string): boolean {
  try {
    const strip = (t: string) => JSON.stringify({ ...JSON.parse(t), publishedAt: '' });
    return strip(a) === strip(b);
  } catch {
    return false;
  }
}

/** 128 random bits as hex. Unguessable, so the link itself is the access control. */
export function newPublishId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

export const PUBLISH_ID = /^[a-f0-9]{32}$/;
