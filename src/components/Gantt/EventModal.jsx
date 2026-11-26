import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import CommunicationLauncherButton from '../Shared/CommunicationLauncherButton';
import { SCHOOL_ROLES } from '../../../functions/src/schoolRoleCatalog.js';
import './Gantt.css';

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function EventModal({
  event,
  saving = false,
  error = '',
  date,
  category,
  categories,
  colors,
  onSave,
  onDelete,
  onClose,
  schoolId: schoolIdProp
}) {
  const { selectedSchool, userData } = useAuth();
  const schoolId = schoolIdProp || selectedSchool || userData?.schoolId;

  const [teams, setTeams] = useState([]);
  const [visibilityMode, setVisibilityMode] = useState(
    event?.visibleTo === 'all' || !event?.visibleTo ? 'all' : 'teams'
  );
  const [selectedTeams, setSelectedTeams] = useState(
    Array.isArray(event?.visibleTo) ? event.visibleTo : []
  );
  const [editableBy, setEditableBy] = useState(
    Array.isArray(event?.editableBy) ? event.editableBy : []
  );

  // "Who is this for?" Optional. Without it the event behaves exactly as before.
  const [audience, setAudience] = useState({
    kind: event?.audience?.kind || '',
    grade: event?.audience?.grade || '',
    subject: event?.audience?.subject || '',
    roleIds: Array.isArray(event?.audience?.roleIds) ? event.audience.roleIds : [],
  });
  const audienceRoles = [{ id: 'homeroom', label: 'מחנכים' }, ...SCHOOL_ROLES.map(role => ({ id: role.id, label: role.label }))];

  const [form, setForm] = useState({
    title: event?.title || '',
    description: event?.description || '',
    time: event?.time || '',
    category: event?.category || category || categories[0],
    certainty: event?.certainty === 'tentative' ? 'tentative' : 'confirmed',
    color: event?.color || colors[0],
    date: event?.date || (date ? dateKey(date) : '')
  });

  // Load teams from Firestore
  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `teams_${schoolId}`), (snap) => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setTeams([]));
    return unsub;
  }, [schoolId]);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function handleTeamToggle(teamId) {
    setSelectedTeams(prev =>
      prev.includes(teamId)
        ? prev.filter(id => id !== teamId)
        : [...prev, teamId]
    );
  }

  function handleEditableToggle(teamId) {
    setEditableBy(prev =>
      prev.includes(teamId)
        ? prev.filter(id => id !== teamId)
        : [...prev, teamId]
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim()) return;
    const visibleTo = visibilityMode === 'all' ? 'all' : selectedTeams;
    const hasAudience = audience.kind || audience.grade || audience.subject.trim() || audience.roleIds.length;
    onSave({
      ...form,
      visibleTo,
      editableBy,
      // null (not undefined) so editing an event can also clear a previous audience.
      audience: hasAudience ? { kind: audience.kind, grade: audience.grade, subject: audience.subject.trim(), roleIds: audience.roleIds } : null
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="calendar-event-heading" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="calendar-event-heading">{event?.id ? 'עריכת אירוע' : 'אירוע חדש'}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <p role="alert" className="calendar-action-error">{error}</p>}
          <div className="form-group">
            <label>כותרת</label>
            <input
              name="title"
              value={form.title}
              onChange={handleChange}
              placeholder="שם האירוע"
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>תיאור</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="פרטים נוספים..."
              rows={3}
            />
          </div>

          <div className="form-group"><label htmlFor="calendar-event-date">תאריך</label><input id="calendar-event-date" name="date" type="date" required value={form.date} onChange={handleChange} onInput={handleChange} dir="ltr"/></div>

          <div className="form-row">
            <div className="form-group">
              <label>שעה</label>
              <input
                name="time"
                type="time"
                value={form.time}
                onChange={handleChange}
                dir="ltr"
              />
            </div>
            <div className="form-group">
              <label htmlFor="event-certainty">מצב</label>
              <select id="event-certainty" name="certainty" value={form.certainty} onChange={handleChange}>
                <option value="confirmed">סגור</option>
                <option value="tentative">לא סגור</option>
              </select>
            </div>
            <div className="form-group">
              <label>קטגוריה</label>
              <select name="category" value={form.category} onChange={handleChange}>
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label>צבע</label>
            <div className="color-picker">
              {colors.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${form.color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setForm(prev => ({ ...prev, color: c }))}
                />
              ))}
            </div>
          </div>

          {/* Visibility selector */}
          <div className="form-group">
            <label>נראות</label>
            <select
              value={visibilityMode}
              onChange={e => setVisibilityMode(e.target.value)}
            >
              <option value="all">כולם</option>
              <option value="teams">צוותים מסוימים</option>
            </select>
          </div>

          {visibilityMode === 'teams' && (
            <div className="form-group">
              <label>בחירת צוותים לנראות</label>
              {teams.length === 0 ? (
                <p style={{ fontSize: '0.8rem', color: '#9b8790' }}>לא נמצאו צוותים</p>
              ) : (
                <div className="team-checkboxes" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {teams.map(team => (
                    <label key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedTeams.includes(team.id)}
                        onChange={() => handleTeamToggle(team.id)}
                      />
                      {team.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Editable by selector */}
          <div className="form-group">
            <label>הרשאת עריכה לצוותים</label>
            {teams.length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: '#9b8790' }}>לא נמצאו צוותים</p>
            ) : (
              <div className="team-checkboxes" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {teams.map(team => (
                  <label key={team.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={editableBy.includes(team.id)}
                      onChange={() => handleEditableToggle(team.id)}
                    />
                    {team.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <details className="event-audience" open={Boolean(event?.audience)}>
            <summary>למי זה רלוונטי? (אופציונלי)</summary>
            <p className="event-audience-hint">מי שלא קשור לאירוע לא יראה אותו בדשבורד. אם לא תבחרו כלום, כולם יראו.</p>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="event-audience-kind">סוג</label>
                <select id="event-audience-kind" value={audience.kind} onChange={e => setAudience(a => ({ ...a, kind: e.target.value }))}>
                  <option value="">אירוע רגיל</option>
                  <option value="exam">מבחן</option>
                  <option value="meeting">פגישה</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="event-audience-grade">שכבה</label>
                <select id="event-audience-grade" value={audience.grade} onChange={e => setAudience(a => ({ ...a, grade: e.target.value }))}>
                  <option value="">כל השכבות</option>
                  {['ט', 'י', 'יא', 'יב'].map(grade => <option key={grade} value={grade}>{grade}׳</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="event-audience-subject">מקצוע</label>
              <input id="event-audience-subject" value={audience.subject} maxLength={60} placeholder="למשל: אנגלית" onChange={e => setAudience(a => ({ ...a, subject: e.target.value }))} />
            </div>
            <div className="form-group">
              <label htmlFor="event-audience-role">הוספת בעלי תפקיד</label>
              <select id="event-audience-role" value="" onChange={e => e.target.value && setAudience(a => ({ ...a, roleIds: [...new Set([...a.roleIds, e.target.value])] }))}>
                <option value="">בחרו תפקיד…</option>
                {audienceRoles.filter(role => !audience.roleIds.includes(role.id)).map(role => <option key={role.id} value={role.id}>{role.label}</option>)}
              </select>
              {audience.roleIds.length > 0 && <div className="event-audience-chips">
                {audience.roleIds.map(id => <button type="button" key={id} onClick={() => setAudience(a => ({ ...a, roleIds: a.roleIds.filter(item => item !== id) }))} aria-label={`הסרת ${audienceRoles.find(role => role.id === id)?.label || id}`}>{audienceRoles.find(role => role.id === id)?.label || id} ✕</button>)}
              </div>}
            </div>
          </details>

          <div className="modal-actions">
            {event?.id && <CommunicationLauncherButton context={{ type: 'event', id: event.id, label: form.title, description: `${form.date}${form.time ? ` ${form.time}` : ''}`, eventId: event.id, participantIds: teams.filter(team => selectedTeams.includes(team.id) || editableBy.includes(team.id)).flatMap(team => team.memberIds || []) }} className="btn btn-secondary">מייל ומעקב</CommunicationLauncherButton>}
            <button disabled={saving} type="submit" className="btn btn-primary">
              {event?.id ? 'עדכון' : 'הוספה'}
            </button>
            {onDelete && (
              <button type="button" className="btn btn-danger" onClick={onDelete}>
                מחיקה
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              ביטול
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
