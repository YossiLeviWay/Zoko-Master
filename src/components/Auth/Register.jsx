import { Link } from 'react-router-dom';
import './Auth.css';

export default function Register() {
  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-header">
          <h1 className="auth-logo">Zoko-Master</h1>
          <p className="auth-subtitle">הצטרפות בהזמנה בלבד</p>
        </div>
        <div className="auth-error" style={{ background: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8' }}>
          הרשמה ציבורית אינה זמינה. מנהל מוסד מורשה יכול לשלוח הזמנה מאובטחת לחשבון חדש.
        </div>
        <p className="auth-link" style={{ marginTop: '1rem' }}>
          <Link to="/login">חזרה להתחברות</Link>
        </p>
      </div>
    </div>
  );
}
