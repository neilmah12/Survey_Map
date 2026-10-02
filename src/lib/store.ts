import type { Survey } from '../types';

const KEY = 'survey-map:draft';

export function loadDraft(): Survey | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Survey) : null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused the write (storage full or unavailable). */
export function saveDraft(survey: Survey | null): boolean {
  try {
    if (survey) localStorage.setItem(KEY, JSON.stringify(survey));
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
