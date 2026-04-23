import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Building2, Search, ChevronLeft } from 'lucide-react';
import './SchoolSelector.css';

export default function SchoolSelector({ onSelect, inline = false }) {
  const { switchSchool, selectedSchool } = useAuth();
  const [schools, setSchools] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSchools() {
      try {
        const snapshot = await getDocs(collection(db, 'schools'));
        const list = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setSchools(list);
      } catch (err) {
        console.error('Failed to fetch schools:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchSchools();
  }, []);

  const filtered = schools.filter((s) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      (s.name && s.name.toLowerCase().includes(term)) ||
      (s.address && s.address.toLowerCase().includes(term))
    );
  });

  function handleSelect(schoolId) {
    switchSchool(schoolId);
    onSelect?.(schoolId);
  }

  // ── Inline (dropdown) mode ──
  if (inline) {
    return (
      <div className="school-selector-inline">
        <div className="school-selector-inline-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="חיפוש מוסד..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="school-selector-inline-list">
          {loading && (
            <div className="school-selector-inline-empty">טוען...</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="school-selector-inline-empty">לא נמצאו מוסדות</div>
          )}
          {filtered.map((school) => (
            <button
              key={school.id}
              className={`school-selector-inline-item${selectedSchool === school.id ? ' active' : ''}`}
              onClick={() => handleSelect(school.id)}
            >
              <Building2 size={14} />
              <span>{school.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Full-page overlay mode ──
  return (
    <div className="school-selector-overlay">
      <div className="school-selector-card">
        <div className="school-selector-header">
          <Building2 size={28} className="school-selector-icon" />
          <h1 className="school-selector-title">בחרו מוסד לעבודה</h1>
          <p className="school-selector-subtitle">
            יש לבחור מוסד לפני שניתן להמשיך
          </p>
        </div>

        <div className="school-selector-search">
          <Search size={16} className="school-selector-search-icon" />
          <input
            type="text"
            className="school-selector-search-input"
            placeholder="חיפוש לפי שם או כתובת..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="school-selector-list">
          {loading && (
            <div className="school-selector-empty">
              <p>טוען רשימת מוסדות...</p>
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="school-selector-empty">
              <p>לא נמצאו מוסדות</p>
            </div>
          )}
          {filtered.map((school) => (
            <button
              key={school.id}
              className={`school-selector-item${selectedSchool === school.id ? ' selected' : ''}`}
              onClick={() => handleSelect(school.id)}
            >
              <div className="school-selector-item-icon">
                <Building2 size={20} />
              </div>
              <div className="school-selector-item-info">
                <span className="school-selector-item-name">{school.name}</span>
                {school.address && (
                  <span className="school-selector-item-address">
                    {school.address}
                  </span>
                )}
              </div>
              {selectedSchool === school.id && (
                <ChevronLeft size={18} className="school-selector-item-check" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
