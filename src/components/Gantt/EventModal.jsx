import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { db } from '../../firebase';
import { collection, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import './Gantt.css';

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function EventModal({
  event,
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

  const [form, setForm] = useState({
    title: event?.title || '',
    description: event?.description || '',
    time: event?.time || '',
    category: event?.category || category || categories[0],
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
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
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
    onSave({
      ...form,
      visibleTo,
      editableBy
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{event ? 'עריכת אירוע' : 'אירוע חדש'}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
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
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>לא נמצאו צוותים</p>
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
              <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>לא נמצאו צוותים</p>
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

          <div className="modal-actions">
            <button type="submit" className="btn btn-primary">
              {event ? 'עדכון' : 'הוספה'}
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
