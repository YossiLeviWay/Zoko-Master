import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  getDocs,
  getDoc,
  setDoc
} from 'firebase/firestore';
import Header from '../Layout/Header';
import EventModal from './EventModal';
import YearlyOverview from './YearlyOverview';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import { usePermissions } from '../../hooks/usePermissions';
import { ChevronDown, Eye, Plus, Search, Settings } from 'lucide-react';
import './Gantt.css';

const HEBREW_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const ALL_DAY_INDICES = [0, 1, 2, 3, 4, 5, 6]; // Sun=0 ... Sat=6
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

const DEFAULT_CATEGORIES = ['כללי'];

const PASTEL_COLORS = [
  '#fecdd3', '#fed7aa', '#fef08a', '#bbf7d0', '#99f6e4',
  '#bae6fd', '#c4b5fd', '#e9d5ff', '#e2e8f0', '#ffffff'
];

function getWeeksInMonth(year, month) {
  const weeks = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  let current = new Date(firstDay);
  const dayOfWeek = current.getDay();
  current.setDate(current.getDate() - dayOfWeek);

  while (current <= lastDay || weeks.length === 0) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);
    if (current > lastDay && week[6] >= lastDay) break;
  }
  return weeks;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function GanttChart() {
  const { selectedSchool, userData, isGlobalAdmin, isPrincipal } = useAuth();
  const [searchParams] = useSearchParams();
  const now = new Date();
  const paramYear = searchParams.get('year');
  const paramMonth = searchParams.get('month');
  const [year, setYear] = useState(paramYear ? Number(paramYear) : now.getFullYear());
  const [month, setMonth] = useState(paramMonth !== null ? Number(paramMonth) : now.getMonth());
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [categoryDocs, setCategoryDocs] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [yearlyOpen, setYearlyOpen] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [columnWidths, setColumnWidths] = useState([1, 1, 1, 1, 1, 1, 1]);
  const [rowHeights, setRowHeights] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [visibleDays, setVisibleDays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [showDaySettings, setShowDaySettings] = useState(false);
  const [allHolidays, setAllHolidays] = useState([]);
  const [userTeamIds, setUserTeamIds] = useState([]);
  const [calendarTasks, setCalendarTasks] = useState([]);

  const schoolId = selectedSchool || userData?.schoolId;
  const { permissions } = usePermissions();
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);

  // Load user's team memberships for visibility filtering
  useEffect(() => {
    if (!schoolId || !userData?.uid) return;
    const unsub = onSnapshot(collection(db, `teams_${schoolId}`), (snap) => {
      const memberTeams = [];
      snap.docs.forEach(d => {
        const data = d.data();
        if (Array.isArray(data.memberIds) && data.memberIds.includes(userData.uid)) {
          memberTeams.push(d.id);
        }
      });
      setUserTeamIds(memberTeams);
    }, () => setUserTeamIds([]));
    return unsub;
  }, [schoolId, userData?.uid]);

  // Load tasks with due dates for calendar display
  useEffect(() => {
    if (!schoolId) return;
    const q = query(collection(db, `tasks_${schoolId}`));
    const unsub = onSnapshot(q, (snap) => {
      const tasks = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(t => t.dueDate && t.status !== 'done' && t.status !== 'completed');
      setCalendarTasks(tasks);
    }, () => setCalendarTasks([]));
    return unsub;
  }, [schoolId]);

  // Check if a task is visible to the current user
  function isTaskVisible(task) {
    if (isGlobalAdmin() || isPrincipal()) return true;
    if (task.assigneeType === 'all_school') return true;
    if (task.assigneeType === 'team') return userTeamIds.includes(task.assigneeTeamId);
    if (task.assigneeType === 'individual') return (task.assigneeIds || []).includes(userData?.uid);
    return true;
  }

  function getTasksForDate(date) {
    const key = dateKey(date);
    return calendarTasks.filter(t => t.dueDate === key && isTaskVisible(t));
  }

  // Load visible days setting from Firestore
  useEffect(() => {
    if (!schoolId) return;
    async function loadDaySettings() {
      try {
        const docSnap = await getDoc(doc(db, `settings_${schoolId}`, 'calendar'));
        if (docSnap.exists() && docSnap.data().visibleDays) {
          setVisibleDays(docSnap.data().visibleDays);
        }
      } catch {}
    }
    loadDaySettings();
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const q = query(collection(db, `holidays_${schoolId}`));
    const unsub = onSnapshot(q, (snap) => {
      setAllHolidays(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setAllHolidays([]));
    return unsub;
  }, [schoolId]);

  async function saveDaySettings(days) {
    setVisibleDays(days);
    if (!schoolId) return;
    try {
      await setDoc(doc(db, `settings_${schoolId}`, 'calendar'), { visibleDays: days }, { merge: true });
    } catch (err) {
      console.error('Error saving day settings:', err);
    }
  }

  function toggleDay(dayIndex) {
    const newDays = visibleDays.includes(dayIndex)
      ? visibleDays.filter(d => d !== dayIndex)
      : [...visibleDays, dayIndex].sort((a, b) => a - b);
    if (newDays.length === 0) return; // must have at least 1 day
    saveDaySettings(newDays);
  }
  const holidays = allHolidays.filter(h => {
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 0);
    const start = new Date(h.startDate + 'T00:00:00');
    const end = new Date((h.endDate || h.startDate) + 'T00:00:00');
    return start <= monthEnd && end >= monthStart;
  });

  // Build a map of holidays by date key
  const holidaysByDate = {};
  holidays.forEach(h => {
    const start = new Date(h.startDate);
    const end = new Date(h.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = dateKey(d);
      if (!holidaysByDate[key]) holidaysByDate[key] = [];
      holidaysByDate[key].push(h);
    }
  });

  useEffect(() => {
    if (!schoolId) return;
    const colRef = collection(db, `events_${schoolId}`);
    const q = query(
      colRef,
      where('year', '==', year),
      where('month', '==', month)
    );
    const unsub = onSnapshot(q, (snap) => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId, year, month]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `categories_${schoolId}`), (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCategoryDocs(docs);
      if (docs.length > 0) {
        setCategories(docs.map(d => d.name));
      } else {
        setCategories(DEFAULT_CATEGORIES);
      }
    });
    return unsub;
  }, [schoolId]);

  // Filter events based on team visibility
  const canSeeAllEvents = isGlobalAdmin() || isPrincipal();
  const canEditCalendar = permissions.calendar_edit;

  function isEventVisible(event) {
    if (canSeeAllEvents) return true;
    if (!event.visibleTo || event.visibleTo === 'all') return true;
    if (Array.isArray(event.visibleTo)) {
      return event.visibleTo.some(teamId => userTeamIds.includes(teamId));
    }
    return true;
  }

  function getEventsForCell(date, category) {
    const key = dateKey(date);
    const cellEvents = events
      .filter(e => e.date === key && e.category === category)
      .filter(isEventVisible);
    if (!searchQuery.trim()) return cellEvents;
    const q = searchQuery.toLowerCase();
    return cellEvents.map(e => ({
      ...e,
      _searchMatch: (e.title || '').toLowerCase().includes(q) ||
                     (e.description || '').toLowerCase().includes(q)
    }));
  }

  // Filter categories based on filter
  const displayCategories = filterCategory === 'all'
    ? categories
    : categories.filter(c => c === filterCategory);

  function getHolidaysForCell(date) {
    return holidaysByDate[dateKey(date)] || [];
  }

  function handleCellClick(date, category) {
    setSelectedDate(date);
    setSelectedCategory(category);
    setEditingEvent(null);
    setModalOpen(true);
  }

  function handleEventClick(e, event) {
    e.stopPropagation();
    setEditingEvent(event);
    setSelectedDate(null);
    setSelectedCategory(event.category);
    setModalOpen(true);
  }

  async function handleSaveEvent(eventData) {
    if (!schoolId) return;
    try {
      const colRef = collection(db, `events_${schoolId}`);
      if (editingEvent) {
        await updateDoc(doc(db, `events_${schoolId}`, editingEvent.id), eventData);
      } else {
        await addDoc(colRef, {
          ...eventData,
          year,
          month,
          createdBy: userData?.uid || '',
          createdAt: new Date().toISOString()
        });
      }
      setModalOpen(false);
    } catch (err) {
      console.error('Error saving event:', err);
      alert('שגיאה בשמירת האירוע: ' + err.message);
    }
  }

  async function handleDeleteEvent() {
    if (!editingEvent || !schoolId) return;
    try {
      await deleteDoc(doc(db, `events_${schoolId}`, editingEvent.id));
      setModalOpen(false);
    } catch (err) {
      alert('שגיאה במחיקת האירוע: ' + err.message);
    }
  }

  function handleMouseEnter(e, event) {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      event
    });
  }

  function handleMouseLeave() {
    setTooltip(null);
  }

  const handleColumnResize = useCallback((index, e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columnWidths[index];

    function onMouseMove(ev) {
      const diff = (ev.clientX - startX) / 100;
      setColumnWidths(prev => {
        const next = [...prev];
        next[index] = Math.max(0.4, startWidth + diff);
        return next;
      });
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [columnWidths]);

  const handleRowResize = useCallback((rowKey, e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = rowHeights[rowKey] || 42;

    function onMouseMove(ev) {
      const diff = ev.clientY - startY;
      setRowHeights(prev => ({
        ...prev,
        [rowKey]: Math.max(28, startHeight + diff)
      }));
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [rowHeights]);

  const weeks = getWeeksInMonth(year, month);
  const visibleColumnWidths = visibleDays.map(di => columnWidths[di] || 1);
  const totalFlex = visibleColumnWidths.reduce((a, b) => a + b, 0);

  // Count search matches for feedback (respecting visibility)
  const searchMatchCount = searchQuery.trim()
    ? events.filter(e => {
        if (!isEventVisible(e)) return false;
        const q = searchQuery.toLowerCase();
        return (e.title || '').toLowerCase().includes(q) ||
               (e.description || '').toLowerCase().includes(q);
      }).length
    : 0;

  const years = [];
  for (let y = year - 3; y <= year + 3; y++) years.push(y);

  return (
    <div className="gantt-page">
      <Header title="לוח שנה" onPermissions={() => setShowPermissionsPanel(true)} />
      {showPermissionsPanel && <PagePermissionsPanel feature="calendar" onClose={() => setShowPermissionsPanel(false)} />}

      <div className="gantt-controls">
        <div className="gantt-nav">
          <div className="gantt-select-wrap">
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="gantt-select"
            >
              {HEBREW_MONTHS.map((m, i) => (
                <option key={i} value={i}>{m}</option>
              ))}
            </select>
            <ChevronDown size={14} className="gantt-select-icon" />
          </div>
          <div className="gantt-select-wrap">
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="gantt-select"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <ChevronDown size={14} className="gantt-select-icon" />
          </div>
        </div>
        <div className="gantt-controls-actions">
          <div className="search-bar" style={{ minWidth: 140 }}>
            <Search size={14} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="חיפוש אירוע..."
              style={{ fontSize: '0.78rem' }}
            />
            {searchQuery.trim() && (
              <span className="search-count">{searchMatchCount} תוצאות</span>
            )}
          </div>
          {categories.length > 1 && (
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              style={{ padding: '0.35rem 0.5rem', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: '0.78rem', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}
            >
              <option value="all">כל הקטגוריות</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}
          {holidays.length > 0 && (
            <div className="gantt-holiday-badge">
              {holidays.length} חגים/חופשות
            </div>
          )}
          <button className="gantt-yearly-btn" onClick={() => setShowDaySettings(!showDaySettings)} title="בחירת ימים">
            <Settings size={16} />
            ימים
          </button>
          <button className="gantt-yearly-btn" onClick={() => setYearlyOpen(true)}>
            <Eye size={16} />
            מבט שנתי
          </button>
        </div>
      </div>

      {showDaySettings && (
        <div className="gantt-day-settings">
          <span className="gantt-day-settings-label">בחרו את הימים שיוצגו בלוח:</span>
          <div className="gantt-day-toggles">
            {ALL_DAY_INDICES.map(di => (
              <button
                key={di}
                className={`gantt-day-toggle ${visibleDays.includes(di) ? 'gantt-day-toggle--active' : ''}`}
                onClick={() => toggleDay(di)}
              >
                {HEBREW_DAYS[di]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="gantt-table-wrap">
        <table className="gantt-table">
          <thead>
            <tr>
              <th className="gantt-category-col">שבוע / קטגוריה</th>
              {visibleDays.map((di, vi) => (
                <th
                  key={di}
                  className="gantt-day-col"
                  style={{ width: `${(visibleColumnWidths[vi] / totalFlex) * 100}%` }}
                >
                  <div className="gantt-day-header">
                    <span>{HEBREW_DAYS[di]}</span>
                    <div
                      className="gantt-resize-handle"
                      onMouseDown={e => handleColumnResize(di, e)}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => {
              const weekStart = week[0].getDate();
              const weekEnd = week[6].getDate();
              const label = `${weekStart}-${weekEnd}`;

              return [
                // Date header row for this week
                <tr key={`dates-${wi}`} className="gantt-week-dates-row">
                  <td className="gantt-category-cell gantt-week-label" rowSpan={displayCategories.length + 1}>
                    <div className="gantt-week-num">שבוע {wi + 1}</div>
                    <div className="gantt-week-dates">{label}</div>
                  </td>
                  {visibleDays.map((di, vi) => {
                    const date = week[di];
                    const isCurrentMonth = date.getMonth() === month;
                    const isToday = dateKey(date) === dateKey(new Date());
                    return (
                      <td
                        key={di}
                        className={`gantt-date-header-cell ${!isCurrentMonth ? 'gantt-cell--dim' : ''} ${isToday ? 'gantt-cell--today' : ''}`}
                        style={{ width: `${(visibleColumnWidths[vi] / totalFlex) * 100}%` }}
                      >
                        {(getHolidaysForCell(date)).length > 0 && (
                          <div className="gantt-holiday-tag" title={getHolidaysForCell(date).map(h => h.name).join(', ')}>
                            {getHolidaysForCell(date)[0].name}
                          </div>
                        )}
                        {getTasksForDate(date).map(task => (
                          <div
                            key={task.id}
                            className="gantt-task-tag"
                            title={`משימה: ${task.title}`}
                          >
                            ✓ {task.title}
                          </div>
                        ))}
                        <span className="gantt-date-header-num">{date.getDate()}</span>
                        <span className="gantt-date-header-full">{date.toLocaleDateString('he-IL', { month: '2-digit', year: 'numeric' })}</span>
                      </td>
                    );
                  })}
                </tr>,
                // Category rows
                ...displayCategories.map((cat, ci) => {
                const rowKey = `${wi}-${ci}`;
                const rowH = rowHeights[rowKey] || 42;

                return (
                  <tr key={rowKey} className={ci === 0 ? 'gantt-week-start' : ''}>
                    {visibleDays.map((di, vi) => {
                      const date = week[di];
                      const isCurrentMonth = date.getMonth() === month;
                      const isToday = dateKey(date) === dateKey(new Date());
                      const cellEvents = getEventsForCell(date, cat);
                      const isHoliday = (holidaysByDate[dateKey(date)] || []).some(h => h.isVacation && !h.isSchoolDay);
                      const isLastVisible = vi === visibleDays.length - 1;

                      return (
                        <td
                          key={di}
                          className={`gantt-cell ${!isCurrentMonth ? 'gantt-cell--dim' : ''} ${isToday ? 'gantt-cell--today' : ''} ${isHoliday ? 'gantt-cell--holiday' : ''}`}
                          style={{
                            width: `${(visibleColumnWidths[vi] / totalFlex) * 100}%`,
                            height: rowH
                          }}
                          onClick={() => handleCellClick(date, cat)}
                        >
                          <div className="gantt-cell-cat">{cat}</div>
                          {cellEvents.map(ev => (
                            <div
                              key={ev.id}
                              className={`gantt-event ${searchQuery.trim() ? (ev._searchMatch ? 'gantt-event--highlight' : 'gantt-event--dim') : ''}`}
                              style={{ background: ev.color || PASTEL_COLORS[0] }}
                              onClick={e => handleEventClick(e, ev)}
                              onMouseEnter={e => handleMouseEnter(e, ev)}
                              onMouseLeave={handleMouseLeave}
                            >
                              {ev.title}
                            </div>
                          ))}
                          {isLastVisible && (
                            <div
                              className="gantt-row-resize-handle"
                              onMouseDown={e => handleRowResize(rowKey, e)}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
              ];
            })}
          </tbody>
        </table>
      </div>

      {tooltip && (
        <div
          className="gantt-tooltip"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <strong>{tooltip.event.title}</strong>
          {tooltip.event.time && <span>{tooltip.event.time}</span>}
          {tooltip.event.description && <p>{tooltip.event.description}</p>}
        </div>
      )}

      {modalOpen && (
        <EventModal
          event={editingEvent}
          date={selectedDate}
          category={selectedCategory}
          categories={categories}
          colors={PASTEL_COLORS}
          schoolId={schoolId}
          onSave={handleSaveEvent}
          onDelete={editingEvent ? handleDeleteEvent : null}
          onClose={() => setModalOpen(false)}
        />
      )}

      {yearlyOpen && (
        <YearlyOverview
          year={year}
          schoolId={schoolId}
          onClose={() => setYearlyOpen(false)}
        />
      )}
    </div>
  );
}
