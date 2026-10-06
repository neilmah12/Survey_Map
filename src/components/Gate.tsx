import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as fbSignOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import logo from '../assets/avison-young-logo.png';
import { auth, db } from '../lib/firebase';
import { firebaseConfigured } from '../lib/firebaseConfig';
import { saveDraft } from '../lib/store';

export interface TeamUser {
  email: string;
  name: string;
}

type State =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'checking'; user: User }
  | { kind: 'denied'; user: User }
  | { kind: 'ok'; user: TeamUser; offline: boolean };

const usingEmulator = import.meta.env.VITE_USE_EMULATORS === '1';

/**
 * Sign-in screen. This only decides what the page shows; the real protection is the Firestore rules, which
 * refuse every read and write unless the verified email is listed at allowedUsers/<email>.
 */
export default function Gate({ children }: { children: (user: TeamUser, signOut: () => void, offline: boolean) => ReactNode }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [error, setError] = useState('');

  const check = useCallback(async (user: User) => {
    const email = (user.email ?? '').toLowerCase();
    setState({ kind: 'checking', user });
    try {
      const snap = await getDoc(doc(db, 'allowedUsers', email));
      setState(snap.exists() ? { kind: 'ok', user: { email, name: user.displayName ?? email }, offline: false } : { kind: 'denied', user });
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      // No network: the browser copy of the survey stays usable. Cloud saves wait until the connection returns.
      if (code === 'unavailable' || code === 'deadline-exceeded') setState({ kind: 'ok', user: { email, name: user.displayName ?? email }, offline: true });
      else setState({ kind: 'denied', user });
    }
  }, []);

  useEffect(() => onAuthStateChanged(auth, (u) => (u ? void check(u) : setState({ kind: 'signedOut' }))), [check]);

  const signIn = async () => {
    setError('');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      setError(code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' : 'Sign-in failed. Please try again.');
    }
  };

  const signOut = useCallback(() => {
    saveDraft(null); // do not leave internal survey data in this browser after sign-out
    void fbSignOut(auth);
  }, []);

  if (!firebaseConfigured && !usingEmulator) {
    return (
      <div className="empty">
        <img className="logo" src={logo} alt="Avison Young" />
        <h1>Sign-in is not set up yet</h1>
        <p>The Firebase web API key has not been added to this build.</p>
      </div>
    );
  }
  if (state.kind === 'loading' || state.kind === 'checking') {
    return (
      <div className="empty">
        <img className="logo" src={logo} alt="Avison Young" />
        <p>{state.kind === 'loading' ? 'Loading' : 'Checking access'}...</p>
      </div>
    );
  }
  if (state.kind === 'signedOut') {
    return (
      <div className="empty">
        <img className="logo" src={logo} alt="Avison Young" />
        <h1>Rental Market Survey Map</h1>
        <p>Team sign-in. Access is limited to approved Avison Young staff.</p>
        <button className="btn primary" onClick={signIn}>Sign in with Google</button>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }
  if (state.kind === 'denied') {
    return (
      <div className="empty">
        <img className="logo" src={logo} alt="Avison Young" />
        <h1>No access</h1>
        <p><strong>{state.user.email}</strong> is not on the approved list. Ask the survey administrator to add this address, then try again.</p>
        <div className="row-actions">
          <button className="btn primary" onClick={() => void check(state.user)}>Try again</button>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }
  return <>{children(state.user, signOut, state.offline)}</>;
}
