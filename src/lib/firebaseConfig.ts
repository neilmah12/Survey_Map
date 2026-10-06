// Public web config for the Firebase project. These values are not secrets (they ship in every web page);
// access is controlled by the Firestore rules. Find them in the Firebase console:
// Project settings > General > Your apps > Web app > SDK setup and configuration.
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'REPLACE_WITH_WEB_API_KEY',
  authDomain: 'avison-young-rental-survey.firebaseapp.com',
  projectId: 'avison-young-rental-survey',
};

export const firebaseConfigured = !firebaseConfig.apiKey.startsWith('REPLACE');

/** Where published client links live. `VITE_CLIENT_ORIGIN` overrides it for local testing. */
export const clientOrigin: string = import.meta.env.VITE_CLIENT_ORIGIN ?? 'https://avison-young-rental-survey.web.app';
