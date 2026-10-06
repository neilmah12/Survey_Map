import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './firebaseConfig';

// Editor only. The client viewer never imports this file: it reads published snapshots with plain fetch.
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// `VITE_USE_EMULATORS=1 npm run dev` talks to the local Firebase emulators instead of the real project.
if (import.meta.env.VITE_USE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  // Test hook for browser tests: the Google pop-up needs Google's servers, the emulator accepts a fake credential.
  (window as unknown as Record<string, unknown>).__testSignIn = (email: string, verified = true) =>
    signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: verified })));
}
