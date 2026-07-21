import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { isFirebaseConfigured, missingFirebaseVariables } from './firebase.js'

function ConfigurationError() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: '#f8fafc' }}>
      <section style={{ maxWidth: 680, padding: '2rem', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>נדרשת הגדרת Firebase</h1>
        <p>יש להעתיק את <code>.env.example</code> אל <code>.env.local</code> ולמלא את המשתנים הבאים:</p>
        <code dir="ltr" style={{ display: 'block', whiteSpace: 'pre-wrap', color: '#b91c1c' }}>
          {missingFirebaseVariables.join('\n')}
        </code>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isFirebaseConfigured ? <App /> : <ConfigurationError />}
  </StrictMode>,
)
