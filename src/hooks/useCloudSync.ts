import { useCallback, useEffect, useRef, useState } from 'react';
import type { Survey } from '../types';
import { ConflictError, getEntry, saveSurvey } from '../lib/cloud';

/** Which cloud survey the editor is working on. `dirty` means there are changes not yet in the cloud. */
export interface CloudLink {
  id: string | null;
  rev: number;
  dirty: boolean;
}

export type SyncStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

const DEBOUNCE_MS = 2500;
const RETRY_MS = 20_000;

/**
 * Autosaves the survey to the cloud a moment after each change. Keeps `link` up to date so the browser's
 * offline copy remembers where it belongs. A save that finds a newer cloud copy stops and asks the user.
 */
export function useCloudSync(survey: Survey | null, email: string, link: CloudLink, setLink: (fn: (l: CloudLink) => CloudLink) => void, baseline: Survey | null) {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState('');
  const [conflictBy, setConflictBy] = useState('');
  const latest = useRef({ survey, link, email });
  latest.current = { survey, link, email };
  const clean = useRef<Survey | null>(baseline); // the survey object that is already in the cloud
  const busy = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const halted = useRef(false);

  const run = useCallback(async () => {
    if (halted.current) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    const { survey: s, link: l, email: em } = latest.current;
    if (!s || s === clean.current) return;
    busy.current = true;
    setStatus('saving');
    try {
      const { id, rev } = await saveSurvey(l.id, s, l.rev, em);
      clean.current = s;
      const stillClean = latest.current.survey === s;
      setLink((cur) => ({ id, rev, dirty: !stillClean && cur.dirty }));
      setSavedAt(new Date());
      setStatus('saved');
      setMessage('');
    } catch (e) {
      if (e instanceof ConflictError) {
        halted.current = true;
        setConflictBy(e.updatedBy);
        setStatus('conflict');
      } else {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Could not reach the cloud');
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(run, RETRY_MS); // offline: keep trying, the browser copy is safe meanwhile
      }
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(run, 200);
      }
    }
  }, [setLink]);

  useEffect(() => {
    if (!survey || survey === clean.current) return;
    setLink((l) => (l.dirty ? l : { ...l, dirty: true }));
    if (halted.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [survey, run, setLink]);

  useEffect(() => {
    const online = () => run();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [run]);

  /** Save right now (used before switching surveys). Resolves when nothing is pending. */
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    while (busy.current) await new Promise((r) => setTimeout(r, 100));
    await run();
  }, [run]);

  /** The editor loaded or created a survey that is already in the cloud (or has no cloud copy yet). */
  const adopt = useCallback((s: Survey | null) => {
    clean.current = s;
    halted.current = false;
    again.current = false;
    window.clearTimeout(timer.current);
    setStatus('idle');
    setMessage('');
  }, []);

  /** After a conflict: keep my version (take the cloud's current revision as the base) or let the caller load theirs. */
  const keepMine = useCallback(async () => {
    const { link: l } = latest.current;
    if (!l.id) return;
    const entry = await getEntry(l.id);
    setLink((cur) => ({ ...cur, rev: entry?.rev ?? 0 }));
    latest.current = { ...latest.current, link: { ...l, rev: entry?.rev ?? 0 } };
    halted.current = false;
    setStatus('idle');
    await run();
  }, [run, setLink]);

  return { status, savedAt, message, conflictBy, flush, adopt, keepMine };
}
