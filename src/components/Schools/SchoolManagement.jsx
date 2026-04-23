import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where
} from 'firebase/firestore';
import Header from '../Layout/Header';
import { Plus, Edit3, Trash2, UserCheck, X, Search } from 'lucide-react';
import '../Gantt/Gantt.css';
import './Schools.css';

export default function SchoolManagement() {
  const [schools, setSchools] = useState([]);
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', phone: '', principalId: '' });
  const [assignModal, setAssignModal] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [assignSearch, setAssignSearch] = useState('');

  useEffect(() => {
    loadSchools();
    loadUsers();
  }, []);

  async function loadSchools() {
    const snap = await getDocs(collection(db, 'schools'));
    setSchools(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  async function loadUsers() {
    const snap = await getDocs(collection(db, 'users'));
    setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;

    if (editing) {
      await updateDoc(doc(db, 'schools', editing), {
        name: form.name,
        address: form.address,
        phone: form.phone
      });
    } else {
      await addDoc(collection(db, 'schools'), {
        name: form.name,
        address: form.address,
        phone: form.phone,
        principalId: '',
        createdAt: new Date().toISOString()
      });
    }
    setForm({ name: '', address: '', phone: '', principalId: '' });
    setShowForm(false);
    setEditing(null);
    loadSchools();
  }

  async function handleDelete(id) {
    if (!confirm('האם למחוק את המוסד?')) return;
    await deleteDoc(doc(db, 'schools', id));
    loadSchools();
  }

  function handleEdit(school) {
    setForm({ name: school.name, address: school.address || '', phone: school.phone || '', principalId: school.principalId || '' });
    setEditing(school.id);
    setShowForm(true);
  }

  async function assignPrincipal(schoolId, userId) {
    // Remove old principal role if exists
    const school = schools.find(s => s.id === schoolId);
    if (school?.principalId) {
      await updateDoc(doc(db, 'users', school.principalId), { role: 'viewer' });
    }
    // Set new principal
    await updateDoc(doc(db, 'users', userId), { role: 'principal', schoolId });
    await updateDoc(doc(db, 'schools', schoolId), { principalId: userId });
    setAssignModal(null);
    setAssignSearch('');
    loadSchools();
    loadUsers();
  }

  function getPrincipalName(principalId) {
    const user = users.find(u => u.id === principalId);
    return user?.fullName || '—';
  }

  // Filter schools
  const filteredSchools = schools.filter(school => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const principalName = getPrincipalName(school.principalId).toLowerCase();
    return (
      (school.name || '').toLowerCase().includes(q) ||
      (school.address || '').toLowerCase().includes(q) ||
      (school.phone || '').includes(q) ||
      principalName.includes(q)
    );
  });

  // Only show principals (or those who can be assigned as principal) in the assign modal
  const assignableUsers = users
    .filter(u => u.role !== 'global_admin')
    .filter(u => {
      if (!assignSearch.trim()) return true;
      const q = assignSearch.toLowerCase();
      return (
        (u.fullName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q)
      );
    });

  return (
    <div className="page">
      <Header title="ניהול מוסדות" />
      <div className="page-content">
        <div className="page-toolbar">
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', address: '', phone: '', principalId: '' }); }}>
            <Plus size={16} />
            מוסד חדש
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div className="search-bar">
              <Search size={14} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="חיפוש מוסד..."
              />
            </div>
          </div>
        </div>

        {showForm && (
          <div className="card form-card">
            <form onSubmit={handleSubmit} className="inline-form">
              <div className="form-group">
                <label>שם המוסד</label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="שם בית הספר" required />
              </div>
              <div className="form-group">
                <label>כתובת</label>
                <input name="address" value={form.address} onChange={handleChange} placeholder="כתובת" />
              </div>
              <div className="form-group">
                <label>טלפון</label>
                <input name="phone" value={form.phone} onChange={handleChange} placeholder="טלפון" dir="ltr" />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">{editing ? 'עדכון' : 'הוספה'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setEditing(null); }}>ביטול</button>
              </div>
            </form>
          </div>
        )}

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>שם המוסד</th>
                <th>כתובת</th>
                <th>טלפון</th>
                <th>מנהל מוסד</th>
                <th>פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filteredSchools.map(school => (
                <tr key={school.id}>
                  <td className="td-bold">{school.name}</td>
                  <td>{school.address || '—'}</td>
                  <td dir="ltr">{school.phone || '—'}</td>
                  <td>
                    <span style={{ fontWeight: 600, color: school.principalId ? '#1e293b' : '#94a3b8' }}>
                      {getPrincipalName(school.principalId)}
                    </span>
                  </td>
                  <td>
                    <div className="td-actions">
                      <button className="icon-btn" title="שיוך מנהל" onClick={() => { setAssignModal(school.id); setAssignSearch(''); }}>
                        <UserCheck size={15} />
                      </button>
                      <button className="icon-btn" title="עריכה" onClick={() => handleEdit(school)}>
                        <Edit3 size={15} />
                      </button>
                      <button className="icon-btn icon-btn--danger" title="מחיקה" onClick={() => handleDelete(school.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSchools.length === 0 && (
                <tr><td colSpan={5} className="td-empty">
                  {searchQuery ? 'לא נמצאו תוצאות' : 'אין מוסדות עדיין'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {assignModal && (
          <div className="modal-overlay" onClick={() => setAssignModal(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>שיוך מנהל מוסד</h3>
                <button className="modal-close" onClick={() => setAssignModal(null)}><X size={18} /></button>
              </div>
              <div className="modal-form">
                <p className="assign-subtitle">בחרו משתמש רשום שישמש כמנהל המוסד:</p>
                <div style={{ marginBottom: '0.75rem' }}>
                  <div className="search-bar">
                    <Search size={14} />
                    <input
                      value={assignSearch}
                      onChange={e => setAssignSearch(e.target.value)}
                      placeholder="חיפוש משתמש..."
                    />
                  </div>
                </div>
                <div className="assign-list">
                  {assignableUsers.map(u => (
                    <button
                      key={u.id}
                      className="assign-item"
                      onClick={() => assignPrincipal(assignModal, u.id)}
                    >
                      <div className="assign-avatar">{u.fullName?.charAt(0)}</div>
                      <div>
                        <div className="assign-name">{u.fullName}</div>
                        <div className="assign-email">{u.email}</div>
                      </div>
                    </button>
                  ))}
                  {assignableUsers.length === 0 && (
                    <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.82rem', padding: '1rem' }}>
                      לא נמצאו משתמשים
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
