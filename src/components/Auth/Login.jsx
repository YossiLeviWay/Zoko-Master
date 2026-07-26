import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { requestPublicPasswordReset } from '../../services/adminUserService';
import { subscribePublicSchools } from '../../services/firestore/publicSchoolRepository';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [loginSchools, setLoginSchools] = useState([]);
  const [loginStep, setLoginStep] = useState('credentials');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSchools, setResetSchools] = useState([]);
  const [resetStatus, setResetStatus] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const {
    login,
    logout,
    completeSchoolLogin,
    currentUser,
    selectedSchool,
    availableSchools,
    isGlobalAdmin,
    isPlatformAdmin,
  } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!showReset) return undefined;
    return subscribePublicSchools({ db, onData: setResetSchools, onError: () => setResetSchools([]) });
  }, [showReset]);

  useEffect(() => {
    if (currentUser && !selectedSchool && !isGlobalAdmin() && !isPlatformAdmin()) {
      setLoginSchools(availableSchools);
      setLoginStep('school');
    }
  }, [availableSchools, currentUser, isGlobalAdmin, isPlatformAdmin, selectedSchool]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (result.requiresSchoolSelection) {
        setLoginSchools(result.schools);
        setSchoolId('');
        setLoginStep('school');
      } else {
        navigate('/');
      }
    } catch (loginError) {
      setError(loginError?.code === 'school-membership-required'
        ? 'החשבון אינו משויך למוסד פעיל.'
        : String(loginError?.code || '').includes('unauthenticated')
          ? 'אימות האפליקציה נכשל. רעננו את הדף ונסו שוב.'
          : 'פרטי ההתחברות שגויים או שהחשבון אינו פעיל.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSchoolSelection(event) {
    event.preventDefault();
    if (!schoolId) return;
    setError('');
    setLoading(true);
    try {
      await completeSchoolLogin(schoolId);
      navigate('/');
    } catch {
      setError('לא ניתן לבחור את המוסד. ודאו שהשיוך עדיין פעיל.');
    } finally {
      setLoading(false);
    }
  }

  async function restartLogin() {
    await logout();
    setSchoolId('');
    setLoginSchools([]);
    setLoginStep('credentials');
    setError('');
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    if (!resetEmail.trim()) return;
    setResetLoading(true);
    setResetStatus('');
    try {
      await requestPublicPasswordReset({ schoolId, email: resetEmail.trim() });
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
            {loginStep === 'credentials' ? <form onSubmit={handleSubmit} className="auth-form">
              <fieldset className="auth-step">
                <legend><span>1</span> פרטי התחברות</legend>
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
              </fieldset>
              <button type="submit" className="auth-btn" disabled={loading}>
                {loading ? 'מאמת פרטים...' : 'המשך'}
              </button>
              <p className="form-hint" style={{ textAlign: 'center', margin: 0 }}>
                לאחר האימות יוצגו רק המוסדות המשויכים לחשבון. מנהל מערכת מורשה יופנה ישירות לממשק הניהול.
              </p>
            </form> : <form onSubmit={handleSchoolSelection} className="auth-form">
              <fieldset className="auth-step">
                <legend><span>2</span> בחירת מוסד משויך</legend>
                <label className="form-group">מוסד
                  <select value={schoolId} onChange={event => setSchoolId(event.target.value)} required>
                    <option value="">בחרו מוסד</option>
                    {loginSchools.map(item => <option key={item.id} value={item.id}>{item.name}{item.code ? ` · ${item.code}` : ''}</option>)}
                  </select>
                  <span className="form-hint">מוצגים רק מוסדות שאליהם החשבון משויך.</span>
                </label>
              </fieldset>
              <button type="submit" className="auth-btn" disabled={loading || !schoolId}>
                {loading ? 'נכנס למוסד...' : 'כניסה למערכת'}
              </button>
              <p className="auth-link" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                <button type="button" onClick={restartLogin} style={{ background: 'none', border: 'none', color: '#870335', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif' }}>
                  חזרה והתחברות בחשבון אחר
                </button>
              </p>
            </form>}
            <p className="auth-link" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              <button
                onClick={() => { setShowReset(true); setResetEmail(email); setResetStatus(''); }}
                style={{ background: 'none', border: 'none', color: '#870335', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif' }}
              >
                שכחתי סיסמה
              </button>
            </p>
            <p className="auth-link" style={{ marginTop: '0.5rem' }}>
              אין לך חשבון? <Link to="/register">בקשת הצטרפות</Link>
            </p>
          </>
        ) : (
          <>
            <h2 style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, color: '#1e000c', margin: '0 0 0.5rem' }}>
              איפוס סיסמה
            </h2>
            <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#765968', margin: '0 0 1.25rem' }}>
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
              <div className="form-group"><label>מוסד</label><select value={schoolId} onChange={event => setSchoolId(event.target.value)} required><option value="">בחרו מוסד</option>{resetSchools.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
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
                style={{ background: 'none', border: 'none', color: '#870335', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'Inter, sans-serif' }}
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
