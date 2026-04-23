import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { createNotification } from '../../utils/notifications';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import { usePermissions } from '../../hooks/usePermissions';
import { Plus, Trash2, Edit3, Users, X, Search, UserPlus, UserMinus, Shield } from 'lucide-react';
import '../Gantt/Gantt.css';
import './Teams.css';

export default function Teams() {
  const { userData, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const { permissions } = usePermissions();
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
  const [teams, setTeams] = useState([]);
  const [staff, setStaff] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [manageTeam, setManageTeam] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSearch, setMemberSearch] = useState('');

  const schoolId = selectedSchool || userData?.schoolId;
  const isAdmin = isPrincipal() || isGlobalAdmin();
  const hasTeamsPermission = isAdmin || userData?.permissions?.teams_edit;
  const canEdit = hasTeamsPermission;

  // Check if user can manage a specific team (admin, has teams_edit permission, or is team manager)
  function canManageTeam(team) {
    if (isAdmin || hasTeamsPermission) return true;
    return (team.managerIds || []).includes(userData?.uid);
  }

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(
      collection(db, `teams_${schoolId}`),
      (snap) => {
        setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }
    );
    return unsub;
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    loadStaff();
  }, [schoolId]);

  async function loadStaff() {
    // Support both old schoolId and new schoolIds
    const results = [];
    const seen = new Set();

    try {
      const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
      const snap1 = await getDocs(q1);
      snap1.docs.forEach(d => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          results.push({ id: d.id, ...d.data() });
        }
      });
    } catch {}

    try {
      const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
      const snap2 = await getDocs(q2);
      snap2.docs.forEach(d => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          results.push({ id: d.id, ...d.data() });
        }
      });
    } catch {}

    setStaff(results);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !schoolId) return;

    if (editingTeam) {
      await updateDoc(doc(db, `teams_${schoolId}`, editingTeam), {
        name: form.name,
        description: form.description
      });
    } else {
      await addDoc(collection(db, `teams_${schoolId}`), {
        name: form.name,
        description: form.description,
        memberIds: [],
        createdBy: userData?.fullName || '',
        createdAt: new Date().toISOString()
      });
    }
    setForm({ name: '', description: '' });
    setShowForm(false);
    setEditingTeam(null);
  }

  async function handleDelete(teamId) {
    if (!confirm('האם למחוק צוות זה?')) return;
    await deleteDoc(doc(db, `teams_${schoolId}`, teamId));
  }

  function handleEdit(team) {
    setForm({ name: team.name, description: team.description || '' });
    setEditingTeam(team.id);
    setShowForm(true);
  }

  async function addMember(teamId, userId) {
    const team = teams.find(t => t.id === teamId);
    if (!team || (team.memberIds || []).includes(userId)) return;
    await updateDoc(doc(db, `teams_${schoolId}`, teamId), {
      memberIds: [...(team.memberIds || []), userId]
    });
    // Sync teamIds on user doc
    try {
      await updateDoc(doc(db, 'users', userId), { teamIds: arrayUnion(teamId) });
    } catch (err) { console.warn('Could not sync teamIds:', err); }
    // Notify the added user
    createNotification(userId, {
      title: `הוספת לצוות "${team.name}"`,
      body: `${userData?.fullName || 'מנהל'} הוסיף/ה אותך לצוות`,
      type: 'staff',
      link: '/teams'
    });
  }

  async function removeMember(teamId, userId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    await updateDoc(doc(db, `teams_${schoolId}`, teamId), {
      memberIds: (team.memberIds || []).filter(id => id !== userId)
    });
    // Sync teamIds on user doc
    try {
      await updateDoc(doc(db, 'users', userId), { teamIds: arrayRemove(teamId) });
    } catch (err) { console.warn('Could not sync teamIds:', err); }
  }

  async function toggleManager(teamId, userId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const managers = team.managerIds || [];
    if (managers.includes(userId)) {
      await updateDoc(doc(db, `teams_${schoolId}`, teamId), {
        managerIds: managers.filter(id => id !== userId)
      });
    } else {
      await updateDoc(doc(db, `teams_${schoolId}`, teamId), {
        managerIds: [...managers, userId]
      });
    }
  }

  function getMemberName(userId) {
    const user = staff.find(u => u.id === userId || u.uid === userId);
    return user?.fullName || userId;
  }

  const filteredTeams = teams.filter(t => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (t.name || '').toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    );
  });

  const managedTeam = manageTeam ? teams.find(t => t.id === manageTeam) : null;
  const currentMembers = managedTeam?.memberIds || [];

  const availableStaff = staff.filter(u => {
    if (currentMembers.includes(u.id) || currentMembers.includes(u.uid)) return false;
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return (
      (u.fullName || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="page">
      <Header title="צוותים" onPermissions={() => setShowPermissionsPanel(true)} />
      {showPermissionsPanel && <PagePermissionsPanel feature="teams" onClose={() => setShowPermissionsPanel(false)} />}
      <div className="page-content">
        <div className="page-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {canEdit && (
              <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditingTeam(null); setForm({ name: '', description: '' }); }}>
                <Plus size={16} />
                צוות חדש
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="search-bar">
              <Search size={14} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="חיפוש צוות..."
              />
            </div>
            <span className="staff-count">{teams.length} צוותים</span>
          </div>
        </div>

        {showForm && (
          <div className="card form-card">
            <form onSubmit={handleSubmit} className="task-form">
              <div className="form-group">
                <label>שם הצוות</label>
                <input
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder='לדוגמה: "צוות הנהלה", "צוות פדגוגי"'
                  required
                />
              </div>
              <div className="form-group">
                <label>תיאור</label>
                <input
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="תיאור הצוות (אופציונלי)"
                />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">{editingTeam ? 'עדכון' : 'יצירה'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setEditingTeam(null); }}>ביטול</button>
              </div>
            </form>
          </div>
        )}

        <div className="teams-grid">
          {filteredTeams.map(team => (
            <div key={team.id} className="team-card">
              <div className="team-card-header">
                <div className="team-card-icon">
                  <Users size={20} />
                </div>
                <div className="team-card-info">
                  <h3 className="team-card-name">{team.name}</h3>
                  {team.description && <p className="team-card-desc">{team.description}</p>}
                </div>
                {canManageTeam(team) && (
                  <div className="team-card-actions">
                    <button className="icon-btn" title="ניהול חברים" onClick={() => { setManageTeam(team.id); setMemberSearch(''); }}>
                      <UserPlus size={15} />
                    </button>
                    {canEdit && (
                      <>
                        <button className="icon-btn" title="עריכה" onClick={() => handleEdit(team)}>
                          <Edit3 size={15} />
                        </button>
                        <button className="icon-btn icon-btn--danger" title="מחיקה" onClick={() => handleDelete(team.id)}>
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="team-members">
                <span className="team-member-count">{(team.memberIds || []).length} חברים</span>
                <div className="team-member-list">
                  {(team.memberIds || []).map(memberId => (
                    <div key={memberId} className="team-member-chip">
                      <span className="team-member-avatar">{getMemberName(memberId).charAt(0)}</span>
                      <span className="team-member-name">{getMemberName(memberId)}</span>
                      {(team.managerIds || []).includes(memberId) && (
                        <span className="team-manager-badge" title="מנהל צוות"><Shield size={10} /></span>
                      )}
                      {canManageTeam(team) && (
                        <button
                          className="team-member-remove"
                          onClick={() => removeMember(team.id, memberId)}
                          title="הסרה מהצוות"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </div>
                  ))}
                  {(team.memberIds || []).length === 0 && (
                    <p className="team-empty">אין חברים בצוות</p>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filteredTeams.length === 0 && (
            <div className="empty-state">
              <Users size={40} className="empty-icon" />
              <p>{searchQuery ? 'לא נמצאו תוצאות' : 'אין צוותים עדיין'}</p>
            </div>
          )}
        </div>

        {/* Manage Members Modal */}
        {manageTeam && managedTeam && (
          <div className="modal-overlay" onClick={() => setManageTeam(null)}>
            <div className="modal-content modal-content--wide" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>ניהול חברי צוות — {managedTeam.name}</h3>
                <button className="modal-close" onClick={() => setManageTeam(null)}><X size={18} /></button>
              </div>
              <div className="modal-form">
                {/* Current members */}
                <div className="manage-section">
                  <h4 className="manage-section-title">חברי צוות נוכחיים ({currentMembers.length})</h4>
                  <div className="manage-member-list">
                    {currentMembers.map(memberId => {
                      const isManager = (managedTeam.managerIds || []).includes(memberId);
                      return (
                        <div key={memberId} className="manage-member-item">
                          <div className="assign-avatar">{getMemberName(memberId).charAt(0)}</div>
                          <span className="assign-name">{getMemberName(memberId)}</span>
                          {isManager && <span className="team-manager-badge" title="מנהל צוות"><Shield size={10} /> מנהל</span>}
                          {isAdmin && (
                            <button
                              className={`icon-btn${isManager ? ' icon-btn--active' : ''}`}
                              onClick={() => toggleManager(manageTeam, memberId)}
                              title={isManager ? 'הסר כמנהל צוות' : 'הגדר כמנהל צוות'}
                            >
                              <Shield size={14} />
                            </button>
                          )}
                          <button
                            className="icon-btn icon-btn--danger"
                            onClick={() => removeMember(manageTeam, memberId)}
                            title="הסרה"
                          >
                            <UserMinus size={14} />
                          </button>
                        </div>
                      );
                    })}
                    {currentMembers.length === 0 && (
                      <p style={{ color: '#94a3b8', fontSize: '0.82rem', textAlign: 'center', padding: '0.5rem' }}>
                        אין חברים עדיין
                      </p>
                    )}
                  </div>
                </div>

                {/* Add members */}
                <div className="manage-section">
                  <h4 className="manage-section-title">הוספת חברים</h4>
                  <div className="search-bar" style={{ marginBottom: '0.5rem' }}>
                    <Search size={14} />
                    <input
                      value={memberSearch}
                      onChange={e => setMemberSearch(e.target.value)}
                      placeholder="חיפוש אנשי צוות..."
                    />
                  </div>
                  <div className="assign-list">
                    {availableStaff.map(u => (
                      <button
                        key={u.id}
                        className="assign-item"
                        onClick={() => addMember(manageTeam, u.uid || u.id)}
                      >
                        <div className="assign-avatar">{u.fullName?.charAt(0)}</div>
                        <div>
                          <div className="assign-name">{u.fullName}</div>
                          <div className="assign-email">{u.jobTitle || u.email}</div>
                        </div>
                        <UserPlus size={14} style={{ color: '#22c55e', marginRight: 'auto', marginLeft: '0.5rem' }} />
                      </button>
                    ))}
                    {availableStaff.length === 0 && (
                      <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem', padding: '1rem' }}>
                        {memberSearch ? 'לא נמצאו תוצאות' : 'כל אנשי הצוות כבר חברים'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
