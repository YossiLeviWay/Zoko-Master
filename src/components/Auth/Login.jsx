import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import { auth } from '../../firebase';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStatus, setResetStatus] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch {
      setError('שם משתמש או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    setResetStatus('');
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetStatus('sent');
    } catch {
      setResetStatus('error');
    } finally {
      setResetLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <h1 className="auth-logo">Zoko-Master</h1>
          <p className="auth-subtitle">מערכת ניהול מוסדות חינוך</p>
        </div>

        {!showReset ? (
          <>
            {error && <div className="auth-error">{error}</div>}
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label>דוא"ל</label>
                <input
                  type="email"
                  value={email}
                  onChange={event => setEmail(event.target.value)}
                  placeholder="הזינו כתובת דוא״ל"
                  autoComplete="username"
                  required
                  dir="ltr"
                />
              </div>
              <div className="form-group">
                <label>סיסמה</label>
                <input
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="הזינו סיסמה"
                  autoComplete="current-password"
                  required
                  dir="ltr"
                />
              </div>
              <button type="submit" className="auth-btn" disabled={loading}>
                {loading ? 'מתחבר...' : 'כניסה'}
              </button>
            </form>
            <p className="auth-link" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              <button
                onClick={() => { setShowReset(true); setResetEmail(email); setResetStatus(''); }}
                style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif' }}
              >
                שכחתי סיסמה
              </button>
            </p>
            <p className="auth-link" style={{ marginTop: '0.5rem' }}>
              אין לך חשבון? <Link to="/register">קבלת הזמנה</Link>
            </p>
          </>
        ) : (
          <>
            <h2 style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.5rem' }}>
              איפוס סיסמה
            </h2>
            <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem' }}>
              הזינו את כתובת הדוא"ל שלכם. אם החשבון קיים, יישלח קישור איפוס מאובטח.
            </p>
            {resetStatus === 'sent' && (
              <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
                הבקשה התקבלה. בדקו גם את תיקיית הספאם.
              </div>
            )}
            {resetStatus === 'error' && (
              <div className="auth-error">לא ניתן להשלים את הבקשה כרגע. נסו שוב מאוחר יותר.</div>
            )}
            <form onSubmit={handleResetPassword} className="auth-form">
              <div className="form-group">
                <label>דוא"ל</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={event => setResetEmail(event.target.value)}
                  autoComplete="email"
                  required
                  dir="ltr"
                />
              </div>
              <button type="submit" className="auth-btn" disabled={resetLoading}>
                {resetLoading ? 'שולח...' : 'שלחו קישור לאיפוס'}
              </button>
            </form>
            <p className="auth-link" style={{ marginTop: '1rem' }}>
              <button
                onClick={() => setShowReset(false)}
                style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif' }}
              >
                חזרה להתחברות
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
