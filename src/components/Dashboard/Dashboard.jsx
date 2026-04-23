import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  updateDoc,
  doc,
  arrayUnion,
  arrayRemove,
  onSnapshot
} from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import Header from '../Layout/Header';
import { Calendar, CheckSquare, Users, Clock, Star, BookOpen, CheckCircle, XCircle, UserCheck, Activity, School, UserPlus, Shield, Megaphone, FileText, BarChart3, SlidersHorizontal, ArrowUpDown, Plus, X, GripVertical, Maximize2, Minimize2, Trash2, Eye, PlusCircle, Columns } from 'lucide-react';
import './Dashboard.css';

const WIDGET_TYPES = {
  my_tasks: { label: 'המשימות שלי', icon: CheckSquare, defaultSize: 'full' },
  events: { label: 'אירועים קרובים', icon: Calendar, defaultSize: 'half' },
  holidays: { label: 'חגים וחופשות', icon: Star, defaultSize: 'half' },
  announcements: { label: 'הודעות אחרונות', icon: Megaphone, defaultSize: 'full' },
  team_activity: { label: 'פעילות צוות', icon: Users, defaultSize: 'half' },
  file_tracker: { label: 'מעקב קבצים', icon: FileText, defaultSize: 'half' },
  upcoming_week: { label: 'השבוע הקרוב', icon: Calendar, defaultSize: 'full' },
  staff_tasks: { label: 'משימות שהוסיפו אנשי צוות', icon: UserPlus, defaultSize: 'half' },
};

const DEFAULT_WIDGETS = [
  { type: 'my_tasks', size: 'full' },
  { type: 'announcements', size: 'full' },
  { type: 'events', size: 'half' },
  { type: 'holidays', size: 'half' },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 17) return 'צהריים טובים';
  return 'ערב טוב';
}

function formatHebrewDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
  });
}

function getDaysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const diff = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
  if (diff === 0) return 'היום';
  if (diff === 1) return 'מחר';
  return `בעוד ${diff} ימים`;
}

function formatActivityDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'היום';
  if (diffDays === 1) return 'אתמול';
  if (diffDays < 7) return `לפני ${diffDays} ימים`;
  if (diffDays < 30) return `לפני ${Math.floor(diffDays / 7)} שבועות`;
  return date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

const HOLIDAY_TYPE_LABELS = {
  jewish: 'יהודי',
  muslim: 'מוסלמי',
  christian: 'נוצרי',
  druze: 'דרוזי',
  national: 'לאומי',
};

const HOLIDAY_BORDER_COLORS = {
  jewish: '#f59e0b',
  muslim: '#10b981',
  christian: '#3b82f6',
  druze: '#8b5cf6',
  national: '#2563eb',
};

