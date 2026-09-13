import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  getDoc,
  setDoc
} from 'firebase/firestore';
import Header from '../Layout/Header';
import CategoryManager from './CategoryManager';
import CalendarDialog from './CalendarDialog';
import EventBank from './EventBank';
import { calendarDateFields, sortCalendarCategories, DEFAULT_EVENT_TEMPLATES } from '../../utils/calendarInteractions';
import EventModal from './EventModal';
import YearlyOverview from './YearlyOverview';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import { usePermissions } from '../../hooks/usePermissions';
import { CalendarDays, ChevronDown, Eye, Plus, Search, Settings } from 'lucide-react';
import { academicYearDisplay, academicYearForDate } from '../../utils/academicYears';
import { schoolCollection } from '../../services/firestore/paths';
import { subscribeInitiativeTimeline } from '../../services/firestore/initiativeRepository';
import { milestoneDate } from '../../utils/initiatives';
import './Gantt.css';

const HEBREW_DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const ALL_DAY_INDICES = [0, 1, 2, 3, 4, 5, 6]; // Sun=0 ... Sat=6
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

const DEFAULT_CATEGORIES = ['כללי'];

const PASTEL_COLORS = [
  '#f4512c', '#94a3b8', '#cbd5e1'
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
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requestedDate = params.get('date');
  const validRequestedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '') && !Number.isNaN(Date.parse(requestedDate)) && new Date(requestedDate).toISOString().slice(0,10) === requestedDate ? requestedDate : '';
  useEffect(() => { if (validRequestedDate) { setYear(Number(validRequestedDate.slice(0,4))); setMonth(Number(validRequestedDate.slice(5,7))-1); } }, [validRequestedDate]);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [bankOpen, setBankOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(params.get('categories') === '1');
  const [templates, setTemplates] = useState(DEFAULT_EVENT_TEMPLATES);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [actionError, setActionError] = useState('');
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState(null);
  const [categoriesReady, setCategoriesReady] = useState(false);
  const tableRef = useRef(null);
  const menuRef = useRef(null);
  const touchDrag = useRef(null);
  const [events, setEvents] = useState([]);
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date());
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
  const [initiativeMilestones, setInitiativeMilestones] = useState([]);
  const [activeAcademicYear, setActiveAcademicYear] = useState(null);
  const [pendingTodayNavigation, setPendingTodayNavigation] = useState(!validRequestedDate);
  const [todayPulse, setTodayPulse] = useState(false);
  const todayCellRef = useRef(null);

  const schoolId = selectedSchool || userData?.schoolId;
  const { permissions } = usePermissions();
  const canEditCalendar = permissions.calendar_edit;
  const hasAccessProfile = Boolean(userData?.accessProfilesBySchool?.[schoolId]);
  const canCreateCalendar = hasAccessProfile ? permissions['calendar.create'] : canEditCalendar;
  const canDeleteCalendar = hasAccessProfile ? permissions['calendar.manageSchoolCalendar'] : canEditCalendar;
  const canViewAllInitiatives = permissions['initiatives.viewAll'] || isGlobalAdmin() || isPrincipal();
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
    const sets = new Map();
    const emit = () => setCalendarTasks([...sets.values()].flat().filter(task => task.dueDate && task.status !== 'done' && task.status !== 'completed'));
    const unsubscribers = [collection(db, `tasks_${schoolId}`), schoolCollection(db, schoolId, 'tasks', 'nested')].map((ref, index) => onSnapshot(ref, snapshot => {
      sets.set(index, snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      emit();
    }, () => { sets.set(index, []); emit(); }));
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  }, [schoolId]);

  useEffect(() => subscribeInitiativeTimeline({
    db,
    schoolId,
    uid: userData?.uid,
    teamIds: userTeamIds,
    canViewAll: canViewAllInitiatives,
    onData: items => setInitiativeMilestones(items.filter(item => !['completed', 'cancelled'].includes(item.status))),
    onError: () => setInitiativeMilestones([]),
  }), [canViewAllInitiatives, schoolId, userData?.uid, userTeamIds]);

  useEffect(() => {
    if (!schoolId) return;
    let unsubscribeYear = () => undefined;
    const unsubscribeSchool = onSnapshot(doc(db, 'schools', schoolId), schoolSnapshot => {
      const activeId = schoolSnapshot.data()?.activeAcademicYearId;
      unsubscribeYear();
      if (!activeId) {
        setActiveAcademicYear(null);
        return;
      }
      unsubscribeYear = onSnapshot(doc(db, `schools/${schoolId}/academicYears`, activeId), yearSnapshot => {
        setActiveAcademicYear(yearSnapshot.exists() ? { id: yearSnapshot.id, ...yearSnapshot.data() } : null);
      }, () => setActiveAcademicYear(null));
    });
    return () => { unsubscribeSchool(); unsubscribeYear(); };
  }, [schoolId]);

  function handleToday() {
    const today = new Date();
    if (!visibleDays.includes(today.getDay())) setVisibleDays(previous => [...previous, today.getDay()].sort((a, b) => a - b));
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDate(today);
    setPendingTodayNavigation(true);
  }

  useEffect(() => {
    if (!pendingTodayNavigation || !categoriesReady) return;
    const frame = requestAnimationFrame(() => {
      const cell = todayCellRef.current;
      if (!cell) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const wrap=tableRef.current;
      const head=wrap.querySelector('thead').getBoundingClientRect().height;
      const top=wrap.scrollTop+cell.getBoundingClientRect().top-wrap.getBoundingClientRect().top-head-18;
      wrap.scrollTo({top:Math.max(0,top),behavior:reduceMotion?'auto':'smooth'});
      cell.focus({ preventScroll: true });
      setTodayPulse(true);
      setPendingTodayNavigation(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [month, pendingTodayNavigation, visibleDays, year, categoriesReady, categories]);

  useEffect(() => {
    if (!todayPulse) return;
    const timeout = window.setTimeout(() => setTodayPulse(false), 1400);
    return () => window.clearTimeout(timeout);
  }, [todayPulse]);

  // Check if a task is visible to the current user
  function isTaskVisible(task) {
    if (isGlobalAdmin() || isPrincipal()) return true;
    if (task.assigneeType === 'all_school') return true;
    if (task.assigneeType === 'team') return userTeamIds.includes(task.assigneeTeamId);
    if (task.assigneeType === 'individual') return (task.assigneeIds || []).includes(userData?.uid);
    if (task.assigneeType === 'participants') return (task.participantIds || []).includes(userData?.uid);
    return true;
  }

  function getTasksForDate(date) {
    const key = dateKey(date);
    return calendarTasks.filter(t => t.dueDate === key && isTaskVisible(t));
  }

  function getMilestonesForDate(date) {
    const key = dateKey(date);
    return initiativeMilestones.filter(item => {
      if (item.dateType === 'range') return item.startDate <= key && key <= item.endDate;
      return milestoneDate(item) === key;
    });
  }

  // Load visible days setting from Firestore
  useEffect(() => {
    if (!schoolId) return;
    async function loadDaySettings() {
      try {
        const docSnap = await getDoc(doc(db, `settings_${schoolId}`, 'calendar'));
        if (docSnap.exists() && Array.isArray(docSnap.data().eventTemplates)) setTemplates(docSnap.data().eventTemplates);
        if (docSnap.exists() && docSnap.data().visibleDays) {
          const todayDay = new Date().getDay();
          const savedDays = docSnap.data().visibleDays;
          setVisibleDays(savedDays.includes(todayDay) ? savedDays : [...savedDays, todayDay].sort((a, b) => a - b));
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
      console.error('Error saving day settings:');
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
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(item => item.status !== 'archived'));
    });
    return unsub;
  }, [schoolId, year, month]);

  useEffect(() => {
    if (!schoolId) return;
    const unsub = onSnapshot(collection(db, `categories_${schoolId}`), (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (docs.length > 0) {
        setCategories(sortCalendarCategories(docs).map(d => d.name));
      } else {
        setCategories(DEFAULT_CATEGORIES);
      }
      setCategoriesReady(true);
    }, () => { setCategoriesReady(true); setActionError('לא ניתן לטעון קטגוריות. נסו לרענן.'); });
    return unsub;
  }, [schoolId]);

  // Filter events based on team visibility
  const canSeeAllEvents = isGlobalAdmin() || isPrincipal();
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
    if (!canCreateCalendar) return;
    setSelectedDate(date);
    setSelectedCategory(category);
    setEditingEvent(null);
    setTemplateDraft(null);
    setModalOpen(true);
  }

  function handleEventClick(e, event) {
    e.stopPropagation();
    if (!canEditCalendar) return;
    setTemplateDraft(null);
    setEditingEvent(event);
    setSelectedDate(null);
    setSelectedCategory(event.category);
    setModalOpen(true);
  }

  async function handleSaveEvent(eventData) {
    if (!(editingEvent ? canEditCalendar : canCreateCalendar) || !schoolId) return;
    if(saving)return;
    setSaving(true);setActionError('');
    try {
      const dated={...eventData,...calendarDateFields(eventData.date)};
      const colRef = collection(db, `events_${schoolId}`);
      if (editingEvent) {
        await updateDoc(doc(db, `events_${schoolId}`, editingEvent.id), dated);
      } else {
        await addDoc(colRef, {
          ...dated,
          createdBy: userData?.uid || '',
          createdAt: new Date().toISOString()
        });
      }
      setModalOpen(false);
    } catch (err) {
      setActionError('האירוע לא נשמר. הטיוטה פתוחה ואפשר לנסות שוב.');
    } finally {setSaving(false);}
  }

  async function handleDeleteEvent() {
    if (!canDeleteCalendar || !editingEvent || !schoolId) return;
    try {
      await deleteDoc(doc(db, `events_${schoolId}`, editingEvent.id));
      setModalOpen(false);
    } catch (err) {
      alert('שגיאה במחיקת האירוע: ');
    }
  }

  async function saveTemplates(next) {
    if(!canEditCalendar || saving)return false;
    setSaving(true);setActionError('');
    try {await setDoc(doc(db, `settings_${schoolId}`, 'calendar'),{eventTemplates:next},{merge:true});setTemplates(next);return true;}
    catch {setActionError('התבניות לא נשמרו. נסו שוב.');return false;} finally {setSaving(false);}
  }
  function openTemplate(template, date=new Date(), category=categories[0]) {
    if(!canCreateCalendar)return;
    setEditingEvent(null);setTemplateDraft({title:template.title,description:template.description || '',color:template.color,date:dateKey(date),category});setSelectedDate(date);setSelectedCategory(category);setBankOpen(false);setModalOpen(true);
  }
  async function dropCalendar(event,date,category) {
    event.preventDefault();event.currentTarget.classList.remove('calendar-drop');
    if(saving)return;
    let payload;try{payload=JSON.parse(event.dataTransfer.getData('application/x-zoko-calendar'));}catch{return;}
    if(payload.templateId){const template=templates.find(item=>item.id===payload.templateId);if(template)openTemplate(template,date,category);return;}
    const item=events.find(item=>item.id===payload.eventId);
    if(!item || !canEditCalendar || !isEventVisible(item))return;
    setSaving(true);setActionError('');
    try {await updateDoc(doc(db,`events_${schoolId}`,item.id),{...calendarDateFields(dateKey(date)),category});}
    catch{setActionError('האירוע לא הועבר. הוא נשאר בתאריך המקורי.');}finally{setSaving(false);}
  }
  function touchHandle(payload) {
    return {
      onPointerDown:event=>{if(event.pointerType!=='touch'||saving)return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);touchDrag.current={payload,target:null};},
      onPointerMove:event=>{const drag=touchDrag.current;if(!drag)return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-calendar-date]');if(drag.target!==target){drag.target?.classList.remove('calendar-drop');target?.classList.add('calendar-drop');drag.target=target;}const wrap=tableRef.current;const bounds=wrap.getBoundingClientRect();wrap.scrollBy({top:event.clientY<bounds.top+35?-22:event.clientY>bounds.bottom-35?22:0,left:event.clientX<bounds.left+35?-22:event.clientX>bounds.right-35?22:0});},
      onPointerUp:event=>{event.stopPropagation();const drag=touchDrag.current;touchDrag.current=null;if(!drag?.target)return;const target=drag.target;target.classList.remove('calendar-drop');dropCalendar({preventDefault(){},currentTarget:target,dataTransfer:{getData:()=>JSON.stringify(drag.payload)}},new Date(target.dataset.calendarDate+'T12:00:00'),target.dataset.calendarCategory);},
      onPointerCancel:()=>{touchDrag.current?.target?.classList.remove('calendar-drop');touchDrag.current=null;},
      onClick:event=>event.stopPropagation(),
    };
  }
  function openMenu(event,date,category,item) {
    event.preventDefault();event.stopPropagation();setTooltip(null);
    setMenu({date,category,item,x:Math.min(event.clientX,window.innerWidth-240),y:Math.min(event.clientY,window.innerHeight-220)});
  }
  useEffect(()=>{if(!menu)return;menuRef.current?.querySelector('button')?.focus();const close=()=>setMenu(null);const key=event=>{if(event.key==='Escape')close();};window.addEventListener('click',close);window.addEventListener('keydown',key);return()=>{window.removeEventListener('click',close);window.removeEventListener('keydown',key);};},[menu]);

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

      {actionError && <p className="calendar-action-error" role="alert">{actionError}</p>}
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
          <button
            className="gantt-today-btn"
            onClick={handleToday}
            title="קפוץ להיום"
          >
            <CalendarDays size={14} />
            היום
          </button>
          <span className="gantt-academic-year" title={activeAcademicYear ? `שנת הלימודים הפעילה במוסד: ${academicYearDisplay(activeAcademicYear)}` : 'שנת הלימודים לפי החודש המוצג'}>
            {academicYearDisplay(academicYearForDate(new Date(year, month, 1)))}
          </span>
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
              className="gantt-select gantt-filter-select"
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
        {canCreateCalendar && <button className="gantt-yearly-btn" aria-expanded={bankOpen} onClick={()=>setBankOpen(!bankOpen)}>{bankOpen?'הסתרת בנק אירועים':'בנק אירועים'}</button>}
        {permissions.categories_view && <button className="gantt-yearly-btn" onClick={()=>setCategoryOpen(true)}>קטגוריות</button>}
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

      <div className="calendar-workspace">
      {bankOpen && <EventBank onClose={()=>setBankOpen(false)} touchHandle={touchHandle} templates={templates} onSave={saveTemplates} onUse={openTemplate} busy={saving} canManage={canEditCalendar}/>}
      <div className="gantt-table-wrap" ref={tableRef}>
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
                        ref={isToday ? todayCellRef : undefined}
                        tabIndex={isToday ? -1 : undefined}
                        aria-current={isToday ? 'date' : undefined}
                        aria-selected={selectedDate ? dateKey(selectedDate) === dateKey(date) : undefined}
                        className={`gantt-date-header-cell ${!isCurrentMonth ? 'gantt-cell--dim' : ''} ${isToday ? 'gantt-cell--today' : ''} ${isToday && todayPulse ? 'gantt-cell--today-pulse' : ''} ${selectedDate && dateKey(selectedDate) === dateKey(date) ? 'gantt-cell--selected' : ''}`}
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
                        {getMilestonesForDate(date).map(item => (
                          <button
                            key={`${item.initiativeId}_${item.id}`}
                            type="button"
                            className={`gantt-milestone-tag ${item.dateType === 'proposed' ? 'gantt-milestone-tag--proposed' : ''}`}
                            title={`${item.dateType === 'proposed' ? 'תאריך מוצע — ' : ''}${item.initiativeTitle}: ${item.title}`}
                            onClick={() => navigate(`/tasks?initiative=${item.initiativeId}`)}
                          >
                            ◆ {item.title}{item.dateType === 'proposed' ? ' (מוצע)' : ''}
                          </button>
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
                          data-calendar-date={dateKey(date)} data-calendar-category={cat}
                          className={`gantt-cell ${!isCurrentMonth ? 'gantt-cell--dim' : ''} ${isToday ? 'gantt-cell--today' : ''} ${isHoliday ? 'gantt-cell--holiday' : ''}`}
                          style={{
                            width: `${(visibleColumnWidths[vi] / totalFlex) * 100}%`,
                            height: rowH
                          }}
                          tabIndex={canCreateCalendar ? 0 : undefined}
                          onKeyDown={event=>{if(event.target!==event.currentTarget)return;if(event.key==='Enter')handleCellClick(date,cat);if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openMenu(event,date,cat);}}
                          onContextMenu={event=>openMenu(event,date,cat)}
                          onDragOver={event=>{if(event.dataTransfer.types.includes('application/x-zoko-calendar')){event.preventDefault();event.currentTarget.classList.add('calendar-drop');}}}
                          onDragLeave={event=>event.currentTarget.classList.remove('calendar-drop')}
                          onDrop={event=>dropCalendar(event,date,cat)}
                          onClick={() => handleCellClick(date, cat)}
                        >
                          <div className="gantt-cell-cat">{cat}</div>
                          {cellEvents.map(ev => (
                            <div
                              key={ev.id}
                              role="button" tabIndex={0}
                              draggable={canEditCalendar && !saving}
                              onDragStart={event=>{event.stopPropagation();setTooltip(null);event.dataTransfer.setData('application/x-zoko-calendar',JSON.stringify({eventId:ev.id}));event.dataTransfer.effectAllowed='move';}}
                              onKeyDown={event=>{if(event.key==='Enter')handleEventClick(event,ev);if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openMenu(event,date,cat,ev);}}
                              onContextMenu={event=>openMenu(event,date,cat,ev)}
                              className={`gantt-event ${searchQuery.trim() ? (ev._searchMatch ? 'gantt-event--highlight' : 'gantt-event--dim') : ''}`}
                              style={{ '--event-color': ev.color || PASTEL_COLORS[0] }}
                              onClick={e => handleEventClick(e, ev)}
                              onMouseEnter={e => handleMouseEnter(e, ev)}
                              onMouseLeave={handleMouseLeave}
                            >
                              {canEditCalendar && <button className="calendar-touch-grip" type="button" aria-label={`גרירת ${ev.title}`} {...touchHandle({eventId:ev.id})}>⠿</button>}{ev.title}
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
      </div>

{menu && <div ref={menuRef} className="calendar-context-menu" role="menu" onKeyDown={event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll('button')];const i=buttons.indexOf(document.activeElement);buttons[(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}} style={{left:Math.max(8,menu.x||8),top:Math.max(8,menu.y||8)}}>
        {menu.item && canEditCalendar && <button role="menuitem" onClick={event=>{handleEventClick(event,menu.item);setMenu(null);}}>עריכת האירוע / שינוי תאריך</button>}
        {menu.item && canCreateCalendar && <button role="menuitem" onClick={()=>openTemplate(menu.item,menu.date,menu.category)}>שכפול האירוע</button>}
        {canCreateCalendar && <button role="menuitem" onClick={()=>handleCellClick(menu.date,menu.category)}>אירוע חדש ביום הזה</button>}
        <button role="menuitem" onClick={()=>setMenu(null)}>סגירה</button>
      </div>}
      {categoryOpen && <CalendarDialog title="קטגוריות לוח שנה" onClose={()=>setCategoryOpen(false)}><CategoryManager/></CalendarDialog>}
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
          event={editingEvent || templateDraft}
          date={selectedDate}
          category={selectedCategory}
          categories={categories}
          colors={PASTEL_COLORS}
          schoolId={schoolId}
          error={actionError}
          saving={saving}
          onSave={handleSaveEvent}
          onDelete={editingEvent && canDeleteCalendar ? handleDeleteEvent : null}
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
