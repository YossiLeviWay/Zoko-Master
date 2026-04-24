import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import {
  collection, query, where, getDocs, doc, setDoc, getDoc
} from 'firebase/firestore';
import {
  X, Save, Users, UserPlus, UserMinus, Search, Shield
} from 'lucide-react';

export default function ClassPermissionsManager({ schoolId, classes, onClose }) {
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [classPerms, setClassPerms] = useState({}); // { className: { teacherIds: [], teamIds: [] } }
  const [selectedClass, setSelectedClass] = useState(classes[0] || '');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!schoolId) return;
    async function load() {
      setLoading(true);
      try {
        // Load staff
        const results = [];
        const seen = new Set();
        const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
        const snap1 = await getDocs(q1);
        snap1.docs.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); } });
        const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
        const snap2 = await getDocs(q2);
        snap2.docs.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); } });
        setStaff(results.filter(u => u.role !== 'global_admin'));

        // Load teams
        const teamSnap = await getDocs(collection(db, `teams_${schoolId}`));
        setTeams(teamSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Load existing class permissions
        const permDoc = await getDoc(doc(db, `settings_${schoolId}`, 'class_permissions'));
        if (permDoc.exists()) {
          setClassPerms(permDoc.data().classes || {});
        } else {
          // Initialize all classes with empty arrays
          const initial = {};
          classes.forEach(c => { initial[c] = { teacherIds: [], teamIds: [] }; });
          setClassPerms(initial);
        }
      } catch (err) {
        console.error('Error loading class permissions:', err);
      }
      setLoading(false);
    }
    load();
  }, [schoolId]);

  function getPermsForClass(className) {
    return classPerms[className] || { teacherIds: [], teamIds: [] };
  }

  function toggleTeacher(uid) {
    setClassPerms(prev => {
      const perms = getPermsForClass(selectedClass);
      const ids = perms.teacherIds || [];
      const updated = ids.includes(uid) ? ids.filter(id => id !== uid) : [...ids, uid];
      return { ...prev, [selectedClass]: { ...perms, teacherIds: updated } };
    });
    setSaved(false);
  }

  function toggleTeam(teamId) {
    setClassPerms(prev => {
      const perms = getPermsForClass(selectedClass);
      const ids = perms.teamIds || [];
      const updated = ids.includes(teamId) ? ids.filter(id => id !== teamId) : [...ids, teamId];
      return { ...prev, [selectedClass]: { ...perms, teamIds: updated } };
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    try {
      await setDoc(
        doc(db, `settings_${schoolId}`, 'class_permissions'),
        { classes: classPerms },
        { merge: true }
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message);
    }
    setSaving(false);
  }

  const selectedPerms = getPermsForClass(selectedClass);
  const assignedTeacherIds = selectedPerms.teacherIds || [];
  const assignedTeamIds = selectedPerms.teamIds || [];

  const filteredStaff = staff.filter(u => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (u.fullName || '').toLowerCase().includes(q) ||
           (u.jobTitle || '').toLowerCase().includes(q);
  });

  const assignedStaff = filteredStaff.filter(u => assignedTeacherIds.includes(u.id));
  const availableStaff = filteredStaff.filter(u => !assignedTeacherIds.includes(u.id));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content modal-content--wide"
        style={{ maxWidth: 700 }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>
            <Shield size={18} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.4rem' }} />
            הרשאות גישה לכיתות
          </h3>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>טוען...</div>
        ) : classes.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
            אין כיתות רשומות — הוסף תלמידים עם שיוך כיתה קודם
          </div>
        ) : (
          <div className="modal-form" style={{ padding: '1rem 1.5rem' }}>
            <p style={{ fontSize: '0.82rem', color: '#64748b', marginBottom: '1rem' }}>
              ניהול מי מורשה לצפות בתלמידי כל כיתה. מנהל מוסד רואה תמיד את כל הכיתות.
              מחנכים ומורים ישויכים לכיתות ספציפיות.
            </p>

            <div style={{ display: 'flex', gap: '1rem', height: 400 }}>
              {/* Class list (left panel) */}
              <div className="class-perm-class-list">
                <div className="class-perm-list-title">כיתות</div>
                {classes.map(cls => {
                  const perms = getPermsForClass(cls);
                  const count = (perms.teacherIds?.length || 0) + (perms.teamIds?.length || 0);
                  return (
                    <div
                      key={cls}
                      className={`class-perm-class-item ${selectedClass === cls ? 'class-perm-class-item--active' : ''}`}
                      onClick={() => { setSelectedClass(cls); setSearchQuery(''); }}
                    >
                      <span>{cls}</span>
                      {count > 0 && (
                        <span className="class-perm-class-count">{count}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Permission editor (right panel) */}
              <div className="class-perm-editor">
                <div className="class-perm-editor-title">
                  גישה לכיתה: <strong>{selectedClass}</strong>
                </div>

                {/* Search */}
                <div className="search-bar" style={{ marginBottom: '0.75rem' }}>
                  <Search size={14} />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="חיפוש מורה..."
                  />
                </div>

                {/* Teams */}
                {teams.length > 0 && (
                  <div style={{ marginBottom: '0.75rem' }}>
                    <div className="class-perm-section-title">צוותים</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {teams.map(team => {
                        const assigned = assignedTeamIds.includes(team.id);
                        return (
                          <button
                            key={team.id}
                            className={`class-perm-team-chip ${assigned ? 'class-perm-team-chip--active' : ''}`}
                            onClick={() => toggleTeam(team.id)}
                          >
                            <Users size={12} />
                            {team.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Assigned teachers */}
                {assignedStaff.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <div className="class-perm-section-title">מורים משויכים ({assignedStaff.length})</div>
                    <div className="class-perm-staff-list">
                      {assignedStaff.map(u => (
                        <div key={u.id} className="class-perm-staff-item class-perm-staff-item--assigned">
                          <div className="td-avatar" style={{ width: 26, height: 26, fontSize: '0.72rem' }}>
                            {u.fullName?.charAt(0) || '?'}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.83rem', fontWeight: 600 }}>{u.fullName}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{u.jobTitle || u.role}</div>
                          </div>
                          <button
                            className="icon-btn icon-btn--danger"
                            onClick={() => toggleTeacher(u.id)}
                            title="הסר גישה"
                          >
                            <UserMinus size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Available teachers */}
                <div>
                  <div className="class-perm-section-title">
                    {availableStaff.length > 0 ? `הוסף מורה (${availableStaff.length} זמינים)` : 'כל המורים משויכים'}
                  </div>
                  <div className="class-perm-staff-list">
                    {availableStaff.map(u => (
                      <div key={u.id} className="class-perm-staff-item">
                        <div className="td-avatar" style={{ width: 26, height: 26, fontSize: '0.72rem' }}>
                          {u.fullName?.charAt(0) || '?'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '0.83rem', fontWeight: 600 }}>{u.fullName}</div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{u.jobTitle || u.role}</div>
                        </div>
                        <button
                          className="icon-btn"
                          onClick={() => toggleTeacher(u.id)}
                          title="הוסף גישה"
                          style={{ color: '#22c55e' }}
                        >
                          <UserPlus size={14} />
                        </button>
                      </div>
                    ))}
                    {availableStaff.length === 0 && assignedStaff.length === 0 && (
                      <p style={{ fontSize: '0.8rem', color: '#94a3b8', padding: '0.5rem' }}>
                        {searchQuery ? 'לא נמצאו תוצאות' : 'אין אנשי צוות בבית הספר'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                <Save size={15} />
                {saving ? 'שומר...' : saved ? '✓ נשמר' : 'שמירת הגדרות'}
              </button>
              <button className="btn btn-secondary" onClick={onClose}>סגור</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
