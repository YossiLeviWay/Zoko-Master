import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { acceptStaffInvitation, submitJoinRequest } from '../../services/adminUserService';
import { subscribePublicSchools } from '../../services/firestore/publicSchoolRepository';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import './Auth.css';

export default function Register() {
  const [searchParams] = useSearchParams();
  const invitationValue = searchParams.get('invitation') || '';
  const separator = invitationValue.indexOf('.');
  const invitationId = separator > 0 ? invitationValue.slice(0, separator) : '';
  const token = separator > 0 ? invitationValue.slice(separator + 1) : '';
  const invitationMode = Boolean(invitationId && token);
  const [schools, setSchools] = useState([]);
  const [form, setForm] = useState({ fullName: '', email: '', schoolId: '', message: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => subscribePublicSchools({ db, onData: setSchools, onError: () => setSchools([]) }), []);

  function change(event) {
    setForm(previous => ({ ...previous, [event.target.name]: event.target.value }));
  }

  async function submitJoin(event) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await submitJoinRequest({ schoolId: form.schoolId, fullName: form.fullName, email: form.email, message: form.message });
      setStatus('הבקשה התקבלה ותועבר לבדיקת מנהל המוסד.');
      setForm(previous => ({ ...previous, fullName: '', email: '', message: '' }));
    } catch {
      setError('לא ניתן לשלוח את הבקשה כרגע. בדקו את הפרטים ונסו שוב.');
    } finally {
      setLoading(false);
    }
  }

  async function acceptInvitation(event) {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) {
      setError('הסיסמאות אינן זהות.');
      return;
    }
    setLoading(true);
    try {
      const result = await acceptStaffInvitation({ invitationId, token, fullName: form.fullName, password: form.password });
      if (result.existingAccount) {
        setStatus('ההזמנה התקבלה. התחברו באמצעות הסיסמה הקיימת או השתמשו באיפוס סיסמה.');
      } else {
        await login(result.email, form.password, result.schoolId);
        navigate('/');
      }
    } catch (acceptError) {
      const reason = acceptError?.details?.reason || '';
      setError(reason === 'invitation-expired' ? 'תוקף ההזמנה פג. בקשו ממנהל המוסד לשלוח אותה מחדש.' : 'ההזמנה אינה תקינה, כבר נוצלה או שאינה זמינה עוד.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-container auth-container--wide">
        <div className="auth-header"><h1 className="auth-logo">Zoko-Master</h1><p className="auth-subtitle">{invitationMode ? 'קבלת הזמנה מאובטחת' : 'בקשת הצטרפות למוסד'}</p></div>
        {status && <div className="auth-success" role="status">{status}</div>}
        {error && <div className="auth-error" role="alert">{error}</div>}
        {!status && (invitationMode ? (
          <form className="auth-form" onSubmit={acceptInvitation}>
            <div className="form-group"><label>שם מלא</label><input name="fullName" value={form.fullName} onChange={change} required maxLength={120} autoComplete="name" /></div>
            <div className="form-group"><label>סיסמה חדשה</label><input name="password" type="password" value={form.password} onChange={change} required minLength={12} maxLength={128} autoComplete="new-password" dir="ltr" /><small>לפחות 12 תווים.</small></div>
            <div className="form-group"><label>אימות סיסמה</label><input name="confirmPassword" type="password" value={form.confirmPassword} onChange={change} required minLength={12} maxLength={128} autoComplete="new-password" dir="ltr" /></div>
            <button className="auth-btn" disabled={loading}>{loading ? 'מאמת הזמנה…' : 'קבלת ההזמנה'}</button>
          </form>
        ) : (
          <form className="auth-form" onSubmit={submitJoin}>
            <p className="auth-explanation">הבקשה אינה יוצרת חשבון או הרשאה. מנהל המוסד יבדוק אותה וישלח הזמנה אם תאושר.</p>
            <div className="form-group"><label>שם מלא</label><input name="fullName" value={form.fullName} onChange={change} required maxLength={120} autoComplete="name" /></div>
            <div className="form-group"><label>דוא״ל</label><input name="email" type="email" value={form.email} onChange={change} required maxLength={254} autoComplete="email" dir="ltr" /></div>
            <div className="form-group"><label>מוסד</label><select name="schoolId" value={form.schoolId} onChange={change} required><option value="">בחרו מוסד פעיל</option>{schools.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
            <div className="form-group"><label>הודעה קצרה, אופציונלי</label><textarea name="message" value={form.message} onChange={change} maxLength={1000} rows={3} /></div>
            <button className="auth-btn" disabled={loading}>{loading ? 'שולח…' : 'שליחת בקשה'}</button>
          </form>
        ))}
        <p className="auth-link"><Link to="/login">חזרה להתחברות</Link></p>
      </div>
    </div>
  );
}
