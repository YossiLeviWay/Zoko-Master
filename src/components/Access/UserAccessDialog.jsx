import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import { ACCESS_DEFINITIONS } from '../../../functions/src/accessCatalog.js';
import CapabilityEditor from './CapabilityEditor';
import AccessProfileEditor from './AccessProfileEditor';
import './SimpleAccess.css';

export default function UserAccessDialog({ user, schoolId, onClose, onSaved, initialDomain = 'work', initiallyCustomize = false }) {
  const [configuration, setConfiguration] = useState(null);
  const [legacyPermissions, setLegacyPermissions] = useState({});
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    httpsCallable(functions, 'getAccessConfiguration')({ schoolId, userId: user.id }).then(({ data }) => {
      if (active) { setConfiguration(data); setProfile(data.profile); setLegacyPermissions(data.legacyPermissions); }
    }).catch(() => { if (active) setError('לא ניתן לטעון את הגישה כרגע. סגרו את החלון ונסו שוב.'); });
    return () => { active = false; };
  }, [schoolId, user.id]);
  useEffect(() => {
    const escape = event => { if (event.key === 'Escape' && !saving) onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose, saving]);
  async function save() {
    setSaving(true); setError('');
    try {
      const legacyPermissionsPatch = Object.fromEntries(Object.entries(legacyPermissions).filter(([key, enabled]) => !key.startsWith('forum.') && enabled !== configuration.legacyPermissions[key]));
      await httpsCallable(functions, 'saveAccessConfiguration')({ schoolId, userId: user.id, profile, revision: configuration.revision, ...(Object.keys(legacyPermissionsPatch).length ? { legacyPermissionsPatch, legacyBaseline: configuration.legacyPermissions } : {}) });
      onSaved?.(); onClose();
    } catch (caught) { setError(caught.code === 'functions/aborted' ? 'הגישה השתנתה בחלון אחר. פתחו מחדש כדי לראות את הגרסה העדכנית.' : 'הגישה לא נשמרה. בדקו את החיבור ונסו שוב.'); }
    finally { setSaving(false); }
  }
  const legacyDirty = configuration && JSON.stringify(legacyPermissions) !== JSON.stringify(configuration.legacyPermissions);
  const dirty = configuration && (legacyDirty || JSON.stringify(profile) !== JSON.stringify(configuration.profile));
  const otherGrants = (configuration?.grants || []).filter(item => item.source !== 'access-profile');
  return <div className="modal-overlay access-overlay"><section className="simple-access-dialog" role="dialog" aria-modal="true" aria-label={`גישה — ${user.fullName || user.email}`} dir="rtl"><header><h3>גישה — {user.fullName || user.email}</h3><button type="button" aria-label="סגירה" disabled={saving} onClick={onClose}>×</button></header><div className="access-dialog-body">
    {error && <p role="alert" className="access-error">{error}</p>}
    {!configuration && !error && <p role="status">טוען את הגישה הקיימת…</p>}
    {configuration?.protected ? <p>מנהל המוסד שומר על גישה מלאה. תפקיד הניהול מוגן ולא משתנה בחלון זה.</p> : profile && <AccessProfileEditor value={profile} original={configuration.profile} onChange={setProfile} classes={configuration.classes} roles={configuration.roles} userId={user.id} initialDomain={initialDomain} initiallyCustomize={initiallyCustomize} disabled={saving} />}
    {otherGrants.length > 0 && <details className="access-existing"><summary>גישה קיימת מתפקידים והגדרות נוספות</summary><p>גישה זו נשמרת גם אם מסירים פעולה מההגדרה האישית.</p><ul>{otherGrants.filter(grant => ACCESS_DEFINITIONS.some(item => item.key === grant.capability)).map((grant, index) => <li key={index}>{ACCESS_DEFINITIONS.find(item => item.key === grant.capability)?.label} <small> · {grant.scope?.type === 'school' ? 'המוסד' : 'גישה מוגבלת'} · {grant.source?.startsWith('role:') ? configuration.roles.find(item => `role:${item.id}` === grant.source)?.name || 'תפקיד' : 'הגדרה קיימת'}</small></li>)}</ul></details>}
    {configuration && !configuration.protected && Object.keys(configuration.legacyPermissions).length > 0 && <details><summary>התאמות אישיות קודמות — מתקדם</summary><p className="access-hint">{configuration.schoolCount > 1 ? 'הגדרות ותיקות אלה משותפות לכל המוסדות של המשתמש. שינוי כאן יחול בכולם; התאמת הגישה החדשה למעלה חלה רק במוסד הנבחר.' : 'הגדרות אישיות שנשמרו בעבר. ניתן לשנות אותן בלי לשנות את התפקידים או השיתופים.'}</p><CapabilityEditor value={legacyPermissions} onChange={setLegacyPermissions} disabled={saving} />{legacyDirty && <p role="status">גם ההתאמות האישיות הקודמות השתנו ויישמרו בלחיצה על שמירת גישה.</p>}</details>}
    {configuration?.sharedFiles?.length > 0 && <details><summary>תכנים ששותפו בנפרד ({configuration.sharedFiles.length})</summary><p>שיתופים אלה ממשיכים לתת גישה גם אחרי הסרת הרשאה מהתפקיד.</p><ul>{configuration.sharedFiles.map(file => <li key={file.id}>{file.name || 'מסמך'} — צפייה{file.actions.includes('create') ? ', הוספה' : ''}{file.actions.includes('edit') ? ', עריכה' : ''}</li>)}</ul></details>}
    <p className="access-hint">מסמכים ומשימות עשויים להיות משותפים בנפרד. פירוט המשתתפים נמצא בכפתור השיתוף של התוכן.</p>
  </div><footer><button type="button" className="btn btn-primary" disabled={!dirty || saving || configuration?.protected} onClick={save}>{saving ? 'שומר…' : 'שמירת גישה'}</button><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>ביטול</button></footer></section></div>;
}
