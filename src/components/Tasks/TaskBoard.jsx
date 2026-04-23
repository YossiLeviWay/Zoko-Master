import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  getDocs,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import Header from '../Layout/Header';
import ChatPanel from './ChatPanel';
import { Plus, Trash2, MessageSquare, Clock, AlertTriangle, AlertCircle, ChevronDown, X, Search, Filter, Users, Edit3, Save, Pin, Paperclip, FileText, ExternalLink, Table2, FileEdit } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import '../Gantt/Gantt.css';
import './Tasks.css';
import SpreadsheetEditor from '../Files/SpreadsheetEditor';
import DocumentEditor from '../Files/DocumentEditor';
import { createNotification, createNotifications } from '../../utils/notifications';

const PRIORITY_CONFIG = {
  high: { label: 'גבוהה', icon: AlertCircle, color: '#ef4444', bg: '#fef2f2' },
  medium: { label: 'בינונית', icon: AlertTriangle, color: '#f59e0b', bg: '#fffbeb' },
  low: { label: 'נמוכה', icon: Clock, color: '#22c55e', bg: '#f0fdf4' }
};

const STATUS_CONFIG = {
  todo: { label: 'לביצוע', color: '#64748b' },
  in_progress: { label: 'בתהליך', color: '#2563eb' },
  done: { label: 'הושלם', color: '#22c55e' }
};

const ASSIGNEE_TYPES = {
  all_school: 'כל בית הספר',
  team: 'צוות',
  individual: 'אנשי צוות'
};