export default function Dashboard() {
  const { currentUser, userData, selectedSchool, isGlobalAdmin, isPrincipal, isPending, approveUser, rejectUser } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [taskStats, setTaskStats] = useState({ total: 0, pending: 0, completed: 0, overdue: 0 });
  const [staffCount, setStaffCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [holidays, setHolidays] = useState([]);
  const [todayHolidays, setTodayHolidays] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [schools, setSchools] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [schoolStats, setSchoolStats] = useState([]);
  const [systemSummary, setSystemSummary] = useState({ totalUsers: 0, totalFiles: 0, totalTasks: 0, totalSchools: 0 });
  const [allSchoolEvents, setAllSchoolEvents] = useState([]);
  const [recentAnnouncements, setRecentAnnouncements] = useState([]);
  const [announcementTeams, setAnnouncementTeams] = useState([]);

  // Personal tasks
  const [myTasks, setMyTasks] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [taskSortBy, setTaskSortBy] = useState('priority'); // 'priority' | 'dueDate'

  // Widget management
  const [widgets, setWidgets] = useState(DEFAULT_WIDGETS);
  const [widgetContextMenu, setWidgetContextMenu] = useState(null); // { x, y, widgetIdx }
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [addWidgetPos, setAddWidgetPos] = useState({ x: 0, y: 0 });

  // Team activity & file tracking
  const [teamActivity, setTeamActivity] = useState([]);
  const [trackedFiles, setTrackedFiles] = useState([]);
  const [weekTasks, setWeekTasks] = useState([]);
  const [staffTaskActivity, setStaffTaskActivity] = useState([]);

  // Filter preferences state
  const [showEventsFilter, setShowEventsFilter] = useState(false);
  const [showHolidaysFilter, setShowHolidaysFilter] = useState(false);
  const [hiddenEventCategories, setHiddenEventCategories] = useState([]);
  const [hiddenHolidayTypes, setHiddenHolidayTypes] = useState([]);
  const [pendingHiddenEventCategories, setPendingHiddenEventCategories] = useState([]);
  const [pendingHiddenHolidayTypes, setPendingHiddenHolidayTypes] = useState([]);

  const HOLIDAY_TYPES = ['jewish', 'muslim', 'christian', 'druze', 'national'];

  // Load dashboard preferences from userData on mount/change
  useEffect(() => {
    const prefs = userData?.dashboardPreferences;
    if (prefs) {
      setHiddenEventCategories(prefs.hiddenEventCategories || []);
      setHiddenHolidayTypes(prefs.hiddenHolidayTypes || []);
    } else {
      setHiddenEventCategories([]);
      setHiddenHolidayTypes([]);
    }
  }, [userData?.dashboardPreferences]);

  // Load widget config from userData
  useEffect(() => {
    const savedWidgets = userData?.dashboardPreferences?.widgets;
    if (savedWidgets && Array.isArray(savedWidgets) && savedWidgets.length > 0) {
      setWidgets(savedWidgets);
    }
  }, [userData?.dashboardPreferences?.widgets]);

  async function saveWidgets(newWidgets) {
    setWidgets(newWidgets);
    if (!currentUser) return;
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        'dashboardPreferences.widgets': newWidgets,
      });
    } catch (err) {
      console.error('Error saving widget config:', err);
    }
  }

  function addWidget(type) {
    const config = WIDGET_TYPES[type];
    if (!config) return;
    const newWidgets = [...widgets, { type, size: config.defaultSize }];
    saveWidgets(newWidgets);
    setShowAddWidget(false);
  }

  function removeWidget(idx) {
    const newWidgets = widgets.filter((_, i) => i !== idx);
    saveWidgets(newWidgets);
    setWidgetContextMenu(null);
  }

  function resizeWidget(idx, newSize) {
    const newWidgets = [...widgets];
    newWidgets[idx] = { ...newWidgets[idx], size: newSize };
    saveWidgets(newWidgets);
    setWidgetContextMenu(null);
  }

  function moveWidget(idx, direction) {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= widgets.length) return;
    const newWidgets = [...widgets];
    [newWidgets[idx], newWidgets[newIdx]] = [newWidgets[newIdx], newWidgets[idx]];
    saveWidgets(newWidgets);
    setWidgetContextMenu(null);
  }

  function handleDashboardContextMenu(e) {
    e.preventDefault();
    setAddWidgetPos({ x: Math.min(e.clientX, window.innerWidth - 220), y: Math.min(e.clientY, window.innerHeight - 300) });
    setShowAddWidget(true);
    setWidgetContextMenu(null);
  }

  function handleWidgetContextMenu(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    setWidgetContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 250),
      widgetIdx: idx
    });
    setShowAddWidget(false);
  }

  // Close context menus on click
  useEffect(() => {
    function handleClick() { setWidgetContextMenu(null); setShowAddWidget(false); }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Load team activity (recent tasks created by team members)
  useEffect(() => {
    if (!selectedSchool || !currentUser?.uid) return;
    const userTeamIds = myTeams.filter(t => Array.isArray(t.memberIds) && t.memberIds.includes(currentUser.uid)).map(t => t.id);
    if (userTeamIds.length === 0) { setTeamActivity([]); return; }
    const teamMemberIds = new Set();
    myTeams.filter(t => userTeamIds.includes(t.id)).forEach(t => (t.memberIds || []).forEach(id => teamMemberIds.add(id)));
    const q = query(collection(db, `tasks_${selectedSchool}`), orderBy('createdAt', 'desc'), limit(20));
    const unsub = onSnapshot(q, (snap) => {
      const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStaffTaskActivity(tasks.slice(0, 10));
      // Filter to tasks by team members
      const teamTasks = tasks.filter(t => {
        if (t.assigneeType === 'team' && userTeamIds.includes(t.assigneeTeamId)) return true;
        return false;
      });
      setTeamActivity(teamTasks.slice(0, 8));
    }, () => setTeamActivity([]));
    return unsub;
  }, [selectedSchool, currentUser?.uid, myTeams]);

  // Load tracked files (recently modified files accessible to user)
  useEffect(() => {
    if (!selectedSchool) return;
    const q = query(collection(db, `files_${selectedSchool}`), orderBy('lastModified', 'desc'), limit(10));
    const unsub = onSnapshot(q, (snap) => {
      setTrackedFiles(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(f => f.lastModified));
    }, () => setTrackedFiles([]));
    return unsub;
  }, [selectedSchool]);

  // Load upcoming week events
  useEffect(() => {
    if (!selectedSchool) return;
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextWeekStr = nextWeek.toISOString().split('T')[0];
    const q = query(collection(db, `events_${selectedSchool}`), where('date', '>=', todayStr), where('date', '<=', nextWeekStr), orderBy('date', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setWeekTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => setWeekTasks([]));
    return unsub;
  }, [selectedSchool]);

  // Save filter preferences to Firestore
  async function saveFilterPreferences(newHiddenEvents, newHiddenHolidays) {
    if (!currentUser) return;
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        'dashboardPreferences.hiddenEventCategories': newHiddenEvents,
        'dashboardPreferences.hiddenHolidayTypes': newHiddenHolidays,
      });
      setHiddenEventCategories(newHiddenEvents);
      setHiddenHolidayTypes(newHiddenHolidays);
    } catch (err) {
      console.error('Error saving filter preferences:', err);
    }
  }

  // Get unique event categories from current events
  const eventCategories = [...new Set(events.map(e => e.category).filter(Boolean))];

  // Filtered events and holidays
  const filteredEvents = events.filter(e => !e.category || !hiddenEventCategories.includes(e.category));
  const filteredHolidays = holidays.filter(h => !h.type || !hiddenHolidayTypes.includes(h.type));
  const filteredTodayHolidays = todayHolidays.filter(h => !h.type || !hiddenHolidayTypes.includes(h.type));

  // Close filter popups when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (showEventsFilter && !e.target.closest('.filter-popup-container')) {
        setShowEventsFilter(false);
      }
      if (showHolidaysFilter && !e.target.closest('.filter-popup-container')) {
        setShowHolidaysFilter(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEventsFilter, showHolidaysFilter]);

  useEffect(() => {
    if (!selectedSchool) return;
    const q = query(collection(db, `holidays_${selectedSchool}`));
    const unsub = onSnapshot(q, (snap) => {
      const allH = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Upcoming holidays (next 5 from today)
      const upcoming = allH
        .filter(h => (h.endDate || h.startDate) >= todayStr)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 5);
      setHolidays(upcoming);

      const todayMatches = upcoming.filter(h => h.startDate <= todayStr && (h.endDate || h.startDate) >= todayStr);
      setTodayHolidays(todayMatches);
    }, () => {
      setHolidays([]);
      setTodayHolidays([]);
    });
    return unsub;
  }, [selectedSchool]);

  // Load user's teams for task filtering
  useEffect(() => {
    if (!selectedSchool || !currentUser?.uid) return;
    const unsub = onSnapshot(collection(db, `teams_${selectedSchool}`), (snap) => {
      const allTeams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setMyTeams(allTeams);
    }, () => setMyTeams([]));
    return unsub;
  }, [selectedSchool, currentUser?.uid]);

  // Load tasks assigned to current user
  useEffect(() => {
    if (!selectedSchool || !currentUser?.uid) return;
    const q = query(collection(db, `tasks_${selectedSchool}`), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter tasks assigned to current user
      const userTeamIds = myTeams.filter(t => Array.isArray(t.memberIds) && t.memberIds.includes(currentUser.uid)).map(t => t.id);
      const filtered = allTasks.filter(task => {
        if (task.status === 'done' || task.status === 'completed') return false;
        if (task.assigneeType === 'all_school') return true;
        if (task.assigneeType === 'team') return userTeamIds.includes(task.assigneeTeamId);
        if (task.assigneeType === 'individual') return (task.assigneeIds || []).includes(currentUser.uid);
        return true; // fallback for old tasks without assigneeType
      });
      setMyTasks(filtered);
    }, () => setMyTasks([]));
    return unsub;
  }, [selectedSchool, currentUser?.uid, myTeams]);

  // Sort personal tasks
  const sortedMyTasks = [...myTasks].sort((a, b) => {
    if (taskSortBy === 'priority') {
      const pOrder = { high: 0, medium: 1, low: 2 };
      return (pOrder[a.priority] ?? 1) - (pOrder[b.priority] ?? 1);
    }
    // Sort by due date (no date = last)
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  function getTaskTeamName(task) {
    if (task.assigneeType === 'all_school') return 'כל בית הספר';
    if (task.assigneeType === 'team') {
      const team = myTeams.find(t => t.id === task.assigneeTeamId);
      return team?.name || 'צוות';
    }
    return 'אישי';
  }

  // Load schools list for mapping IDs to names
  useEffect(() => {
    async function loadSchools() {
      try {
        const snap = await getDocs(collection(db, 'schools'));
        setSchools(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error loading schools:', err);
      }
    }
    loadSchools();
  }, []);

  // Load recent announcements for dashboard
  useEffect(() => {
    if (!selectedSchool) return;
    const q = query(
      collection(db, 'announcements'),
      orderBy('createdAt', 'desc'),
      limit(3)
    );
    const unsub = onSnapshot(q, (snap) => {
      let anns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Filter: show announcements for target='all' or matching schoolId
      if (!isGlobalAdmin()) {
        anns = anns.filter(a => a.target === 'all' || a.schoolId === selectedSchool);
      }
      setRecentAnnouncements(anns.slice(0, 3));
    }, (err) => {
      console.error('Error loading announcements for dashboard:', err);
    });
    return unsub;
  }, [selectedSchool]);

  // Load teams for resolving team names in announcements
  useEffect(() => {
    if (!selectedSchool) return;
    async function loadTeams() {
      try {
        const snap = await getDocs(collection(db, `teams_${selectedSchool}`));
        setAnnouncementTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error('Error loading teams for dashboard:', err);
      }
    }
    loadTeams();
  }, [selectedSchool]);

  // Fetch pending users for admin/principal
  useEffect(() => {
    if (!isGlobalAdmin() && !isPrincipal()) {
      setPendingUsers([]);
      return;
    }

    async function fetchPendingUsers() {
      try {
        if (isGlobalAdmin()) {
          // Admin sees ALL pending users across all schools
          const usersRef = collection(db, 'users');
          const snap = await getDocs(usersRef);
          const pending = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(u => u.pendingSchools && u.pendingSchools.length > 0);
          setPendingUsers(pending);
        } else if (isPrincipal() && selectedSchool) {
          // Principal sees only pending users for their school(s)
          const userSchools = userData?.schoolIds || [];
          const schoolId = selectedSchool || (userSchools.length > 0 ? userSchools[0] : userData?.schoolId);
          if (schoolId) {
            const q = query(collection(db, 'users'), where('pendingSchools', 'array-contains', schoolId));
            const snap = await getDocs(q);
            setPendingUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
          }
        }
      } catch (err) {
        console.error('Error fetching pending users:', err);
      }
    }

    fetchPendingUsers();
  }, [selectedSchool, userData]);

  // Activity feed for global admin - shows significant events across all schools
  useEffect(() => {
    if (!isGlobalAdmin()) return;

    async function fetchActivityFeed() {
      setActivityLoading(true);
      try {
        const feed = [];
        const schoolsSnap = await getDocs(collection(db, 'schools'));
        const allSchools = schoolsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 1. Recently added schools
        for (const school of allSchools) {
          if (school.createdAt) {
            feed.push({
              type: 'new_school',
              icon: 'school',
              text: `בית ספר חדש נוסף: ${school.name || school.id}`,
              date: school.createdAt,
              schoolName: school.name || school.id,
            });
          }
        }

        // 2. Recently added staff (principals, editors) across all schools
        const usersSnap = await getDocs(collection(db, 'users'));
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        for (const user of allUsers) {
          if (!user.createdAt) continue;
          const userSchoolIds = user.schoolIds || (user.schoolId ? [user.schoolId] : []);
          const schoolNames = userSchoolIds
            .map(sid => allSchools.find(s => s.id === sid)?.name || sid)
            .filter(Boolean);
          const schoolLabel = schoolNames.length > 0 ? schoolNames.join(', ') : '';

          if (user.role === 'principal') {
            feed.push({
              type: 'new_principal',
              icon: 'principal',
              text: `מנהל חדש נוסף: ${user.fullName}`,
              detail: schoolLabel ? `ב${schoolLabel}` : '',
              date: user.createdAt,
              schoolName: schoolLabel,
            });
          } else if (user.role === 'editor') {
            feed.push({
              type: 'new_editor',
              icon: 'staff',
              text: `עורך חדש נוסף: ${user.fullName}`,
              detail: schoolLabel ? `ב${schoolLabel}` : '',
              date: user.createdAt,
              schoolName: schoolLabel,
            });
          } else if (user.role !== 'global_admin') {
            feed.push({
              type: 'new_staff',
              icon: 'staff',
              text: `איש צוות חדש: ${user.fullName}`,
              detail: schoolLabel ? `ב${schoolLabel}` : '',
              date: user.createdAt,
              schoolName: schoolLabel,
            });
          }
        }

        // 3. Per-school summary stats
        const statsArr = [];
        const today = new Date().toISOString().split('T')[0];
        let totalFiles = 0;
        let totalTasks = 0;
        for (const school of allSchools) {
          const staffList = allUsers.filter(u => {
            const sids = u.schoolIds || [];
            return sids.includes(school.id) || u.schoolId === school.id;
          });
          const principalCount = staffList.filter(u => u.role === 'principal').length;
          let eventCount = 0;
          let taskCount = 0;
          let fileCount = 0;
          let lastActivity = school.createdAt || '';
          try {
            const evSnap = await getDocs(query(collection(db, `events_${school.id}`), where('date', '>=', today)));
            eventCount = evSnap.size;
          } catch (e) { /* collection may not exist */ }
          try {
            const tkSnap = await getDocs(collection(db, `tasks_${school.id}`));
            taskCount = tkSnap.size;
            tkSnap.docs.forEach(d => {
              const t = d.data();
              if (t.createdAt && t.createdAt > lastActivity) lastActivity = t.createdAt;
              if (t.updatedAt && t.updatedAt > lastActivity) lastActivity = t.updatedAt;
            });
          } catch (e) { /* collection may not exist */ }
          try {
            const flSnap = await getDocs(collection(db, `files_${school.id}`));
            fileCount = flSnap.size;
            flSnap.docs.forEach(d => {
              const f = d.data();
              if (f.createdAt && f.createdAt > lastActivity) lastActivity = f.createdAt;
            });
          } catch (e) { /* collection may not exist */ }
          // Check staff creation dates for last activity
          staffList.forEach(u => {
            if (u.createdAt && u.createdAt > lastActivity) lastActivity = u.createdAt;
          });
          totalFiles += fileCount;
          totalTasks += taskCount;
          statsArr.push({
            id: school.id,
            name: school.name || school.id,
            staffCount: staffList.length,
            principalCount,
            eventCount,
            taskCount,
            fileCount,
            lastActivity,
            createdAt: school.createdAt || '',
          });
        }
        setSchoolStats(statsArr);
        setSystemSummary({
          totalSchools: allSchools.length,
          totalUsers: allUsers.filter(u => u.role !== 'global_admin').length,
          totalFiles,
          totalTasks,
        });

        // 4. Fetch recent events across all schools
        const allEvents = [];
        for (const school of allSchools) {
          try {
            const eventsRef = collection(db, `events_${school.id}`);
            const eventsQuery = query(eventsRef, where('date', '>=', today), orderBy('date', 'asc'), limit(5));
            const eventsSnap = await getDocs(eventsQuery);
            eventsSnap.docs.forEach(d => {
              allEvents.push({
                ...d.data(),
                id: d.id,
                schoolId: school.id,
                schoolName: school.name || school.id,
              });
            });
          } catch (e) {
            // Collection may not exist
          }
        }
        allEvents.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        setAllSchoolEvents(allEvents.slice(0, 15));

        // Sort by date descending, take latest 20
        feed.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setActivityFeed(feed.slice(0, 20));
      } catch (err) {
        console.error('Error fetching activity feed:', err);
      } finally {
        setActivityLoading(false);
      }
    }

    fetchActivityFeed();
  }, [selectedSchool, userData]);

  useEffect(() => {
    if (!selectedSchool) {
      setLoading(false);
      return;
    }

    async function fetchData() {
      setLoading(true);
      try {
        // Fetch upcoming events
        const today = new Date().toISOString().split('T')[0];
        const eventsRef = collection(db, `events_${selectedSchool}`);
        const eventsQuery = query(
          eventsRef,
          where('date', '>=', today),
          orderBy('date', 'asc'),
          limit(5)
        );
        const eventsSnap = await getDocs(eventsQuery);
        setEvents(eventsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        // Fetch task stats
        const tasksRef = collection(db, `tasks_${selectedSchool}`);
        const tasksSnap = await getDocs(tasksRef);
        const tasks = tasksSnap.docs.map(d => d.data());
        const pending = tasks.filter(t => t.status === 'pending' || t.status === 'todo').length;
        const completed = tasks.filter(t => t.status === 'completed' || t.status === 'done').length;
        const overdue = tasks.filter(t => {
          if (t.status === 'completed' || t.status === 'done') return false;
          return t.dueDate && t.dueDate < today;
        }).length;
        setTaskStats({ total: tasks.length, pending, completed, overdue });

        // Fetch staff count - query with new schoolIds array-contains
        const staffRef = collection(db, 'users');
        const staffQuery1 = query(staffRef, where('schoolIds', 'array-contains', selectedSchool));
        const staffSnap1 = await getDocs(staffQuery1);
        const staffIds = new Set(staffSnap1.docs.map(d => d.id));

        // Fallback: also query with old schoolId field for backward compatibility
        const staffQuery2 = query(staffRef, where('schoolId', '==', selectedSchool));
        const staffSnap2 = await getDocs(staffQuery2);
        staffSnap2.docs.forEach(d => {
          const data = d.data();
          const pending = data.pendingSchools || [];
          // Only count if not pending (i.e., approved via old schema)
          if (!pending.includes(selectedSchool)) {
            staffIds.add(d.id);
          }
        });

        setStaffCount(staffIds.size);
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [selectedSchool]);

  function getSchoolName(schoolId) {
    const school = schools.find(s => s.id === schoolId);
    return school?.name || schoolId;
  }

  async function handleApprove(userId, schoolId) {
    await approveUser(userId, schoolId);
    // Refresh pending users list
    setPendingUsers(prev => {
      return prev.map(u => {
        if (u.id === userId) {
          const newPending = (u.pendingSchools || []).filter(s => s !== schoolId);
          if (newPending.length === 0) return null;
          return { ...u, pendingSchools: newPending };
        }
        return u;
      }).filter(Boolean);
    });
  }

  async function handleReject(userId, schoolId) {
    if (!confirm('האם לדחות את בקשת המשתמש?')) return;
    await rejectUser(userId, schoolId);
    // Refresh pending users list
    setPendingUsers(prev => {
      return prev.map(u => {
        if (u.id === userId) {
          const newPending = (u.pendingSchools || []).filter(s => s !== schoolId);
          if (newPending.length === 0) return null;
          return { ...u, pendingSchools: newPending };
        }
        return u;
      }).filter(Boolean);
    });
  }

  if (isPending()) {
    return (
      <div className="page">
        <Header title="דשבורד" />
        <div className="page-content">
          <div className="dashboard-empty" style={{ textAlign: 'center' }}>
            <Clock size={48} style={{ color: '#f59e0b' }} />
            <h2 style={{ margin: '1rem 0 0.5rem', fontSize: '1.3rem', color: '#92400e' }}>ממתין לאישור</h2>
            <p style={{ color: '#78716c', fontSize: '0.95rem', maxWidth: 400, margin: '0 auto' }}>
              הבקשה שלך להצטרף למוסד נשלחה למנהל. תקבל גישה למערכת לאחר שהמנהל יאשר את הבקשה.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedSchool) {
    return (
      <div className="page">
        <Header title="דשבורד" />
        <div className="page-content">
          <div className="dashboard-empty">
            <BookOpen size={48} />
            <p>יש לבחור מוסד כדי לצפות בדשבורד</p>
          </div>
        </div>
      </div>
    );
  }

  const todayDate = new Date().toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  function renderWidgetContent(widget) {
    const prioColors = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
    const prioLabels = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
    const prioBgs = { high: '#fef2f2', medium: '#fffbeb', low: '#f0fdf4' };
    const statusLabels = { todo: 'לביצוע', in_progress: 'בתהליך', done: 'הושלם' };

    switch (widget.type) {
      case 'my_tasks':
        if (sortedMyTasks.length === 0) return <p className="section-empty">אין משימות</p>;
        return (
          <>
            <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.5rem' }}>
              <button className={`btn btn-sm ${taskSortBy === 'priority' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTaskSortBy('priority')} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
                <ArrowUpDown size={12} /> דחיפות
              </button>
              <button className={`btn btn-sm ${taskSortBy === 'dueDate' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTaskSortBy('dueDate')} style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}>
                <ArrowUpDown size={12} /> תאריך יעד
              </button>
            </div>
            <div className="my-task-list">
              {sortedMyTasks.slice(0, 10).map(task => {
                const overdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'done';
                const teamName = getTaskTeamName(task);
                return (
                  <div key={task.id} className="my-task-item" style={{ borderRightColor: prioColors[task.priority] || '#f59e0b', cursor: 'pointer' }} onClick={() => navigate('/tasks')}>
                    <div className="my-task-main">
                      <span className="my-task-title">{task.title}</span>
                      <div className="my-task-meta">
                        <span className="my-task-priority" style={{ background: prioBgs[task.priority], color: prioColors[task.priority] }}>{prioLabels[task.priority] || 'בינונית'}</span>
                        <span className="my-task-team"><Users size={10} style={{ verticalAlign: 'middle', marginLeft: '0.15rem' }} />{teamName}</span>
                        <span className="my-task-status" style={{ color: task.status === 'in_progress' ? '#2563eb' : '#64748b' }}>{statusLabels[task.status] || 'לביצוע'}</span>
                        {task.dueDate && <span className={`my-task-due ${overdue ? 'my-task-due--late' : ''}`}>{new Date(task.dueDate).toLocaleDateString('he-IL')}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      case 'events':
        if (filteredEvents.length === 0) return <p className="section-empty">אין אירועים קרובים</p>;
        return (
          <div className="event-list">
            {filteredEvents.map(event => (
              <div key={event.id} className="event-card" style={{ cursor: 'pointer' }} onClick={() => { const d = new Date(event.date + 'T00:00:00'); navigate(`/calendar?year=${d.getFullYear()}&month=${d.getMonth()}`); }}>
                <div className="event-date-badge">
                  <span className="event-day">{new Date(event.date + 'T00:00:00').getDate()}</span>
                  <span className="event-month">{new Date(event.date + 'T00:00:00').toLocaleDateString('he-IL', { month: 'short' })}</span>
                </div>
                <div className="event-details">
                  <span className="event-title">{event.title}</span>
                  {event.category && <span className="event-category">{event.category}</span>}
                  <span className="event-countdown">{getDaysUntil(event.date)}</span>
                </div>
              </div>
            ))}
          </div>
        );
      case 'holidays':
        if (filteredHolidays.length === 0) return <p className="section-empty">אין חגים קרובים</p>;
        return (
          <div className="holiday-list">
            {filteredHolidays.map((holiday, idx) => (
              <div key={idx} className="holiday-card" style={{ borderRightColor: HOLIDAY_BORDER_COLORS[holiday.type] || '#e2e8f0', cursor: 'pointer' }} onClick={() => { const d = new Date(holiday.startDate + 'T00:00:00'); navigate(`/calendar?year=${d.getFullYear()}&month=${d.getMonth()}`); }}>
                <div className="holiday-info">
                  <span className="holiday-name">{holiday.name}</span>
                  <span className="holiday-dates">{formatHebrewDate(holiday.startDate)}{holiday.startDate !== holiday.endDate && <> - {formatHebrewDate(holiday.endDate)}</>}</span>
                </div>
                <div className="holiday-meta">
                  <span className="holiday-type-badge" style={{ background: holiday.color }}>{HOLIDAY_TYPE_LABELS[holiday.type] || holiday.type}</span>
                  <span className="holiday-countdown">{getDaysUntil(holiday.startDate)}</span>
                  {holiday.isVacation && <span className="holiday-vacation-badge">חופשה</span>}
                </div>
              </div>
            ))}
          </div>
        );
      case 'announcements':
        if (recentAnnouncements.length === 0) return <p className="section-empty">אין הודעות</p>;
        return (
          <div className="announcement-list-dashboard">
            {recentAnnouncements.map(ann => (
              <div key={ann.id} className="announcement-dashboard-card">
                <div className="announcement-dashboard-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Megaphone size={12} style={{ color: '#6366f1' }} />
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{ann.senderName}</span>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                    {ann.createdAt ? new Date(ann.createdAt).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) : ''}
                  </span>
                </div>
                <div style={{ fontSize: '0.88rem', color: '#334155', marginTop: '0.35rem', lineHeight: 1.5 }}>{ann.text}</div>
              </div>
            ))}
          </div>
        );
      case 'team_activity':
        if (teamActivity.length === 0) return <p className="section-empty">אין פעילות צוות</p>;
        return (
          <div className="my-task-list">
            {teamActivity.map(task => {
              const teamName = getTaskTeamName(task);
              return (
                <div key={task.id} className="my-task-item" style={{ borderRightColor: '#2563eb', cursor: 'pointer' }} onClick={() => navigate('/tasks')}>
                  <div className="my-task-main">
                    <span className="my-task-title">{task.title}</span>
                    <div className="my-task-meta">
                      <span className="my-task-team"><Users size={10} style={{ verticalAlign: 'middle', marginLeft: '0.15rem' }} />{teamName}</span>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{task.createdBy || ''}</span>
                      {task.dueDate && <span className="my-task-due">{new Date(task.dueDate).toLocaleDateString('he-IL')}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      case 'file_tracker':
        if (trackedFiles.length === 0) return <p className="section-empty">אין קבצים שנערכו לאחרונה</p>;
        return (
          <div className="my-task-list">
            {trackedFiles.slice(0, 8).map(file => (
              <div key={file.id} className="my-task-item" style={{ borderRightColor: '#7c3aed', cursor: 'pointer' }} onClick={() => navigate(`/files?openFile=${file.id}`)}>
                <div className="my-task-main">
                  <span className="my-task-title">
                    <FileText size={12} style={{ verticalAlign: 'middle', marginLeft: '0.2rem', color: '#7c3aed' }} />
                    {file.name}
                  </span>
                  <div className="my-task-meta">
                    {file.lastModifiedBy && <span style={{ fontSize: '0.7rem', color: '#64748b' }}>נערך ע"י: {file.lastModifiedBy}</span>}
                    {file.lastModified && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatActivityDate(file.lastModified)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      case 'upcoming_week':
        if (weekTasks.length === 0) return <p className="section-empty">אין אירועים השבוע</p>;
        return (
          <div className="event-list">
            {weekTasks.map(event => (
              <div key={event.id} className="event-card" style={{ cursor: 'pointer' }} onClick={() => { const d = new Date(event.date + 'T00:00:00'); navigate(`/calendar?year=${d.getFullYear()}&month=${d.getMonth()}`); }}>
                <div className="event-date-badge">
                  <span className="event-day">{new Date(event.date + 'T00:00:00').getDate()}</span>
                  <span className="event-month">{new Date(event.date + 'T00:00:00').toLocaleDateString('he-IL', { month: 'short' })}</span>
                </div>
                <div className="event-details">
                  <span className="event-title">{event.title}</span>
                  {event.category && <span className="event-category">{event.category}</span>}
                  <span className="event-countdown">{getDaysUntil(event.date)}</span>
                </div>
              </div>
            ))}
          </div>
        );
      case 'staff_tasks':
        if (staffTaskActivity.length === 0) return <p className="section-empty">אין משימות אחרונות</p>;
        return (
          <div className="my-task-list">
            {staffTaskActivity.slice(0, 8).map(task => (
              <div key={task.id} className="my-task-item" style={{ borderRightColor: prioColors[task.priority] || '#f59e0b', cursor: 'pointer' }} onClick={() => navigate('/tasks')}>
                <div className="my-task-main">
                  <span className="my-task-title">{task.title}</span>
                  <div className="my-task-meta">
                    <span className="my-task-priority" style={{ background: prioBgs[task.priority], color: prioColors[task.priority] }}>{prioLabels[task.priority] || 'בינונית'}</span>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>יוצר: {task.createdBy || '—'}</span>
                    {task.createdAt && <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{formatActivityDate(task.createdAt)}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      default:
        return <p className="section-empty">תצוגה לא זמינה</p>;
    }
  }

  const canApprove = isGlobalAdmin() || isPrincipal();

  return (
    <div className="page">
      <Header title="דשבורד" />
      <div className="page-content">
        {/* Welcome Section */}
        <div className="dashboard-welcome">
          <div className="welcome-text">
            <h1 className="welcome-greeting">
              {getGreeting()}, {userData?.fullName || 'משתמש'} 👋
            </h1>
            <p className="welcome-date">{todayDate}</p>
          </div>
        </div>

        {/* Pending Approvals Section */}
        {canApprove && pendingUsers.length > 0 && (
          <div className="pending-approval-section" style={{ marginBottom: '1.5rem', padding: '1rem', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <UserCheck size={18} style={{ color: '#92400e' }} />
              <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#92400e' }}>
                ממתינים לאישור ({pendingUsers.length})
              </h3>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>שם</th>
                    <th>דוא"ל</th>
                    <th>תפקיד</th>
                    {isGlobalAdmin() && <th>מוסד</th>}
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map(user => {
                    // For admin: show each pending school as a separate row
                    const pendingSchoolIds = user.pendingSchools || [];
                    if (isGlobalAdmin()) {
                      return pendingSchoolIds.map(psId => (
                        <tr key={`${user.id}-${psId}`}>
                          <td className="td-bold">
                            <div className="td-user">
                              <div className="td-avatar">{user.fullName?.charAt(0)}</div>
                              {user.fullName}
                            </div>
                          </td>
                          <td dir="ltr">{user.email}</td>
                          <td>{user.jobTitle || '—'}</td>
                          <td>{getSchoolName(psId)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleApprove(user.id, psId)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                              >
                                <CheckCircle size={14} />
                                אישור
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleReject(user.id, psId)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#ef4444' }}
                              >
                                <XCircle size={14} />
                                דחייה
                              </button>
                            </div>
                          </td>
                        </tr>
                      ));
                    } else {
                      // Principal: show for the selected school only
                      return (
                        <tr key={user.id}>
                          <td className="td-bold">
                            <div className="td-user">
                              <div className="td-avatar">{user.fullName?.charAt(0)}</div>
                              {user.fullName}
                            </div>
                          </td>
                          <td dir="ltr">{user.email}</td>
                          <td>{user.jobTitle || '—'}</td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleApprove(user.id, selectedSchool)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                              >
                                <CheckCircle size={14} />
                                אישור
                              </button>
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => handleReject(user.id, selectedSchool)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#ef4444' }}
                              >
                                <XCircle size={14} />
                                דחייה
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Today Highlight */}
        {filteredTodayHolidays.length > 0 && (
          <div className="dashboard-today">
            <div className="today-icon">
              <Star size={18} />
            </div>
            <div className="today-content">
              <span className="today-label">היום:</span>
              {filteredTodayHolidays.map((h, i) => (
                <span key={i} className="today-holiday" style={{ background: h.color }}>
                  {h.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="dashboard-stats">
          <div className="stat-card">
            <div className="stat-icon stat-icon--tasks">
              <CheckSquare size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{taskStats.pending}</span>
              <span className="stat-label">משימות ממתינות</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-icon--completed">
              <CheckSquare size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{taskStats.completed}</span>
              <span className="stat-label">משימות שהושלמו</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-icon--overdue">
              <Clock size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{taskStats.overdue}</span>
              <span className="stat-label">משימות באיחור</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon stat-icon--staff">
              <Users size={20} />
            </div>
            <div className="stat-info">
              <span className="stat-value">{staffCount}</span>
              <span className="stat-label">אנשי צוות</span>
            </div>
          </div>
        </div>

        {/* Customizable Widget Grid */}
        <div className="dashboard-widgets" onContextMenu={handleDashboardContextMenu}>
          {widgets.map((widget, idx) => {
            const config = WIDGET_TYPES[widget.type];
            if (!config) return null;
            const Icon = config.icon;
            const gridColumn = widget.size === 'full' ? '1 / -1' : undefined;
            return (
              <div
                key={`${widget.type}-${idx}`}
                className="dashboard-section dashboard-widget"
                style={{ gridColumn }}
                onContextMenu={(e) => handleWidgetContextMenu(e, idx)}
              >
                <div className="section-header">
                  <Icon size={18} />
                  <h2 className="section-title">{config.label}</h2>
                  <div style={{ marginRight: 'auto', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                    <button className="widget-size-btn" title="שנה גודל" onClick={() => resizeWidget(idx, widget.size === 'full' ? 'half' : 'full')}>
                      {widget.size === 'full' ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                    </button>
                    <button className="widget-size-btn widget-size-btn--danger" title="הסר תצוגה" onClick={() => removeWidget(idx)}>
                      <X size={13} />
                    </button>
                  </div>
                </div>
                <div className="section-body">
                  {renderWidgetContent(widget)}
                </div>
              </div>
            );
          })}
          {widgets.length === 0 && (
            <div className="dashboard-empty" style={{ gridColumn: '1 / -1' }}>
              <PlusCircle size={32} style={{ color: '#94a3b8' }} />
              <p>לחץ ימני כדי להוסיף תצוגות לדשבורד</p>
            </div>
          )}
        </div>

        {/* Right-click: Add widget menu */}
        {showAddWidget && (
          <div className="context-menu" style={{ position: 'fixed', top: addWidgetPos.y, left: addWidgetPos.x, zIndex: 1000 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #f1f5f9' }}>הוסף תצוגה</div>
            {Object.entries(WIDGET_TYPES).map(([type, config]) => {
              const Icon = config.icon;
              const alreadyAdded = widgets.some(w => w.type === type);
              return (
                <button
                  key={type}
                  className="context-menu-item"
                  onClick={() => addWidget(type)}
                  disabled={alreadyAdded}
                  style={alreadyAdded ? { opacity: 0.4 } : undefined}
                >
                  <Icon size={14} /> {config.label} {alreadyAdded ? '✓' : ''}
                </button>
              );
            })}
          </div>
        )}

        {/* Right-click on widget: manage */}
        {widgetContextMenu && (
          <div className="context-menu" style={{ position: 'fixed', top: widgetContextMenu.y, left: widgetContextMenu.x, zIndex: 1000 }} onClick={e => e.stopPropagation()}>
            <button className="context-menu-item" onClick={() => resizeWidget(widgetContextMenu.widgetIdx, 'full')}>
              <Maximize2 size={14} /> רוחב מלא
            </button>
            <button className="context-menu-item" onClick={() => resizeWidget(widgetContextMenu.widgetIdx, 'half')}>
              <Columns size={14} /> חצי רוחב
            </button>
            <div className="context-menu-divider" />
            <button className="context-menu-item" onClick={() => moveWidget(widgetContextMenu.widgetIdx, -1)} disabled={widgetContextMenu.widgetIdx === 0}>
              <ArrowUpDown size={14} /> הזז למעלה
            </button>
            <button className="context-menu-item" onClick={() => moveWidget(widgetContextMenu.widgetIdx, 1)} disabled={widgetContextMenu.widgetIdx === widgets.length - 1}>
              <ArrowUpDown size={14} /> הזז למטה
            </button>
            <div className="context-menu-divider" />
            <button className="context-menu-item context-menu-item--danger" onClick={() => removeWidget(widgetContextMenu.widgetIdx)}>
              <Trash2 size={14} /> הסר תצוגה
            </button>
          </div>
        )}

        <div className="dashboard-grid" style={{ display: 'none' }}>
          {/* Upcoming Events */}
          <div className="dashboard-section">
            <div className="section-header">
              <Calendar size={18} />
              <h2 className="section-title">אירועים קרובים</h2>
              <div className="filter-popup-container" style={{ marginRight: 'auto', marginLeft: 0 }}>
                <button
                  className="filter-gear-btn"
                  title="סינון אירועים"
                  onClick={() => {
                    setPendingHiddenEventCategories(hiddenEventCategories);
                    setShowEventsFilter(!showEventsFilter);
                    setShowHolidaysFilter(false);
                  }}
                >
                  <SlidersHorizontal size={16} />
                </button>
                {showEventsFilter && (
                  <div className="filter-popup">
                    <div className="filter-popup-title">סינון לפי קטגוריה</div>
                    {eventCategories.length === 0 ? (
                      <p className="filter-popup-empty">אין קטגוריות זמינות</p>
                    ) : (
                      <div className="filter-popup-options">
                        {eventCategories.map(cat => (
                          <label key={cat} className="filter-checkbox-label">
                            <input
                              type="checkbox"
                              checked={!pendingHiddenEventCategories.includes(cat)}
                              onChange={() => {
                                setPendingHiddenEventCategories(prev =>
                                  prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                                );
                              }}
                            />
                            <span>{cat}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <button
                      className="filter-save-btn"
                      onClick={() => {
                        saveFilterPreferences(pendingHiddenEventCategories, hiddenHolidayTypes);
                        setShowEventsFilter(false);
                      }}
                    >
                      שמור
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="section-body">
              {loading ? (
                <p className="section-empty">טוען...</p>
              ) : filteredEvents.length === 0 ? (
                <p className="section-empty">אין אירועים קרובים</p>
              ) : (
                <div className="event-list">
                  {filteredEvents.map(event => (
                    <div key={event.id} className="event-card" style={{ cursor: 'pointer' }}
                      onClick={() => {
                        const d = new Date(event.date + 'T00:00:00');
                        navigate(`/calendar?year=${d.getFullYear()}&month=${d.getMonth()}`);
                      }}
                    >
                      <div className="event-date-badge">
                        <span className="event-day">
                          {new Date(event.date + 'T00:00:00').getDate()}
                        </span>
                        <span className="event-month">
                          {new Date(event.date + 'T00:00:00').toLocaleDateString('he-IL', { month: 'short' })}
                        </span>
                      </div>
                      <div className="event-details">
                        <span className="event-title">{event.title}</span>
                        {event.category && (
                          <span className="event-category">{event.category}</span>
                        )}
                        <span className="event-countdown">{getDaysUntil(event.date)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Upcoming Holidays */}
          <div className="dashboard-section">
            <div className="section-header">
              <Star size={18} />
              <h2 className="section-title">חגים וחופשות קרובים</h2>
              <div className="filter-popup-container" style={{ marginRight: 'auto', marginLeft: 0 }}>
                <button
                  className="filter-gear-btn"
                  title="סינון חגים"
                  onClick={() => {
                    setPendingHiddenHolidayTypes(hiddenHolidayTypes);
                    setShowHolidaysFilter(!showHolidaysFilter);
                    setShowEventsFilter(false);
                  }}
                >
                  <SlidersHorizontal size={16} />
                </button>
                {showHolidaysFilter && (
                  <div className="filter-popup">
                    <div className="filter-popup-title">סינון לפי סוג חג</div>
                    <div className="filter-popup-options">
                      {HOLIDAY_TYPES.map(type => (
                        <label key={type} className="filter-checkbox-label">
                          <input
                            type="checkbox"
                            checked={!pendingHiddenHolidayTypes.includes(type)}
                            onChange={() => {
                              setPendingHiddenHolidayTypes(prev =>
                                prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
                              );
                            }}
                          />
                          <span>{HOLIDAY_TYPE_LABELS[type]}</span>
                        </label>
                      ))}
                    </div>
                    <button
                      className="filter-save-btn"
                      onClick={() => {
                        saveFilterPreferences(hiddenEventCategories, pendingHiddenHolidayTypes);
                        setShowHolidaysFilter(false);
                      }}
                    >
                      שמור
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="section-body">
              {filteredHolidays.length === 0 ? (
                <p className="section-empty">אין חגים קרובים</p>
              ) : (
                <div className="holiday-list">
                  {filteredHolidays.map((holiday, idx) => (
                    <div
                      key={idx}
                      className="holiday-card"
                      style={{ borderRightColor: HOLIDAY_BORDER_COLORS[holiday.type] || '#e2e8f0', cursor: 'pointer' }}
                      onClick={() => {
                        const d = new Date(holiday.startDate + 'T00:00:00');
                        navigate(`/calendar?year=${d.getFullYear()}&month=${d.getMonth()}`);
                      }}
                    >
                      <div className="holiday-info">
                        <span className="holiday-name">{holiday.name}</span>
                        <span className="holiday-dates">
                          {formatHebrewDate(holiday.startDate)}
                          {holiday.startDate !== holiday.endDate && (
                            <> - {formatHebrewDate(holiday.endDate)}</>
                          )}
                        </span>
                      </div>
                      <div className="holiday-meta">
                        <span
                          className="holiday-type-badge"
                          style={{ background: holiday.color }}
                        >
                          {HOLIDAY_TYPE_LABELS[holiday.type] || holiday.type}
                        </span>
                        <span className="holiday-countdown">{getDaysUntil(holiday.startDate)}</span>
                        {holiday.isVacation && (
                          <span className="holiday-vacation-badge">חופשה</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Admin School Summary Stats */}
        {isGlobalAdmin() && schoolStats.length > 0 && (
          <div className="dashboard-section" style={{ marginTop: '1rem' }}>
            <div className="section-header">
              <School size={18} />
              <h2 className="section-title">סיכום מוסדות ({schoolStats.length})</h2>
            </div>
            <div className="section-body">
              <div className="school-stats-grid">
                {schoolStats.map(s => (
                  <div key={s.id} className="school-stat-card">
                    <div className="school-stat-name">{s.name}</div>
                    <div className="school-stat-row">
                      <div className="school-stat-item">
                        <Users size={14} />
                        <span>{s.staffCount} אנשי צוות</span>
                      </div>
                      <div className="school-stat-item">
                        <Shield size={14} />
                        <span>{s.principalCount} מנהלים</span>
                      </div>
                      <div className="school-stat-item">
                        <Calendar size={14} />
                        <span>{s.eventCount} אירועים</span>
                      </div>
                      <div className="school-stat-item">
                        <CheckSquare size={14} />
                        <span>{s.taskCount} משימות</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Admin Cross-School Events */}
        {isGlobalAdmin() && allSchoolEvents.length > 0 && (
          <div className="dashboard-section" style={{ marginTop: '1rem' }}>
            <div className="section-header">
              <Calendar size={18} />
              <h2 className="section-title">אירועים קרובים בכל המוסדות</h2>
            </div>
            <div className="section-body">
              <div className="event-list">
                {allSchoolEvents.map((event, idx) => (
                  <div key={`${event.schoolId}-${event.id}-${idx}`} className="event-card" style={{ cursor: 'pointer' }}
                    onClick={() => {
                      const d = new Date(event.date + 'T00:00:00');
                      navigate(`/calendar?year=${d.getFullYear()}&month=${d.getMonth()}`);
                    }}
                  >
                    <div className="event-date-badge">
                      <span className="event-day">
                        {new Date(event.date + 'T00:00:00').getDate()}
                      </span>
                      <span className="event-month">
                        {new Date(event.date + 'T00:00:00').toLocaleDateString('he-IL', { month: 'short' })}
                      </span>
                    </div>
                    <div className="event-details">
                      <span className="event-title">{event.title}</span>
                      <span className="event-category" style={{ background: '#eff6ff', color: '#2563eb' }}>
                        {event.schoolName}
                      </span>
                      {event.category && (
                        <span className="event-category">{event.category}</span>
                      )}
                      <span className="event-countdown">{getDaysUntil(event.date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Admin Activity Feed */}
        {isGlobalAdmin() && (
          <div className="dashboard-section" style={{ marginTop: '1rem' }}>
            <div className="section-header">
              <Activity size={18} />
              <h2 className="section-title">סיכום פעילות בתי ספר</h2>
            </div>
            <div className="section-body">
              {activityLoading ? (
                <p className="section-empty">טוען פעילות...</p>
              ) : activityFeed.length === 0 ? (
                <p className="section-empty">אין פעילות אחרונה</p>
              ) : (
                <div className="activity-feed">
                  {activityFeed.map((item, idx) => (
                    <div key={idx} className="activity-item">
                      <div className={`activity-icon activity-icon--${item.icon}`}>
                        {item.icon === 'school' && <School size={14} />}
                        {item.icon === 'principal' && <Shield size={14} />}
                        {item.icon === 'staff' && <UserPlus size={14} />}
                      </div>
                      <div className="activity-content">
                        <span className="activity-text">{item.text}</span>
                        {item.detail && <span className="activity-detail">{item.detail}</span>}
                      </div>
                      <span className="activity-time">{formatActivityDate(item.date)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
