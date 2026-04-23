import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { X } from 'lucide-react';
import './Gantt.css';

const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

export default function YearlyOverview({ year, schoolId, onClose }) {
  const [monthlyEvents, setMonthlyEvents] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!schoolId) return;
    async function loadAll() {
      const result = {};
      const colRef = collection(db, `events_${schoolId}`);
      const q = query(colRef, where('year', '==', year));
      const snap = await getDocs(q);
      snap.docs.forEach(d => {
        const data = d.data();
        const m = data.month;
        if (!result[m]) result[m] = [];
        result[m].push({ id: d.id, ...data });
      });
      setMonthlyEvents(result);
      setLoading(false);
    }
    loadAll();
  }, [year, schoolId]);

  return (
    <div className="modal-overlay yearly-overlay" onClick={onClose}>
      <div className="yearly-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>מבט שנתי — {year}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="yearly-loading">טוען נתונים...</div>
        ) : (
          <div className="yearly-grid">
            {HEBREW_MONTHS.map((name, i) => {
              const evts = monthlyEvents[i] || [];
              return (
                <div key={i} className="yearly-month">
                  <h4 className="yearly-month-title">{name}</h4>
                  {evts.length === 0 ? (
                    <p className="yearly-empty">אין אירועים</p>
                  ) : (
                    <ul className="yearly-events">
                      {evts.slice(0, 8).map(ev => (
                        <li key={ev.id} className="yearly-event-item">
                          <span
                            className="yearly-event-dot"
                            style={{ background: ev.color || '#bae6fd' }}
                          />
                          <span className="yearly-event-title">{ev.title}</span>
                          {ev.date && (
                            <span className="yearly-event-date">
                              {ev.date.split('-')[2]}
                            </span>
                          )}
                        </li>
                      ))}
                      {evts.length > 8 && (
                        <li className="yearly-more">+{evts.length - 8} נוספים</li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