export default function TaskBoard() {
  const { userData, selectedSchool, currentUser, isViewer, isPrincipal, isGlobalAdmin } = useAuth();
  const uid = currentUser?.uid;
  const [tasks, setTasks] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [chatTask, setChatTask] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterTeam, setFilterTeam] = useState('all');
  const [staff, setStaff] = useState([]);
  const [teams, setTeams] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [allFiles, setAllFiles] = useState([]);
  const [allFolders, setAllFolders] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    dueDate: '',
    assigneeType: 'all_school',
    assigneeIds: [],
    assigneeTeamId: '',
    attachedFileId: '',
    attachedFileName: ''
  });

  const schoolId = selectedSchool || userData?.schoolId;

  useEffect(() => {
    if (!schoolId) return;
    const q = query(
      collection(db, `tasks_${schoolId}`),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    async function fetchStaff() {
      const results = [];
      const seen = new Set();
      try {
        const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
        const snap1 = await getDocs(q1);
        snap1.docs.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); } });
      } catch {}
      try {
        const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
        const snap2 = await getDocs(q2);
        snap2.docs.forEach(d => { if (!seen.has(d.id)) { seen.add(d.id); results.push({ id: d.id, ...d.data() }); } });
      } catch {}
      setStaff(results);
    }
    fetchStaff();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `teams_${schoolId}`), (snap) => {
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId]);

  // Load files for attachment picker
  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `files_${schoolId}`), (snap) => {
      setAllFiles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setAllFiles([]));
    return unsub;
  }, [schoolId]);

  // Load folders for file path display
  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `folders_${schoolId}`), (snap) => {
      setAllFolders(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setAllFolders([]));
    return unsub;
  }, [schoolId]);

  function getFolderName(folderId) {
    const folder = allFolders.find(f => f.id === folderId);
    return folder?.name || '';
  }

  function autoResizeTextarea(e) {
    e.target.style.height = 'auto';
    e.target.style.height = e.target.scrollHeight + 'px';
  }

  function handleFileAttach(e) {
    const fileId = e.target.value;
    const file = allFiles.find(f => f.id === fileId);
    setForm(prev => ({ ...prev, attachedFileId: fileId, attachedFileName: file?.name || '' }));
  }

  function handleEditFileAttach(e) {
    const fileId = e.target.value;
    const file = allFiles.find(f => f.id === fileId);
    setEditForm(prev => ({ ...prev, attachedFileId: fileId, attachedFileName: file?.name || '' }));
  }

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleEditChange(e) {
    setEditForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function toggleAssignee(userId) {
    setForm(prev => {
      const ids = prev.assigneeIds.includes(userId)
        ? prev.assigneeIds.filter(id => id !== userId)
        : [...prev.assigneeIds, userId];
      return { ...prev, assigneeIds: ids };
    });
  }

  function toggleEditAssignee(userId) {
    setEditForm(prev => {
      const ids = (prev.assigneeIds || []).includes(userId)
        ? prev.assigneeIds.filter(id => id !== userId)
        : [...(prev.assigneeIds || []), userId];
      return { ...prev, assigneeIds: ids };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.title.trim() || !schoolId) return;

    const taskData = {
      title: form.title,
      description: form.description,
      priority: form.priority,
      status: form.status,
      dueDate: form.dueDate,
      assigneeType: form.assigneeType,
      assigneeIds: form.assigneeType === 'individual' ? form.assigneeIds : [],
      assigneeTeamId: form.assigneeType === 'team' ? form.assigneeTeamId : '',
      attachedFileId: form.attachedFileId || '',
      attachedFileName: form.attachedFileName || '',
      createdBy: userData?.fullName || '',
      createdAt: new Date().toISOString()
    };

    await addDoc(collection(db, `tasks_${schoolId}`), taskData);

    // Send notifications to assignees
    const notifTitle = `משימה חדשה: ${form.title}`;
    const notifOpts = { title: notifTitle, body: form.description?.slice(0, 80) || '', type: 'task', link: '/tasks' };
    if (form.assigneeType === 'individual' && form.assigneeIds.length > 0) {
      const otherIds = form.assigneeIds.filter(id => id !== currentUser?.uid);
      if (otherIds.length > 0) createNotifications(otherIds, notifOpts);
    } else if (form.assigneeType === 'team' && form.assigneeTeamId) {
      const team = teams.find(t => t.id === form.assigneeTeamId);
      if (team?.memberIds) {
        const otherIds = team.memberIds.filter(id => id !== currentUser?.uid);
        if (otherIds.length > 0) createNotifications(otherIds, notifOpts);
      }
    } else if (form.assigneeType === 'all_school') {
      // For all_school, notify staff (skip creator)
      const otherIds = staff.map(u => u.uid || u.id).filter(id => id !== currentUser?.uid);
      if (otherIds.length > 0) createNotifications(otherIds, notifOpts);
    }

    setForm({ title: '', description: '', priority: 'medium', status: 'todo', dueDate: '', assigneeType: 'all_school', assigneeIds: [], assigneeTeamId: '', attachedFileId: '', attachedFileName: '' });
    setShowForm(false);
  }

  function startEdit(task) {
    setEditingTask(task.id);
    setEditForm({
      title: task.title || '',
      description: task.description || '',
      priority: task.priority || 'medium',
      status: task.status || 'todo',
      dueDate: task.dueDate || '',
      assigneeType: task.assigneeType || 'all_school',
      assigneeIds: task.assigneeIds || [],
      assigneeTeamId: task.assigneeTeamId || '',
      attachedFileId: task.attachedFileId || '',
      attachedFileName: task.attachedFileName || ''
    });
  }

  async function saveEdit() {
    if (!editingTask || !editForm || !schoolId) return;
    await updateDoc(doc(db, `tasks_${schoolId}`, editingTask), {
      title: editForm.title,
      description: editForm.description,
      priority: editForm.priority,
      status: editForm.status,
      dueDate: editForm.dueDate,
      assigneeType: editForm.assigneeType,
      assigneeIds: editForm.assigneeType === 'individual' ? editForm.assigneeIds : [],
      assigneeTeamId: editForm.assigneeType === 'team' ? editForm.assigneeTeamId : '',
      attachedFileId: editForm.attachedFileId || '',
      attachedFileName: editForm.attachedFileName || ''
    });
    setEditingTask(null);
    setEditForm(null);
  }

  function cancelEdit() {
    setEditingTask(null);
    setEditForm(null);
  }

  async function updateTaskStatus(taskId, newStatus) {
    await updateDoc(doc(db, `tasks_${schoolId}`, taskId), { status: newStatus });
  }

  async function togglePinTask(taskId, isPinned) {
    if (!uid || !schoolId) return;
    await updateDoc(doc(db, `tasks_${schoolId}`, taskId), {
      pinnedBy: isPinned ? arrayRemove(uid) : arrayUnion(uid)
    });
  }

  async function deleteTask(taskId) {
    if (!confirm('האם למחוק משימה זו?')) return;
    await deleteDoc(doc(db, `tasks_${schoolId}`, taskId));
  }

  function isOverdue(dueDate) {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date() && new Date(dueDate).toDateString() !== new Date().toDateString();
  }

  function getAssigneeDisplay(task) {
    if (task.assignee && !task.assigneeType) return task.assignee;
    if (task.assigneeType === 'all_school') return 'כל בית הספר';
    if (task.assigneeType === 'team') {
      const team = teams.find(t => t.id === task.assigneeTeamId);
      return team ? team.name : 'צוות';
    }
    if (task.assigneeType === 'individual' && task.assigneeIds?.length > 0) {
      const names = task.assigneeIds.map(id => {
        const user = staff.find(u => u.id === id || u.uid === id);
        return user?.fullName || id;
      });
      if (names.length <= 2) return names.join(', ');
      return `${names[0]} +${names.length - 1}`;
    }
    return '';
  }

  const isAdmin = isPrincipal() || isGlobalAdmin();

  // Filter tasks
  const filteredTasks = tasks.filter(task => {
    // Viewer can only see tasks assigned to them
    if (isViewer() && !isAdmin) {
      const assignedToMe =
        task.assigneeType === 'all_school' ||
        (task.assigneeIds || []).includes(uid) ||
        (task.assigneeType === 'team' && (userData?.teamIds || []).includes(task.assigneeTeamId));
      if (!assignedToMe) return false;
    }
    if (filterStatus !== 'all' && task.status !== filterStatus) return false;
    if (filterPriority !== 'all' && task.priority !== filterPriority) return false;
    if (filterTeam !== 'all') {
      if (task.assigneeType !== 'team' || task.assigneeTeamId !== filterTeam) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const assigneeText = getAssigneeDisplay(task).toLowerCase();
      return (
        (task.title || '').toLowerCase().includes(q) ||
        (task.description || '').toLowerCase().includes(q) ||
        assigneeText.includes(q)
      );
    }
    return true;
  }).sort((a, b) => {
    const aPin = a.pinnedBy?.includes(uid) ? 0 : 1;
    const bPin = b.pinnedBy?.includes(uid) ? 0 : 1;
    return aPin - bPin;
  });

  return (
    <div className="page">
      <Header title="משימות" />
      <div className="page-content">
        <div className="page-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {!isViewer() && (
              <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                <Plus size={16} />
                משימה חדשה
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div className="search-bar" style={{ minWidth: 160 }}>
              <Search size={14} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="חיפוש משימות..."
              />
            </div>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{ padding: '0.35rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.78rem', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}
            >
              <option value="all">כל הסטטוסים</option>
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
            <select
              value={filterPriority}
              onChange={e => setFilterPriority(e.target.value)}
              style={{ padding: '0.35rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.78rem', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}
            >
              <option value="all">כל הדחיפויות</option>
              {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                <option key={key} value={key}>{cfg.label}</option>
              ))}
            </select>
            {teams.length > 0 && (
              <select
                value={filterTeam}
                onChange={e => setFilterTeam(e.target.value)}
                style={{ padding: '0.35rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.78rem', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}
              >
                <option value="all">כל הצוותים</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            <span className="task-stats">
              {tasks.filter(t => t.status === 'done').length}/{tasks.length} הושלמו
            </span>
          </div>
        </div>

        {showForm && (
          <div className="card form-card">
            <form onSubmit={handleSubmit} className="task-form">
              <div className="form-group">
                <label>כותרת</label>
                <input name="title" value={form.title} onChange={handleChange} placeholder="שם המשימה" required />
              </div>
              <div className="form-group">
                <label>תיאור</label>
                <textarea name="description" value={form.description} onChange={(e) => { handleChange(e); autoResizeTextarea(e); }} onFocus={autoResizeTextarea} placeholder="פירוט..." rows={2} style={{ resize: 'none', overflow: 'hidden' }} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>דחיפות</label>
                  <select name="priority" value={form.priority} onChange={handleChange}>
                    {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>תאריך יעד</label>
                  <input name="dueDate" type="date" value={form.dueDate} onChange={handleChange} dir="ltr" />
                </div>
              </div>

              <div className="form-group">
                <label>שיוך משימה</label>
                <select name="assigneeType" value={form.assigneeType} onChange={handleChange}>
                  <option value="all_school">כל בית הספר</option>
                  <option value="team">צוות ספציפי</option>
                  <option value="individual">אנשי צוות ספציפיים</option>
                </select>
              </div>

              {form.assigneeType === 'team' && (
                <div className="form-group">
                  <label>בחירת צוות</label>
                  <select name="assigneeTeamId" value={form.assigneeTeamId} onChange={handleChange}>
                    <option value="">בחרו צוות</option>
                    {teams.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({(t.memberIds || []).length} חברים)</option>
                    ))}
                  </select>
                </div>
              )}

              {form.assigneeType === 'individual' && (
                <div className="form-group">
                  <label>בחירת אנשי צוות</label>
                  <div className="assignee-picker">
                    {staff.map(u => {
                      const userId = u.uid || u.id;
                      const isSelected = form.assigneeIds.includes(userId);
                      return (
                        <button
                          key={u.id}
                          type="button"
                          className={`assignee-chip ${isSelected ? 'assignee-chip--selected' : ''}`}
                          onClick={() => toggleAssignee(userId)}
                        >
                          <span className="assignee-chip-avatar">{u.fullName?.charAt(0)}</span>
                          {u.fullName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* File attachment */}
              <div className="form-group">
                <label><Paperclip size={12} style={{ verticalAlign: 'middle' }} /> צירוף קובץ</label>
                <select value={form.attachedFileId} onChange={handleFileAttach}>
                  <option value="">ללא קובץ מצורף</option>
                  {allFiles.filter(f => f.fileType === 'spreadsheet' || f.fileType === 'document').map(f => {
                    const folderName = getFolderName(f.folderId);
                    return (
                      <option key={f.id} value={f.id}>{folderName ? `${folderName} / ` : ''}{f.name} ({f.fileType === 'spreadsheet' ? 'גיליון' : 'מסמך'})</option>
                    );
                  })}
                </select>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn btn-primary">הוספה</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>ביטול</button>
              </div>
            </form>
          </div>
        )}

        {/* Edit modal */}
        {editingTask && editForm && (
          <div className="task-edit-overlay" onClick={cancelEdit}>
            <div className="task-edit-modal" onClick={e => e.stopPropagation()}>
              <div className="task-edit-header">
                <h3>עריכת משימה</h3>
                <button className="icon-btn" onClick={cancelEdit}><X size={18} /></button>
              </div>
              <div className="task-form">
                <div className="form-group">
                  <label>כותרת</label>
                  <input name="title" value={editForm.title} onChange={handleEditChange} />
                </div>
                <div className="form-group">
                  <label>תיאור</label>
                  <textarea name="description" value={editForm.description} onChange={(e) => { handleEditChange(e); autoResizeTextarea(e); }} onFocus={autoResizeTextarea} rows={2} style={{ resize: 'none', overflow: 'hidden' }} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>דחיפות</label>
                    <select name="priority" value={editForm.priority} onChange={handleEditChange}>
                      {Object.entries(PRIORITY_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>סטטוס</label>
                    <select name="status" value={editForm.status} onChange={handleEditChange}>
                      {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>תאריך יעד</label>
                    <input name="dueDate" type="date" value={editForm.dueDate} onChange={handleEditChange} dir="ltr" />
                  </div>
                </div>

                <div className="form-group">
                  <label>שיוך משימה</label>
                  <select name="assigneeType" value={editForm.assigneeType} onChange={handleEditChange}>
                    <option value="all_school">כל בית הספר</option>
                    <option value="team">צוות ספציפי</option>
                    <option value="individual">אנשי צוות ספציפיים</option>
                  </select>
                </div>

                {editForm.assigneeType === 'team' && (
                  <div className="form-group">
                    <label>בחירת צוות</label>
                    <select name="assigneeTeamId" value={editForm.assigneeTeamId} onChange={handleEditChange}>
                      <option value="">בחרו צוות</option>
                      {teams.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {editForm.assigneeType === 'individual' && (
                  <div className="form-group">
                    <label>בחירת אנשי צוות</label>
                    <div className="assignee-picker">
                      {staff.map(u => {
                        const userId = u.uid || u.id;
                        const isSelected = (editForm.assigneeIds || []).includes(userId);
                        return (
                          <button
                            key={u.id}
                            type="button"
                            className={`assignee-chip ${isSelected ? 'assignee-chip--selected' : ''}`}
                            onClick={() => toggleEditAssignee(userId)}
                          >
                            <span className="assignee-chip-avatar">{u.fullName?.charAt(0)}</span>
                            {u.fullName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* File attachment */}
                <div className="form-group">
                  <label><Paperclip size={12} style={{ verticalAlign: 'middle' }} /> צירוף קובץ</label>
                  <select value={editForm.attachedFileId || ''} onChange={handleEditFileAttach}>
                    <option value="">ללא קובץ מצורף</option>
                    {allFiles.filter(f => f.fileType === 'spreadsheet' || f.fileType === 'document').map(f => {
                      const folderName = getFolderName(f.folderId);
                      return (
                        <option key={f.id} value={f.id}>{folderName ? `${folderName} / ` : ''}{f.name} ({f.fileType === 'spreadsheet' ? 'גיליון' : 'מסמך'})</option>
                      );
                    })}
                  </select>
                </div>

                <div className="form-actions">
                  <button type="button" className="btn btn-primary" onClick={saveEdit}>
                    <Save size={14} /> שמירה
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={cancelEdit}>ביטול</button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="task-list">
          {filteredTasks.map(task => {
            const prio = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
            const status = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo;
            const PrioIcon = prio.icon;
            const overdue = task.status !== 'done' && isOverdue(task.dueDate);
            const assigneeDisplay = getAssigneeDisplay(task);
            const isPinned = task.pinnedBy?.includes(uid);

            return (
              <div key={task.id} className={`task-row ${overdue ? 'task-row--overdue' : ''} ${isPinned ? 'task-row--pinned' : ''}`}>
                <div className="task-priority" style={{ background: prio.bg }}>
                  <PrioIcon size={14} style={{ color: prio.color }} />
                </div>

                <div className="task-main">
                  <div className="task-title">{task.title}</div>
                  {task.description && <div className="task-desc">{task.description}</div>}
                  <div className="task-meta">
                    <span className="task-priority-badge" style={{ background: prio.bg, color: prio.color, padding: '0.15rem 0.5rem', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
                      {prio.label}
                    </span>
                    {assigneeDisplay && (
                      <span className="task-assignee">
                        {task.assigneeType === 'team' && <Users size={11} style={{ marginLeft: '0.2rem', verticalAlign: 'middle' }} />}
                        {assigneeDisplay}
                      </span>
                    )}
                    {task.dueDate && (
                      <span className={`task-due ${overdue ? 'task-due--late' : ''}`}>
                        {new Date(task.dueDate).toLocaleDateString('he-IL')}
                      </span>
                    )}
                    {task.createdBy && (
                      <span className="task-created-by" style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                        יוצר: {task.createdBy}
                      </span>
                    )}
                    {task.attachedFileId && (
                      <span
                        className="task-file-link"
                        onClick={(e) => { e.stopPropagation(); setPreviewFile(task); }}
                        style={{ fontSize: '0.72rem', color: '#7c3aed', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                      >
                        <Paperclip size={11} /> {task.attachedFileName || 'קובץ מצורף'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="task-status-wrap">
                  {isViewer() ? (
                    <span className="task-status-badge" style={{ color: status.color, borderColor: status.color }}>{status.label}</span>
                  ) : (
                    <select
                      className="task-status-select"
                      value={task.status}
                      onChange={e => updateTaskStatus(task.id, e.target.value)}
                      style={{ color: status.color, borderColor: status.color }}
                    >
                      {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>{cfg.label}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="task-actions">
                  <button
                    className={`icon-btn ${isPinned ? 'icon-btn--pinned' : ''}`}
                    title={isPinned ? 'הסר נעיצה' : 'נעץ'}
                    onClick={() => togglePinTask(task.id, isPinned)}
                  >
                    <Pin size={15} style={isPinned ? { color: '#2563eb' } : undefined} />
                  </button>
                  {!isViewer() && (
                    <button
                      className="icon-btn"
                      title="עריכה"
                      onClick={() => startEdit(task)}
                    >
                      <Edit3 size={15} />
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    title="צ'אט"
                    onClick={() => setChatTask(task)}
                  >
                    <MessageSquare size={15} />
                  </button>
                  {!isViewer() && (
                    <button
                      className="icon-btn icon-btn--danger"
                      title="מחיקה"
                      onClick={() => deleteTask(task.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filteredTasks.length === 0 && (
            <div className="empty-state">
              <p>{searchQuery || filterStatus !== 'all' || filterPriority !== 'all' || filterTeam !== 'all' ? 'לא נמצאו תוצאות' : 'אין משימות עדיין'}</p>
            </div>
          )}
        </div>
      </div>

      {chatTask && (
        <ChatPanel
          task={chatTask}
          schoolId={schoolId}
          currentUser={userData}
          onClose={() => setChatTask(null)}
        />
      )}
      {previewFile && previewFile.attachedFileId && (() => {
        const file = allFiles.find(f => f.id === previewFile.attachedFileId);
        if (!file) return null;
        // Check folder permissions
        const folder = allFolders.find(fd => fd.id === file.folderId);
        const canManage = userData?.role === 'global_admin' || userData?.role === 'principal';
        const hasAccess = canManage || !folder || folder.visibility === 'all' ||
          (folder.allowedUsers && folder.allowedUsers.includes(currentUser?.uid));
        if (!hasAccess) {
          return (
            <div className="task-edit-overlay" onClick={() => setPreviewFile(null)} style={{ zIndex: 250 }}>
              <div className="task-file-preview-modal" onClick={e => e.stopPropagation()} style={{
                background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
                width: '90%', maxWidth: 500, padding: '2rem', textAlign: 'center'
              }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🔒</div>
                <h3 style={{ margin: '0 0 0.5rem', color: '#1e293b' }}>אין הרשאה</h3>
                <p style={{ color: '#64748b', fontSize: '0.88rem', marginBottom: '1rem' }}>
                  אין לך הרשאות גישה לקובץ זה. פנה למנהל המערכת לקבלת הרשאה.
                </p>
                <button className="btn btn-secondary" onClick={() => setPreviewFile(null)}>סגירה</button>
              </div>
            </div>
          );
        }
        const folderName = getFolderName(file.folderId);
        return (
          <div className="task-edit-overlay" onClick={() => setPreviewFile(null)} style={{ zIndex: 250 }}>
            <div className="task-file-preview-modal" onClick={e => e.stopPropagation()} style={{
              background: '#fff', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              width: '90%', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <FileText size={16} style={{ color: '#7c3aed' }} />
                  <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>
                    {folderName ? `${folderName} / ` : ''}{file.name}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-primary btn-sm" onClick={() => { setPreviewFile(null); navigate(`/files?openFile=${file.id}`); }} style={{ fontSize: '0.78rem', padding: '0.3rem 0.7rem' }}>
                    <FileEdit size={13} /> עריכה
                  </button>
                  <button className="icon-btn" onClick={() => setPreviewFile(null)}><X size={18} /></button>
                </div>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: '0.5rem' }}>
                {file.fileType === 'spreadsheet' ? (
                  <SpreadsheetEditor data={file.content} readOnly={true} />
                ) : (
                  <DocumentEditor content={file.content} readOnly={true} />
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
