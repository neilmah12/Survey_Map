// The published client page keeps photos in separate documents and loads one when its popup opens. The page
// registers a loader here; the map popup uses it for pictures stored as `cloud-photo:<id>`. Without a loader
// (the editor, a downloaded client file) embedded photos and web links work as before.
export type PhotoLoader = (photoId: string) => Promise<string>;

let loader: PhotoLoader | null = null;
const cache = new Map<string, Promise<string>>();

export function setPhotoLoader(fn: PhotoLoader | null) {
  loader = fn;
  cache.clear();
}

export function loadPhoto(photoId: string): Promise<string> | null {
  if (!loader) return null;
  let p = cache.get(photoId);
  if (!p) {
    p = loader(photoId);
    p.catch(() => cache.delete(photoId)); // let a failed load be retried
    cache.set(photoId, p);
  }
  return p;
}
