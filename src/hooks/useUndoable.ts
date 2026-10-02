import { useCallback, useReducer } from 'react';

interface State<T> {
  past: T[];
  present: T;
  future: T[];
  /** Time of the last change, so rapid edits (typing, dragging) collapse into one undo step. */
  at: number;
}

type Action<T> =
  | { type: 'set'; next: T | ((s: T) => T); now: number; commit: boolean }
  | { type: 'reset'; next: T }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 60;
const COALESCE_MS = 700;

function reducer<T>(s: State<T>, a: Action<T>): State<T> {
  switch (a.type) {
    case 'set': {
      const next = typeof a.next === 'function' ? (a.next as (x: T) => T)(s.present) : a.next;
      if (next === s.present) return s;
      const coalesce = !a.commit && s.past.length > 0 && a.now - s.at < COALESCE_MS;
      return {
        past: coalesce ? s.past : [...s.past, s.present].slice(-LIMIT),
        present: next,
        future: [],
        at: a.now,
      };
    }
    case 'reset':
      return { past: [], present: a.next, future: [], at: 0 };
    case 'undo': {
      if (s.past.length === 0) return s;
      return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], at: 0 };
    }
    case 'redo': {
      if (s.future.length === 0) return s;
      return { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), at: 0 };
    }
  }
}

/** State with undo and redo. Pass { commit: true } to force a separate undo step. */
export function useUndoable<T>(initial: () => T) {
  const [s, dispatch] = useReducer(reducer<T>, undefined, () => ({ past: [], present: initial(), future: [], at: 0 }));
  const set = useCallback(
    (next: T | ((s: T) => T), opts?: { commit?: boolean }) =>
      dispatch({ type: 'set', next, now: Date.now(), commit: opts?.commit ?? false }),
    [],
  );
  const reset = useCallback((next: T) => dispatch({ type: 'reset', next }), []);
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  return { state: s.present, set, reset, undo, redo, canUndo: s.past.length > 0, canRedo: s.future.length > 0 };
}
