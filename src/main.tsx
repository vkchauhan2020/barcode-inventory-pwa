import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const serviceWorkerUrl = new URL('sw.js', window.location.href);
    navigator.serviceWorker.register(serviceWorkerUrl).catch(() => {
      // The app still works online if service worker registration is unavailable.
    });
  });
}
