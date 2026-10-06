import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import Gate from './components/Gate';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gate>{(user, signOut, offline) => <App user={user} onSignOut={signOut} offline={offline} />}</Gate>
  </StrictMode>,
);
