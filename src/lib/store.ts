import type { Survey } from '../types';
import type { CloudLink } from '../hooks/useCloudSync';

const KEY = 'survey-map:draft';

export interface Draft {
  survey: Survey;
  /** ISO time of the last autosave; absent for drafts written by older versions. */
  savedAt?: string;
  /** Which cloud survey this draft belongs to, and whether it has changes not yet saved there. */
  cloud?: CloudLink;
}

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Older versions stored the survey directly; newer ones wrap it with a timestamp.
    if (parsed && parsed.survey && Array.isArray(parsed.survey.buildings)) return parsed as Draft;
    if (parsed && Array.isArray(parsed.buildings)) return { survey: parsed as Survey };
    return null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused the write (storage full or unavailable). */
export function saveDraft(survey: Survey | null, cloud?: CloudLink): boolean {
  try {
    if (survey) localStorage.setItem(KEY, JSON.stringify({ survey, savedAt: new Date().toISOString(), cloud } satisfies Draft));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadJson(survey: Survey) {
  const blob = new Blob([JSON.stringify(survey, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${survey.title.replace(/[^\w-]+/g, '_') || 'survey'}.survey.json`);
}
