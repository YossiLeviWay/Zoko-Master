import { useState, useEffect, useCallback } from 'react';
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
  arrayRemove,
  arrayUnion,
  serverTimestamp,
} from 'firebase/firestore';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import CommunicationLauncherButton from '../Shared/CommunicationLauncherButton';
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
  const [form, setForm] = useState({
    name: '', description: '', responsibilityAreas: '', keywords: '', aliases: '',
    supportingRoles: '', typicalTaskTypes: '',
  });
  const [manageTeam, setManageTeam] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberAction, setMemberAction] = useState('');
  const [memberMessage, setMemberMessage] = useState('');

  const schoolId = selectedSchool || userData?.schoolId;
  const isAdmin = isPrincipal() || isGlobalAdmin();
  const hasTeamsPermission = isAdmin || permissions.teams_edit;
  const canEdit = hasTeamsPermission;
  const emptyTeamForm = () => ({
    name: '', description: '', responsibilityAreas: '', keywords: '', aliases: '',
    supportingRoles: '', typicalTaskTypes: '',
  });
  const splitList = value => [...new Set(String(value || '').split(/[,\n]/u).map(item => item.trim()).filter(Boolean))].slice(0, 20);

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

  const loadStaff = useCallback(async () => {
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
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    loadStaff();
  }, [schoolId, loadStaff]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !schoolId) return;

    const organizationFields = {
      responsibilityAreas: splitList(form.responsibilityAreas),
      keywords: splitList(form.keywords),
      aliases: splitList(form.aliases),
      supportingRoles: splitList(form.supportingRoles),
      typicalTaskTypes: splitList(form.typicalTaskTypes),
      updatedAt: new Date().toISOString(),
    };
    if (editingTeam) {
      await updateDoc(doc(db, `teams_${schoolId}`, editingTeam), {
        name: form.name,
        description: form.description,
        ...organizationFields,
      });
    } else {
      await addDoc(collection(db, `teams_${schoolId}`), {
        schoolId,
        name: form.name,
        description: form.description,
        memberIds: [],
        managerIds: userData?.uid ? [userData.uid] : [],
        ...organizationFields,
        createdBy: userData?.fullName || '',
        createdAt: new Date().toISOString()
      });
    }
    setForm(emptyTeamForm());
    setShowForm(false);
    setEditingTeam(null);
  }

  async function handleDelete(teamId) {
    if (!confirm('האם למחוק צוות זה?')) return;
    await deleteDoc(doc(db, `teams_${schoolId}`, teamId));
  }

  function handleEdit(team) {
    setForm({
      name: team.name,
      description: team.description || '',
      responsibilityAreas: (team.responsibilityAreas || []).join(', '),
      keywords: (team.keywords || []).join(', '),
      aliases: (team.aliases || []).join(', '),
      supportingRoles: (team.supportingRoles || []).join(', '),
      typicalTaskTypes: (team.typicalTaskTypes || []).join(', '),
    });
    setEditingTeam(team.id);
    setShowForm(true);
  }

  async function addMember(teamId, userId) {
    const team = teams.find(t => t.id === teamId);
    if (!team || (team.memberIds || []).includes(userId)) return;
    const actionKey = `add_${userId}`;
    setMemberAction(actionKey);
    setMemberMessage('');
    try {
      await updateDoc(doc(db, `teams_${schoolId}`, teamId), {
        memberIds: arrayUnion(userId),
        updatedAt: serverTimestamp(),
      });
      setMemberMessage('איש הצוות נוסף בהצלחה.');
      createNotification(userId, {
        schoolId,
        title: `הוספת לצוות "${team.name}"`,
        body: `${userData?.fullName || 'מנהל'} הוסיף/ה אותך לצוות`,
        type: 'staff',
        link: '/teams'
      }).catch(() => undefined);
    } catch {
      setMemberMessage('לא ניתן להוסיף את איש הצוות. בדקו שיש לך הרשאת ניהול צוותים.');
    } finally {
      setMemberAction('');
    }
  }

  async function removeMember(teamId, userId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const actionKey = `remove_${userId}`;
    setMemberAction(actionKey);
    setMemberMessage('');
    try {
      await updateDoc(doc(db, `teams_${schoolId}`, teamId), {
        memberIds: arrayRemove(userId),
        managerIds: arrayRemove(userId),
        updatedAt: serverTimestamp(),
      });
      setMemberMessage('איש הצוות הוסר מהצוות.');
    } catch {
      setMemberMessage('לא ניתן להסיר את איש הצוות. בדקו שיש לך הרשאת ניהול צוותים.');
    } finally {
      setMemberAction('');
    }
  }

  async function toggleManager(teamId, userId) {
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const managers = team.managerIds || [];
    const actionKey = `manager_${userId}`;
    setMemberAction(actionKey);
    setMemberMessage('');
    try {
      await updateDoc(doc(db, `teams_${schoolId}`, teamId), {
        managerIds: managers.includes(userId) ? arrayRemove(userId) : arrayUnion(userId),
        updatedAt: serverTimestamp(),
      });
      setMemberMessage(managers.includes(userId) ? 'הרשאת ניהול הצוות הוסרה.' : 'איש הצוות הוגדר כמנהל צוות.');
    } catch {
      setMemberMessage('לא ניתן לעדכן את מנהל הצוות.');
    } finally {
      setMemberAction('');
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
              <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditingTeam(null); setForm(emptyTeamForm()); }}>
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
              <div className="form-row">
                <div className="form-group"><label>תחומי אחריות</label><input value={form.responsibilityAreas} onChange={e => setForm(prev => ({ ...prev, responsibilityAreas: e.target.value }))} placeholder="טיולים, מסעות, סיורים" /></div>
                <div className="form-group"><label>מילות מפתח</label><input value={form.keywords} onChange={e => setForm(prev => ({ ...prev, keywords: e.target.value }))} placeholder="טיול שנתי, מסלול, הסעות" /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>שמות חלופיים</label><input value={form.aliases} onChange={e => setForm(prev => ({ ...prev, aliases: e.target.value }))} placeholder="רכזי טיולים, צוות מסעות" /></div>
                <div className="form-group"><label>תפקידים תומכים שכיחים</label><input value={form.supportingRoles} onChange={e => setForm(prev => ({ ...prev, supportingRoles: e.target.value }))} placeholder="יועצת, מנהלנית, מזכירה" /></div>
              </div>
              <div className="form-group"><label>סוגי משימות שכיחים</label><input value={form.typicalTaskTypes} onChange={e => setForm(prev => ({ ...prev, typicalTaskTypes: e.target.value }))} placeholder="תכנון טיול, הזמנת הסעות, אישורי הורים" /></div>
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
                <div className="team-card-actions">
                  <CommunicationLauncherButton context={{ type: 'team', id: team.id, label: team.name, description: team.description, teamId: team.id, participantIds: team.memberIds || [] }} className="icon-btn" title={`יצירת מייל ומעקב עבור ${team.name}`}>מייל</CommunicationLauncherButton>
                  {canManageTeam(team) && <>
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
                  </>}
                </div>
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
            <div className="modal-content modal-content--wide team-manage-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>ניהול חברי צוות — {managedTeam.name}</h3>
                <button type="button" className="modal-close" onClick={() => setManageTeam(null)} aria-label="סגירה"><X size={18} /></button>
              </div>
              <div className="modal-form">
                {memberMessage && <div className="team-member-message" role="status">{memberMessage}</div>}
                {/* Current members */}
                <div className="manage-section">
                  <h4 className="manage-section-title">חברי צוות נוכחיים ({currentMembers.length})</h4>
                  <div className="manage-member-list">
                    {currentMembers.map(memberId => {
                      const isManager = (managedTeam.managerIds || []).includes(memberId);
                      return (
                        <div key={memberId} className="manage-member-item">
                          <div className="team-staff-avatar">{getMemberName(memberId).charAt(0)}</div>
                          <span className="team-staff-name">{getMemberName(memberId)}</span>
                          {isManager && <span className="team-manager-badge" title="מנהל צוות"><Shield size={10} /> מנהל</span>}
                          {isAdmin && (
                            <button
                              type="button"
                              className={`icon-btn${isManager ? ' icon-btn--active' : ''}`}
                              disabled={memberAction === `manager_${memberId}`}
                              onClick={() => toggleManager(manageTeam, memberId)}
                              title={isManager ? 'הסר כמנהל צוות' : 'הגדר כמנהל צוות'}
                            >
                              <Shield size={14} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-btn icon-btn--danger"
                            disabled={memberAction === `remove_${memberId}`}
                            onClick={() => removeMember(manageTeam, memberId)}
                            title="הסרה"
                          >
                            <UserMinus size={14} />
                          </button>
                        </div>
                      );
                    })}
                    {currentMembers.length === 0 && (
                      <p style={{ color: '#9b8790', fontSize: '0.82rem', textAlign: 'center', padding: '0.5rem' }}>
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
                  <div className="team-staff-list">
                    {availableStaff.map(u => (
                      <button
                        type="button"
                        key={u.id}
                        className="team-staff-option"
                        disabled={memberAction === `add_${u.uid || u.id}`}
                        onClick={() => addMember(manageTeam, u.uid || u.id)}
                      >
                        <div className="team-staff-avatar">{u.fullName?.charAt(0)}</div>
                        <div className="team-staff-info">
                          <div className="team-staff-name">{u.fullName}</div>
                          <div className="team-staff-meta">{u.jobTitle || u.email}</div>
                        </div>
                        <span className="team-staff-add"><UserPlus size={15} /> הוספה</span>
                      </button>
                    ))}
                    {availableStaff.length === 0 && (
                      <p style={{ textAlign: 'center', color: '#9b8790', fontSize: '0.82rem', padding: '1rem' }}>
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
