import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { X } from 'lucide-react';
import { db } from '../../firebase';
import { listSchoolStaff } from '../../services/firestore/classStudentRepository';
import { DUE_FILTERS, LIMIT_OPTIONS, normalizeConfig } from '../../utils/dashboardWidgets';

// Everything a person can change about ONE dashboard widget, in a single small window.
export default function WidgetSettings({ widget, label, schoolId, teams = [], knownCategories = [], knownTags = [], onSave, onClose }) {
  const [config, setConfig] = useState(() => normalizeConfig(widget.config));
  const [staff, setStaff] = useState([]);
  const [categories, setCategories] = useState(knownCategories);
  const set = patch => setConfig(previous => ({ ...previous, ...patch }));
  const isTasks = widget.type === 'my_tasks';
  const isEvents = widget.type === 'events';

  useEffect(() => {
    if (!isTasks || !schoolId) return undefined;
    let cancelled = false;
    listSchoolStaff(db, schoolId).then(list => { if (!cancelled) setStaff(list.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), 'he'))); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isTasks, schoolId]);

  useEffect(() => {
    if (!isEvents || !schoolId) return undefined;
    let cancelled = false;
    getDocs(collection(db, `categories_${schoolId}`)).then(snapshot => {
      const names = snapshot.docs.map(item => item.data().name).filter(Boolean);
      if (!cancelled && names.length) setCategories([...new Set([...names, ...knownCategories])]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isEvents, schoolId, knownCategories]);

  function toggleCategory(name) {
    set({ categories: config.categories.includes(name) ? config.categories.filter(item => item !== name) : [...config.categories, name] });
  }

  return <div className="widget-settings-overlay" onClick={onClose}>
    <form className="widget-settings" role="dialog" aria-modal="true" aria-labelledby="widget-settings-title" onClick={event => event.stopPropagation()}
      onSubmit={event => { event.preventDefault(); onSave(normalizeConfig(config)); }}>
      <header>
        <h2 id="widget-settings-title">התאמת התצוגה: {label}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="סגירה"><X size={16} /></button>
      </header>

      <label htmlFor="ws-title">כותרת (אופציונלי)</label>
      <input id="ws-title" value={config.title} maxLength={60} placeholder={label} onChange={event => set({ title: event.target.value })} />

      <label htmlFor="ws-limit">כמה פריטים להציג</label>
      <select id="ws-limit" value={config.limit} onChange={event => set({ limit: Number(event.target.value) })}>
        {LIMIT_OPTIONS.map(count => <option key={count} value={count}>{count}</option>)}
      </select>

      {isTasks && <>
        <label htmlFor="ws-team">צוות</label>
        <select id="ws-team" value={config.teamId} onChange={event => set({ teamId: event.target.value })}>
          <option value="">כל הצוותים</option>
          {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
        <label htmlFor="ws-staff">איש צוות</label>
        <select id="ws-staff" value={config.staffId} onChange={event => set({ staffId: event.target.value })}>
          <option value="">כולם</option>
          {staff.map(person => <option key={person.id} value={person.id}>{person.fullName || person.name || person.email}</option>)}
        </select>
        <label htmlFor="ws-priority">דחיפות</label>
        <select id="ws-priority" value={config.priority} onChange={event => set({ priority: event.target.value })}>
          <option value="">הכול</option>
          <option value="high">גבוהה</option>
          <option value="medium">בינונית</option>
          <option value="low">נמוכה</option>
        </select>
        <label htmlFor="ws-tag">תיוג</label>
        <select id="ws-tag" value={config.tag} onChange={event => set({ tag: event.target.value })}>
          <option value="">{knownTags.length ? 'הכול' : 'אין תיוגים במשימות שלך'}</option>
          {knownTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <label htmlFor="ws-due">מועד</label>
        <select id="ws-due" value={config.due} onChange={event => set({ due: event.target.value })}>
          <option value={DUE_FILTERS.ALL}>הכול</option>
          <option value={DUE_FILTERS.TODAY}>להיום</option>
          <option value={DUE_FILTERS.WEEK}>השבוע הקרוב</option>
          <option value={DUE_FILTERS.OVERDUE}>באיחור</option>
        </select>
      </>}

      {isEvents && <fieldset>
        <legend>קטגוריות (בלי בחירה: הכול)</legend>
        {categories.length === 0 && <small>לא נמצאו קטגוריות.</small>}
        <div className="widget-settings-chips">
          {categories.map(name => <label key={name} className="widget-settings-chip"><input type="checkbox" checked={config.categories.includes(name)} onChange={() => toggleCategory(name)} /> {name}</label>)}
        </div>
      </fieldset>}

      <footer>
        <button className="btn btn-primary">שמירה</button>
        <button type="button" className="btn btn-secondary" onClick={() => setConfig(normalizeConfig({}))}>איפוס</button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>ביטול</button>
      </footer>
    </form>
  </div>;
}
