import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import './Auth.css';

const JOB_TITLES = ['מורה', 'מנהלת', 'סגנית מנהלת', 'יועצת', 'מטפלת', 'רכזת', 'מזכירה', 'פרילנסר', 'אחר'];

export default function Register() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    jobTitle: '',
    schoolId: '',
    phone: ''
  });
  const [schools, setSchools] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchSchools() {
      try {
        const snap = await getDocs(collection(db, 'schools'));
        setSchools(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch {
        setSchools([]);
      }
    }
    fetchSchools();
  }, []);

  function handleChange(e) {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      return setError('הסיסמאות אינן תואמות');
    }
    if (formData.password.length < 6) {
      return setError('הסיסמה חייבת להכיל לפחות 6 תווים');
    }

    setLoading(true);
    try {
      await register(formData.email, formData.password, {
        fullName: formData.fullName,
        jobTitle: formData.jobTitle,
        schoolId: formData.schoolId,
        phone: formData.phone
      });
      navigate('/');
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setError('כתובת הדוא"ל כבר רשומה במערכת');
      } else {
        setError('שגיאה ברישום. נסו שנית.');
      }
    }
    setLoading(false);
  }

  return (
    <div className="auth-page">
      <div className="auth-container auth-container--wide">
        <div className="auth-header">
          <h1 className="auth-logo">Zoko-Master</h1>
          <p className="auth-subtitle">הרשמה למערכת</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-row">
            <div className="form-group">
              <label>שם מלא</label>
              <input
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="שם פרטי ומשפחה"
                required
              />
            </div>
            <div className="form-group">
              <label>טלפון</label>
              <input
                name="phone"
                type="tel"
                value={formData.phone}
                onChange={handleChange}
                placeholder="050-0000000"
                dir="ltr"
              />
            </div>
          </div>

          <div className="form-group">
            <label>דוא"ל</label>
            <input
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="example@school.co.il"
              required
              dir="ltr"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>סיסמה</label>
              <input
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="לפחות 6 תווים"
                required
                dir="ltr"
              />
            </div>
            <div className="form-group">
              <label>אימות סיסמה</label>
              <input
                name="confirmPassword"
                type="password"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="הקלידו שוב את הסיסמה"
                required
                dir="ltr"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>תפקיד</label>
              <select name="jobTitle" value={formData.jobTitle} onChange={handleChange} required>
                <option value="">בחרו תפקיד</option>
                {JOB_TITLES.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>בית ספר</label>
              <select name="schoolId" value={formData.schoolId} onChange={handleChange} required>
                <option value="">בחרו בית ספר</option>
                {schools.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? 'נרשם...' : 'הרשמה'}
          </button>
        </form>

        <p className="auth-link">
          יש לך כבר חשבון? <Link to="/login">התחברות</Link>
        </p>
      </div>
    </div>
  );
}
