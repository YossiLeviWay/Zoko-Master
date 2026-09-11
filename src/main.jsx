import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { cleanLegacyBrowserData } from './utils/browserPrivacy.js'

cleanLegacyBrowserData();
const redirect = new URLSearchParams(window.location.hash.slice(1)).get('spa-route')
if (redirect) {
  try {
    const target = new URL(redirect, window.location.origin)
    if (target.origin === window.location.origin) window.history.replaceState(null, '', target.href)
  } catch {
    // Ignore malformed redirect state.
  }
}
import App from './App.jsx'
import { authPrivacyReady, isFirebaseConfigured, missingFirebaseVariables } from './firebase.js'

function ConfigurationError() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: '#fbf6f5' }}>
      <section style={{ maxWidth: 680, padding: '2rem', background: '#fff', border: '1px solid #eadfe2', borderRadius: 16, textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>נדרשת הגדרת Firebase</h1>
        <p>יש להעתיק את <code>.env.example</code> אל <code>.env.local</code> ולמלא את המשתנים הבאים:</p>
        <code dir="ltr" style={{ display: 'block', whiteSpace: 'pre-wrap', color: '#b91c1c' }}>
          {missingFirebaseVariables.join('\n')}
        </code>
      </section>
    </main>
  );
}

const root = createRoot(document.getElementById('root'));
authPrivacyReady.then(() => root.render(
  <StrictMode>
    {isFirebaseConfigured ? <App /> : <ConfigurationError />}
  </StrictMode>,
)).catch(() => root.render(<main role="alert">לא ניתן לאתחל חיבור פרטי. סגרו את הלשונית ונסו שוב.</main>));
