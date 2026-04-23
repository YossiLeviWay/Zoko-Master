import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot
} from 'firebase/firestore';
import Header from '../Layout/Header';
import { Plus, Edit3, Trash2, Save, X } from 'lucide-react';
import './Gantt.css';
import './Categories.css';

const CATEGORY_COLORS = [
  '#e2e8f0', '#dbeafe', '#d1fae5', '#fef3c7', '#fce7f3',
  '#ede9fe', '#fed7aa', '#ccfbf1', '#e0e7ff', '#fecdd3'
];

export default function CategoryManager() {
  const { userData, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const canEdit = isPrincipal() || isGlobalAdmin();
  const [categories, setCategories] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', color: CATEGORY_COLORS[0] });

  const schoolId = selectedSchool || userData?.schoolId;

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `categories_${schoolId}`), (snap) => {
      setCategories(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim() || !schoolId) return;

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
  }

  async function handleDelete(id) {
    if (!confirm('האם למחוק קטגוריה זו?')) return;
    await deleteDoc(doc(db, `categories_${schoolId}`, id));
  }

  function startEdit(cat) {
    setForm({ name: cat.name, color: cat.color || CATEGORY_COLORS[0] });
    setEditing(cat.id);
    setShowForm(true);
  }

  return (
    <div className="page">
      <Header title="ניהול קטגוריות" />
      <div className="page-content">
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
                <button type="submit" className="btn btn-primary">
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
          {categories.map(cat => (
            <div key={cat.id} className="category-card" style={{ borderColor: cat.color }}>
              <div className="category-color" style={{ background: cat.color }} />
              <span className="category-name">{cat.name}</span>
              {canEdit && (
                <div className="category-actions">
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
