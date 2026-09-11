import { useState } from 'react';
import { ACCESS_DEFINITIONS, ACCESS_DOMAINS, permissionPatch } from '../../../functions/src/accessCatalog.js';
import './SimpleAccess.css';

export default function CapabilityEditor({ value, onChange, initialDomain = 'work', disabled = false, classScope = false }) {
  const [domain, setDomain] = useState(classScope ? 'students' : initialDomain);
  const [search, setSearch] = useState('');
  const definitions = ACCESS_DEFINITIONS.filter(item => !item.separateApproval && item.domain === domain);
  const toggle = item => {
    const enabled = !item.keys.some(key => value[key] === true);
    const patch = permissionPatch(item.key, enabled);
    if (enabled && ['create', 'edit'].includes(item.action)) {
      const view = definitions.find(def => def.group === item.group && def.action === 'view');
      if (view) Object.assign(patch, permissionPatch(view.key, true));
    }
    if (!enabled && item.action === 'view') definitions.filter(def => def.group === item.group && ['create', 'edit'].includes(def.action)).forEach(def => Object.assign(patch, permissionPatch(def.key, false)));
    onChange({ ...value, ...patch });
  };
  const groups = [...new Set(definitions.filter(item => item.action !== 'advanced').map(item => item.group))];
  return <div className="simple-capabilities">
    <label>תחום להתאמה<select value={domain} onChange={event => setDomain(event.target.value)}>{ACCESS_DOMAINS.filter(item => !classScope || item.id === 'students').map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <p className="access-hint">בחירת תחום מציגה אפשרויות בלבד. הוספה ועריכה נבחרות בנפרד; הן אינן כוללות מחיקה או שיתוף.</p>
    {groups.map(group => <fieldset key={group}><legend>{group}</legend><div className="access-action-row">{definitions.filter(item => item.group === group && item.action !== 'advanced').map(item => <label key={item.key}><input type="checkbox" disabled={disabled} checked={item.keys.some(key => value[key] === true)} onChange={() => toggle(item)} />{({ view: 'צפייה', create: 'הוספה', edit: 'עריכה' })[item.action]}</label>)}</div></fieldset>)}
    <details><summary>אפשרויות מתקדמות</summary><input aria-label="חיפוש הרשאה" placeholder="חיפוש פעולה…" value={search} onChange={event => setSearch(event.target.value)} />{definitions.filter(item => item.action === 'advanced' && `${item.label} ${item.group}`.includes(search)).map(item => <label className="access-check" key={item.key}><input type="checkbox" disabled={disabled} checked={item.keys.some(key => value[key] === true)} onChange={() => toggle(item)} /><span>{item.label}<small>{item.group}</small></span></label>)}</details>
  </div>;
}
