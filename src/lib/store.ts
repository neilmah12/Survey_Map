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

export function saveDraft(survey: Survey | null) {
  try {
    if (survey) localStorage.setItem(KEY, JSON.stringify(survey));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable (private window); the JSON export still works */
  }
}

export function downloadJson(survey: Survey) {
  const blob = new Blob([JSON.stringify(survey, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${survey.title.replace(/[^\w-]+/g, '_') || 'survey'}.survey.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
