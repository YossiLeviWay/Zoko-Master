import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { db } from '../../firebase';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  onSnapshot
} from 'firebase/firestore';
import { sortCalendarCategories } from '../../utils/calendarInteractions';
import { Plus, Edit3, Trash2, Save, X } from 'lucide-react';
import './Gantt.css';
import './Categories.css';

const CATEGORY_COLORS = [
  '#eadfe2', '#f9dab9', '#d1fae5', '#fef3c7', '#fce7f3',
  '#ede9fe', '#fed7aa', '#ccfbf1', '#e0e7ff', '#fecdd3'
];

export default function CategoryManager() {
  const { userData, selectedSchool } = useAuth();
  const { permissions } = usePermissions();
  const canEdit = permissions.categories_edit;
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', color: CATEGORY_COLORS[0] });

  const schoolId = selectedSchool || userData?.schoolId;

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `categories_${schoolId}`), (snap) => {
      setCategories(sortCalendarCategories(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    });
    return unsub;
  }, [schoolId]);

  async function moveCategory(index, direction) {
    if(!canEdit || saving) return;
    const next=[...categories];const target=index+direction;
    if(target<0 || target>=next.length)return;
    [next[index],next[target]]=[next[target],next[index]];
    setSaving(true);setError('');
    try { const batch=writeBatch(db);next.forEach((cat,order)=>batch.update(doc(db, `categories_${schoolId}`, cat.id),{order}));await batch.commit(); }
    catch { setError('לא ניתן לשמור את הסדר. נסו שוב.'); } finally {setSaving(false);}
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canEdit || !form.name.trim() || !schoolId) return;

    setSaving(true); setError('');
    try {
    if (editing) {
      await updateDoc(doc(db, `categories_${schoolId}`, editing), {
        name: form.name,
        color: form.color
      });
    } else {
      await addDoc(collection(db, `categories_${schoolId}`), {
        name: form.name,
        color: form.color,
        order: categories.length,
        createdAt: new Date().toISOString()
      });
    }
    setForm({ name: '', color: CATEGORY_COLORS[0] });
    setShowForm(false);
    setEditing(null);
    } catch {setError('לא ניתן לשמור את הקטגוריה. הטיוטה נשארה לעריכה.');} finally {setSaving(false);}
  }

  async function handleDelete(id) {
    if (!canEdit) return;
    if (!confirm('האם למחוק קטגוריה זו?')) return;
    await deleteDoc(doc(db, `categories_${schoolId}`, id));
  }

  function startEdit(cat) {
    if (!canEdit) return;
    setForm({ name: cat.name, color: cat.color || CATEGORY_COLORS[0] });
    setEditing(cat.id);
    setShowForm(true);
  }

  return (
<div className="calendar-categories">
      <div>
        <p>סדר הקטגוריות נשמר בלוח המוסד. השתמשו בחצים כדי לשנות את הסדר.</p>
        {error && <p role="alert">{error}</p>}
        <div className="page-toolbar">
          {canEdit && (
            <button className="btn btn-primary" onClick={() => { setShowForm(true); setEditing(null); setForm({ name: '', color: CATEGORY_COLORS[0] }); }}>
              <Plus size={16} />
              קטגוריה חדשה
            </button>
          )}
        </div>

        {showForm && (
          <div className="card form-card">
            <form onSubmit={handleSubmit} className="inline-form">
              <div className="form-group">
                <label>שם הקטגוריה</label>
                <input
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="למשל: כיתה י׳"
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>צבע</label>
                <div className="color-picker">
                  {CATEGORY_COLORS.map(c => (
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
              <div className="form-actions">
                <button type="submit" disabled={saving} className="btn btn-primary">
                  {editing ? 'עדכון' : 'הוספה'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setEditing(null); }}>
                  ביטול
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="categories-grid">
          {categories.map((cat, index) => (
            <div key={cat.id} className="category-card" style={{ borderColor: cat.color }}>
              <div className="category-color" style={{ background: cat.color }} />
              <span className="category-name">{cat.name}</span>
              {canEdit && (
                <div className="category-actions">
                  <button disabled={saving || index===0} onClick={()=>moveCategory(index,-1)} aria-label={`העלאת ${cat.name}`}>↑</button>
                  <button disabled={saving || index===categories.length-1} onClick={()=>moveCategory(index,1)} aria-label={`הורדת ${cat.name}`}>↓</button>
                  <button className="icon-btn" onClick={() => startEdit(cat)} title="עריכה">
                    <Edit3 size={14} />
                  </button>
                  <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(cat.id)} title="מחיקה">
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {categories.length === 0 && (
            <div className="empty-state">
              <p>אין קטגוריות מוגדרות — ייעשה שימוש בברירות מחדל</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
