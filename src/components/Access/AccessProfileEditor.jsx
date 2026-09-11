import { useState } from 'react';
import { ACCESS_PRESETS, ACCESS_DEFINITIONS, presetProfile, profileChanges } from '../../../functions/src/accessCatalog.js';
import CapabilityEditor from './CapabilityEditor';

export default function AccessProfileEditor({ value, onChange, classes = [], roles = [], userId, original, initialDomain = 'work', initiallyCustomize = false, disabled = false }) {
  const [scope, setScope] = useState('school');
  const [roleSearch, setRoleSearch] = useState('');
  const customClass = scope.startsWith('class:') ? scope.slice(6) : null;
  const permissions = customClass ? value.classes[customClass] || {} : value[scope] || {};
  const changes = profileChanges(original, value);
  const ownClasses = classes.filter(item => item.teacherId === userId);
  function choosePreset(preset) {
    onChange(presetProfile(preset.id));
    setScope(preset.id === 'homeroom' ? 'homeroom' : 'school');
  }
  function changePermissions(next) {
    onChange(customClass ? { ...value, presetId: 'custom', classes: { ...value.classes, [customClass]: next } } : { ...value, presetId: 'custom', [scope]: next });
  }
  function chooseRole(role) {
    const permitted = Object.fromEntries(Object.entries(role.permissions).filter(([key]) => !key.startsWith('forum.')));
    const profile = presetProfile('teacher');
    profile.presetId = 'custom';
    if (role.accessScope?.type === 'classes') (role.accessScope.classIds || []).forEach(id => { profile.classes[id] = permitted; });
    else profile.school = { ...profile.school, ...permitted };
    onChange(profile);
  }
  const labelChange = entry => {
    const colon = entry.indexOf(':');
    const key = entry.slice(colon + 1);
    const definition = ACCESS_DEFINITIONS.find(item => item.key === key);
    if (!definition) return null; // aliases are represented once
    const scopeKey = entry.slice(0, colon);
    const name = ({ school: 'המוסד', assigned: 'כיתות משויכות', homeroom: 'כיתות החינוך' })[scopeKey] || classes.find(item => item.id === scopeKey)?.name || 'כיתה';
    return `${definition.label} — ${name}`;
  };
  return <div className="access-profile-editor">
    <div className="access-preset-grid" role="group" aria-label="בחירת תפקיד">{ACCESS_PRESETS.map(preset => <button type="button" disabled={disabled} key={preset.id} aria-pressed={value.presetId === preset.id} className={value.presetId === preset.id ? 'selected' : ''} onClick={() => choosePreset(preset)}><strong>{preset.label}</strong><span>{preset.description}</span></button>)}</div>
    {value.presetId === 'custom' && <span className="access-badge">מותאם אישית</span>}
    <details><summary>תפקיד נוסף</summary><input aria-label="חיפוש תפקיד" placeholder="חיפוש תפקיד…" value={roleSearch} onChange={event => setRoleSearch(event.target.value)} /><p className="access-hint">התפקיד משמש תבנית אישית; השינוי לא משנה את התפקיד של אנשים אחרים.</p>{roles.filter(role => role.name?.includes(roleSearch)).map(role => <button type="button" disabled={disabled} className="access-role-option" key={role.id} onClick={() => chooseRole(role)}>{role.name}</button>)}</details>
    <div className="access-summary"><strong>{ACCESS_PRESETS.find(item => item.id === value.presetId)?.label || 'גישה מותאמת'}</strong><p>{value.presetId === 'homeroom' ? `כיתות החינוך: ${ownClasses.map(item => item.name).join(', ') || 'אין שיוך מאומת — לא ניתנת גישה לכיתה'}. מסמכים לפי השיתוף שלהם.` : value.presetId === 'leadership' ? 'עבודה שוטפת. הוסיפו רק את תחומי האחריות והתכנים הנדרשים.' : value.presetId === 'custom' ? 'גישה אישית לפי התחומים והכיתות שנבחרו. הרשאות קודמות ושיתופים מפורטים בהמשך.' : 'עבודה שוטפת לפי הבחירה; תכנים נוספים לפי השיתופים הקיימים.'}</p></div>
    <details open={initiallyCustomize || undefined}><summary>התאמת הגישה</summary><label>היכן חלה ההתאמה<select value={scope} disabled={disabled} onChange={event => setScope(event.target.value)}><option value="school">בכל המוסד</option><option value="homeroom">בכיתות החינוך שלי — לפי השיוך העדכני</option><option value="assigned">בכיתות שבהן אני משויך — לפי השיוך העדכני</option>{classes.map(item => <option value={`class:${item.id}`} key={item.id}>{item.name}</option>)}</select></label><CapabilityEditor key={scope} classScope={scope !== 'school'} value={permissions} onChange={changePermissions} initialDomain={initialDomain} disabled={disabled} /></details>
    {(changes.added.length > 0 || changes.removed.length > 0) && <div className="access-change-summary" aria-live="polite"><strong>השינוי שישמר</strong>{[[changes.added, 'תתווסף גישה'], [changes.removed, 'תוסר מההגדרה האישית']].map(([entries, label]) => { const labels = entries.map(labelChange).filter(Boolean); return labels.length > 0 && <details key={label}><summary>{label} · {labels.length} פעולות</summary><ul>{labels.map(item => <li key={item}>{item}</li>)}</ul></details>; })}<p className="access-hint">הרשאות מתפקידים ומשיתופים אחרים ממשיכות לחול.</p></div>}
  </div>;
}
