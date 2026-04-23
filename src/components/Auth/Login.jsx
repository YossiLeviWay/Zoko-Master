import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../../firebase';
import './Auth.css';

export default function Login() {
  const [mode, setMode] = useState('user');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetStatus, setResetStatus] = useState(''); // 'sent' | 'error'
  const [resetLoading, setResetLoading] = useState(false);
  const { login, loginAsAdmin } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'admin') {
        await loginAsAdmin(adminPassword);
      } else {
        await login(email, password);
      }
      navigate('/');
    } catch (err) {
      setError(mode === 'admin' ? 'סיסמת אדמין שגויה' : 'שם משתמש או סיסמה שגויים');
    }
    setLoading(false);
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    setResetStatus('');
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setResetStatus('sent');
    } catch (err) {
      setResetStatus('error');
    }
    setResetLoading(false);
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
            <div className="auth-tabs">
              <button
                className={`auth-tab ${mode === 'user' ? 'active' : ''}`}
                onClick={() => setMode('user')}
              >
                כניסת משתמש
              </button>
              <button
                className={`auth-tab ${mode === 'admin' ? 'active' : ''}`}
                onClick={() => setMode('admin')}
              >
                כניסת אדמין
              </button>
            </div>

            {error && <div className="auth-error">{error}</div>}

            <form onSubmit={handleSubmit} className="auth-form">
              {mode === 'user' ? (
                <>
                  <div className="form-group">
                    <label>דוא"ל</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="הזינו כתובת דוא״ל"
                      required
                      dir="ltr"
                    />
                  </div>
                  <div className="form-group">
                    <label>סיסמה</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="הזינו סיסמה"
                      required
                      dir="ltr"
                    />
                  </div>
                </>
              ) : (
                <div className="form-group">
                  <label>סיסמת מנהל מערכת</label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="הזינו סיסמת אדמין"
                    required
                    dir="ltr"
                  />
                </div>
              )}

              <button type="submit" className="auth-btn" disabled={loading}>
                {loading ? 'מתחבר...' : 'כניסה'}
              </button>
            </form>

            {mode === 'user' && (
              <>
                <p className="auth-link" style={{ marginTop: '0.75rem', marginBottom: '0' }}>
                  <button
                    onClick={() => { setShowReset(true); setResetEmail(email); setResetStatus(''); }}
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif' }}
                  >
                    שכחתי סיסמה
                  </button>
                </p>
                <p className="auth-link" style={{ marginTop: '0.5rem' }}>
                  אין לך חשבון? <Link to="/register">הרשמה</Link>
                </p>
              </>
            )}
          </>
        ) : (
          <>
            <h2 style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '0 0 0.5rem' }}>
              איפוס סיסמה
            </h2>
            <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#64748b', margin: '0 0 1.25rem' }}>
              הזינו את כתובת הדוא"ל שלכם ונשלח לכם קישור לאיפוס הסיסמה.
            </p>

            {resetStatus === 'sent' && (
              <div style={{ background: '#f0fdf4', color: '#16a34a', padding: '0.75rem 1rem', borderRadius: 8, fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
                קישור לאיפוס סיסמה נשלח לדוא"ל שלכם.
                <br />
                <span style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.35rem', display: 'block' }}>
                  שימו לב: לעיתים המייל נכנס לתיבת הספאם (דואר זבל). בדקו גם שם.
                </span>
              </div>
            )}
            {resetStatus === 'error' && (
              <div className="auth-error">
                לא ניתן לשלוח מייל איפוס. ודאו שכתובת הדוא"ל נכונה ונסו שוב.
              </div>
            )}

            <form onSubmit={handleResetPassword} className="auth-form">
              <div className="form-group">
                <label>דוא"ל</label>
                <input
                  type="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="הזינו כתובת דוא״ל"
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
