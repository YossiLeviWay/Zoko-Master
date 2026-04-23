import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import Header from '../Layout/Header';
import { Save, User, Check } from 'lucide-react';
import { AVATAR_OPTIONS, AVATAR_ICON_PATHS } from '../../data/avatars';
import '../Gantt/Gantt.css';
import './Settings.css';

export default function Settings() {
  const { userData, currentUser, fetchUserData } = useAuth();
  const [form, setForm] = useState({
    fullName: userData?.fullName || '',
    phone: userData?.phone || '',
    jobTitle: userData?.jobTitle || ''
  });
  const [selectedAvatar, setSelectedAvatar] = useState(userData?.avatar || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setSaved(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!currentUser) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        fullName: form.fullName,
        phone: form.phone,
        jobTitle: form.jobTitle,
        avatar: selectedAvatar
      });
      await fetchUserData(currentUser.uid);
      setSaved(true);
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message);
    }
    setSaving(false);
  }

  const currentAvatarOption = AVATAR_OPTIONS.find(a => a.id === selectedAvatar);

  return (
    <div className="page">
      <Header title="הגדרות" />
      <div className="page-content">
        <div className="settings-container">
          <div className="settings-card">
            <div className="settings-avatar-section">
              <div
                className="settings-avatar settings-avatar--large"
                style={currentAvatarOption ? {
                  background: currentAvatarOption.bg,
                  color: currentAvatarOption.textColor
                } : undefined}
              >
                {userData?.fullName?.charAt(0) || <User size={28} />}
              </div>
              <div className="settings-user-info">
                <h3>{userData?.fullName}</h3>
                <p>{userData?.email}</p>
                <span className={`role-badge role-${userData?.role}`}>{
                  userData?.role === 'global_admin' ? 'מנהל על' :
                  userData?.role === 'principal' ? 'מנהל מוסד' :
                  userData?.role === 'editor' ? 'עורך' : 'צופה'
                }</span>
              </div>
            </div>

            <div className="avatar-picker-section">
              <label className="avatar-picker-label">בחירת אוואטר</label>
              <div className="avatar-grid">
                {AVATAR_OPTIONS.map(avatar => (
                  <button
                    key={avatar.id}
                    type="button"
                    className={`avatar-option ${selectedAvatar === avatar.id ? 'avatar-option--selected' : ''}`}
                    style={{ background: avatar.bg, color: avatar.textColor }}
                    onClick={() => { setSelectedAvatar(avatar.id); setSaved(false); }}
                    title={avatar.name}
                  >
                    {avatar.icon && AVATAR_ICON_PATHS[avatar.icon] ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                        <path d={AVATAR_ICON_PATHS[avatar.icon]} />
                      </svg>
                    ) : (
                      userData?.fullName?.charAt(0) || '?'
                    )}
                    {selectedAvatar === avatar.id && (
                      <div className="avatar-check">
                        <Check size={10} />
                      </div>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  className={`avatar-option avatar-option--none ${!selectedAvatar ? 'avatar-option--selected' : ''}`}
                  onClick={() => { setSelectedAvatar(''); setSaved(false); }}
                  title="ברירת מחדל"
                >
                  <User size={16} />
                  {!selectedAvatar && (
                    <div className="avatar-check">
                      <Check size={10} />
                    </div>
                  )}
                </button>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="settings-form">
              <div className="form-group">
                <label>שם מלא</label>
                <input
                  name="fullName"
                  value={form.fullName}
                  onChange={handleChange}
                  placeholder="שם פרטי ומשפחה"
                />
              </div>
              <div className="form-group">
                <label>תפקיד</label>
                <input
                  name="jobTitle"
                  value={form.jobTitle}
                  onChange={handleChange}
                  placeholder="תפקיד"
                />
              </div>
              <div className="form-group">
                <label>טלפון</label>
                <input
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="050-0000000"
                  dir="ltr"
                />
              </div>
              <div className="form-group">
                <label>דוא"ל</label>
                <input value={userData?.email || ''} disabled dir="ltr" />
              </div>

              <button type="submit" className="btn btn-primary settings-save" disabled={saving}>
                <Save size={16} />
                {saving ? 'שומר...' : saved ? 'נשמר!' : 'שמירת שינויים'}
              </button>
            </form>
          </div>

          <div className="settings-card">
            <h3 className="settings-card-title">פרטי המוסד</h3>
            <div className="settings-info-row">
              <span className="settings-label">בית ספר</span>
              <span className="settings-value">{userData?.schoolId || 'לא משויך'}</span>
            </div>
            <div className="settings-info-row">
              <span className="settings-label">הרשאה</span>
              <span className="settings-value">{
                userData?.role === 'global_admin' ? 'מנהל על - גישה לכל המערכת' :
                userData?.role === 'principal' ? 'מנהל מוסד - שליטה מלאה בבית הספר' :
                userData?.role === 'editor' ? 'עורך - יכולת עריכה' : 'צופה - צפייה בלבד'
              }</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
