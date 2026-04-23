import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  deleteDoc,
  doc,
  setDoc,
  arrayUnion,
  arrayRemove,
  getDoc,
  orderBy,
  limit
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updatePassword, updateEmail, deleteUser, signOut as firebaseSignOut } from 'firebase/auth';
import { secondaryAuth } from '../../firebase';
import Header from '../Layout/Header';
import { Edit3, Trash2, Shield, Search, X, UserPlus, CheckCircle, XCircle, Lock, ChevronDown, ChevronUp, Save, Filter, Phone, Mail, User, MessageCircle, Briefcase, Eye, Key, Copy, RefreshCw, Users, Plus, Trash, Check, AlertCircle } from 'lucide-react';
import RolesManager from './RolesManager';
import '../Gantt/Gantt.css';
import './Staff.css';

const ROLE_LABELS = {
  global_admin: 'מנהל על',
  principal: 'מנהל מוסד',
  editor: 'עורך',
  viewer: 'צופה'
};

const AVATAR_STYLES = [
  { key: 'default', label: 'כחול קלאסי' },
  { key: 'sunset', label: 'שקיעה' },
  { key: 'ocean', label: 'אוקיינוס' },
  { key: 'forest', label: 'יער' },
  { key: 'royal', label: 'מלכותי' },
  { key: 'midnight', label: 'חצות' },
  { key: 'rose', label: 'ורד' },
  { key: 'amber', label: 'ענבר' },
  { key: 'slate', label: 'אפור' },
  { key: 'emerald', label: 'אמרלד' },
  { key: 'ruby', label: 'רובי' },
  { key: 'sapphire', label: 'ספיר' },
];

const DEFAULT_PERMISSIONS = {
  calendar_view: true,
  calendar_edit: false,
  categories_view: true,
  categories_edit: false,
  staff_view: true,
  staff_edit: false,
  staff_delete: false,
  tasks_view: true,
  tasks_edit: false,
  tasks_assign: false,
  teams_view: true,
  teams_edit: false,
  files_view: true,
  files_upload: false,
  files_delete: false,
  messages_send: true,
  messages_delete: false,
  holidays_view: true,
  holidays_edit: false,
  data_mapping_view: true,
  data_mapping_edit: false,
  schools_manage: false,
  settings_edit: false,
};

const PERMISSION_GROUPS = [
  {
    label: 'לוח שנה',
    permissions: [
      { key: 'calendar_view', label: 'צפייה בלוח שנה' },
      { key: 'calendar_edit', label: 'עריכת אירועים' },
    ]
  },
  {
    label: 'קטגוריות',
    permissions: [
      { key: 'categories_view', label: 'צפייה בקטגוריות' },
      { key: 'categories_edit', label: 'עריכת קטגוריות' },
    ]
  },
  {
    label: 'סגל וקהילה',
    permissions: [
      { key: 'staff_view', label: 'צפייה בסגל' },
      { key: 'staff_edit', label: 'עריכת סגל והרשאות' },
      { key: 'staff_delete', label: 'מחיקת איש צוות' },
    ]
  },
  {
    label: 'משימות',
    permissions: [
      { key: 'tasks_view', label: 'צפייה במשימות' },
      { key: 'tasks_edit', label: 'יצירה ועריכת משימות' },
      { key: 'tasks_assign', label: 'הקצאת משימות לאחרים' },
    ]
  },
  {
    label: 'צוותים',
    permissions: [
      { key: 'teams_view', label: 'צפייה בצוותים' },
      { key: 'teams_edit', label: 'ניהול צוותים' },
    ]
  },
  {
    label: 'קבצים',
    permissions: [
      { key: 'files_view', label: 'צפייה בקבצים' },
      { key: 'files_upload', label: 'העלאת קבצים' },
      { key: 'files_delete', label: 'מחיקת קבצים' },
    ]
  },
  {
    label: 'הודעות',
    permissions: [
      { key: 'messages_send', label: 'שליחת הודעות' },
      { key: 'messages_delete', label: 'מחיקת הודעות' },
    ]
  },
  {
    label: 'חגים וחופשות',
    permissions: [
      { key: 'holidays_view', label: 'צפייה בחגים' },
      { key: 'holidays_edit', label: 'עריכת חגים' },
    ]
  },
  {
    label: 'מיפוי נתונים',
    permissions: [
      { key: 'data_mapping_view', label: 'צפייה במיפוי' },
      { key: 'data_mapping_edit', label: 'עריכת מיפוי נתונים' },
    ]
  },
  {
    label: 'הגדרות מערכת',
    permissions: [
      { key: 'schools_manage', label: 'ניהול מוסדות' },
      { key: 'settings_edit', label: 'עריכת הגדרות' },
    ]
  },
];

function getPermissionsForRole(role) {
  const perms = { ...DEFAULT_PERMISSIONS };
  if (role === 'global_admin') {
    for (const key of Object.keys(perms)) perms[key] = true;
  } else if (role === 'principal') {
    for (const key of Object.keys(perms)) perms[key] = true;
    perms.schools_manage = false;
  } else if (role === 'editor') {
    perms.calendar_edit = true;
    perms.tasks_edit = true;
    perms.tasks_assign = true;
    perms.teams_edit = true;
    perms.files_upload = true;
    perms.messages_send = true;
    perms.data_mapping_edit = true;
  }
  return perms;
}

export default function StaffManagement() {
  const { userData, selectedSchool, isPrincipal, isGlobalAdmin, approveUser, rejectUser } = useAuth();
  const navigate = useNavigate();
  const [staff, setStaff] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [viewMode, setViewMode] = useState('table');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterSchool, setFilterSchool] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ fullName: '', email: '', jobTitle: '', role: 'viewer', schoolId: '', password: '', avatarStyle: 'default' });
  const [addError, setAddError] = useState('');

  // Bulk add modal
  const [showBulkModal, setShowBulkModal] = useState(false);
  const EMPTY_BULK_ROW = { fullName: '', email: '', jobTitle: '', password: '', role: 'viewer' };
  const [bulkRows, setBulkRows] = useState(() => Array.from({ length: 5 }, () => ({ ...EMPTY_BULK_ROW })));
  const [bulkError, setBulkError] = useState('');
  const [bulkProgress, setBulkProgress] = useState(null); // { current, total, results: [{ name, success, error }] }

  // Edit modal
  const [editUser, setEditUser] = useState(null);
  const [editForm, setEditForm] = useState({ fullName: '', email: '', phone: '', role: '', jobTitle: '', assignedSchoolId: '', newPassword: '', customRoleIds: [], teamIds: [] });
  const [editError, setEditError] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [schoolsToRemove, setSchoolsToRemove] = useState([]);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);

  const [schools, setSchools] = useState([]);
  const [permissionsUser, setPermissionsUser] = useState(null);
  const [permissionsForm, setPermissionsForm] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [showRolesManager, setShowRolesManager] = useState(false);
  const [customRoles, setCustomRoles] = useState([]);
  const [teams, setTeams] = useState([]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null); // { x, y, user }
  const contextMenuRef = useRef(null);

  // Task attachment popup
  const [taskAttachUser, setTaskAttachUser] = useState(null);
  const [taskList, setTaskList] = useState([]);
  const [taskListLoading, setTaskListLoading] = useState(false);

  // Profile popup
  const [profileUser, setProfileUser] = useState(null);
  const [profileTasks, setProfileTasks] = useState([]);
  const [profileActivity, setProfileActivity] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const schoolId = selectedSchool || userData?.schoolId;
  const isAdmin = isGlobalAdmin();
  const canEdit = isPrincipal() || isAdmin;
  const canApprove = isPrincipal() || isAdmin;

  useEffect(() => {
    loadSchools();
  }, []);

  useEffect(() => {
    if (!schoolId) return;
    loadCustomRoles();
    loadTeams();
  }, [schoolId]);

  async function loadCustomRoles() {
    try {
      const snap = await getDocs(collection(db, `roles_${schoolId}`));
      setCustomRoles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading custom roles:', err);
    }
  }

  async function loadTeams() {
    try {
      const snap = await getDocs(collection(db, `teams_${schoolId}`));
      setTeams(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading teams:', err);
    }
  }

  useEffect(() => {
    if (isAdmin) {
      loadAllStaff();
    } else if (schoolId) {
      loadStaff();
      loadPendingUsers();
    }
  }, [schoolId]);

  async function loadSchools() {
    try {
      const snap = await getDocs(collection(db, 'schools'));
      setSchools(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading schools:', err);
    }
  }

  // Admin: load ALL users across all schools
  async function loadAllStaff() {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setStaff(all);
    } catch (err) {
      console.error('Error loading all staff:', err);
    }
  }

  // Principal: load only current school's users
  async function loadStaff() {
    const q1 = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
    const snap1 = await getDocs(q1);
    const staffMap = new Map();
    snap1.docs.forEach(d => staffMap.set(d.id, { id: d.id, ...d.data() }));

    const q2 = query(collection(db, 'users'), where('schoolId', '==', schoolId));
    const snap2 = await getDocs(q2);
    snap2.docs.forEach(d => {
      if (!staffMap.has(d.id)) {
        const data = d.data();
        const pending = data.pendingSchools || [];
        if (!pending.includes(schoolId)) {
          staffMap.set(d.id, { id: d.id, ...data });
        }
      }
    });

    setStaff(Array.from(staffMap.values()));
  }

  async function loadPendingUsers() {
    const q = query(collection(db, 'users'), where('pendingSchools', 'array-contains', schoolId));
    const snap = await getDocs(q);
    setPendingUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }

  async function handleApprove(userId) {
    await approveUser(userId, schoolId);
    isAdmin ? loadAllStaff() : loadStaff();
    if (!isAdmin) loadPendingUsers();
  }

  async function handleReject(userId) {
    if (!confirm('האם לדחות את בקשת המשתמש?')) return;
    await rejectUser(userId, schoolId);
    if (!isAdmin) loadPendingUsers();
  }

  async function handleSaveEdit() {
    if (!editUser) return;
    setEditError('');

    if (!editForm.fullName.trim()) {
      setEditError('שם מלא הוא שדה חובה');
      return;
    }
    if (!editForm.email.trim()) {
      setEditError('דוא"ל הוא שדה חובה');
      return;
    }
    if (editForm.newPassword && editForm.newPassword.length < 6) {
      setEditError('הסיסמא חייבת להכיל לפחות 6 תווים');
      return;
    }

    const updateData = {
      fullName: editForm.fullName.trim(),
      email: editForm.email.trim(),
      phone: editForm.phone.trim(),
      role: editForm.role,
      jobTitle: editForm.jobTitle,
      customRoleIds: editForm.customRoleIds || [],
      teamIds: editForm.teamIds || [],
    };
    if (editForm.assignedSchoolId) {
      updateData.schoolIds = arrayUnion(editForm.assignedSchoolId);
    }

    // Sync email/password changes directly to Firebase Auth
    const emailChanged = editForm.email.trim() !== (editUser.email || '');
    const passwordChanged = !!editForm.newPassword;
    if (emailChanged || passwordChanged) {
      const currentPassword = editUser._authPassword || editUser._pendingPassword;
      if (currentPassword && editUser.email) {
        try {
          const cred = await signInWithEmailAndPassword(secondaryAuth, editUser.email, currentPassword);
          if (passwordChanged) {
            await updatePassword(cred.user, editForm.newPassword);
            updateData._authPassword = editForm.newPassword;
          }
          if (emailChanged) {
            await updateEmail(cred.user, editForm.email.trim());
          }
          await firebaseSignOut(secondaryAuth);
        } catch (authErr) {
          console.warn('Could not update Firebase Auth:', authErr);
          // Fallback to _pendingPassword for password changes
          if (passwordChanged) {
            updateData._pendingPassword = editForm.newPassword;
          }
        }
      } else if (passwordChanged) {
        // No stored password, fallback to _pendingPassword
        updateData._pendingPassword = editForm.newPassword;
      }
    }

    try {
      await updateDoc(doc(db, 'users', editUser.id), updateData);
      // Remove schools one by one
      for (const sid of schoolsToRemove) {
        await updateDoc(doc(db, 'users', editUser.id), {
          schoolIds: arrayRemove(sid)
        });
      }
      if (editForm.newPassword) {
        setPasswordSaved(true);
      }
      setEditUser(null);
      isAdmin ? loadAllStaff() : loadStaff();
    } catch (err) {
      setEditError('שגיאה בשמירה: ' + err.message);
    }
  }

  async function handleDelete(userId) {
    if (!confirm('האם להסיר משתמש זה?')) return;
    try {
      // Try to delete from Firebase Auth using stored password
      const userDoc = await getDoc(doc(db, 'users', userId));
      const data = userDoc.data();
      const password = data?._authPassword || data?._pendingPassword;
      if (password && data?.email) {
        try {
          const cred = await signInWithEmailAndPassword(secondaryAuth, data.email, password);
          await deleteUser(cred.user);
        } catch (authErr) {
          console.warn('Could not delete from Firebase Auth:', authErr);
        }
      }
      await deleteDoc(doc(db, 'users', userId));
    } catch (err) {
      console.error('Error deleting user:', err);
    }
    isAdmin ? loadAllStaff() : loadStaff();
  }

  function openEdit(user) {
    setEditUser(user);
    setEditForm({
      fullName: user.fullName || '',
      email: user.email || '',
      phone: user.phone || '',
      role: user.role,
      jobTitle: user.jobTitle || '',
      assignedSchoolId: '',
      newPassword: '',
      customRoleIds: user.customRoleIds || [],
      teamIds: user.teamIds || [],
    });
    setSchoolsToRemove([]);
    setEditError('');
    setPasswordSaved(false);
    setGeneratedPassword('');
  }

  function generateRandomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let password = '';
    for (let i = 0; i < 10; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  async function handleResetPassword() {
    if (!editUser) return;
    setResetPasswordLoading(true);
    setEditError('');
    const newPass = generateRandomPassword();

    const currentPassword = editUser._authPassword || editUser._pendingPassword;
    const updateData = { _authPassword: newPass };

    if (currentPassword && editUser.email) {
      try {
        const cred = await signInWithEmailAndPassword(secondaryAuth, editUser.email, currentPassword);
        await updatePassword(cred.user, newPass);
        await firebaseSignOut(secondaryAuth);
      } catch (authErr) {
        console.warn('Could not update Firebase Auth directly, using pending password:', authErr);
        updateData._pendingPassword = newPass;
      }
    } else {
      updateData._pendingPassword = newPass;
    }

    try {
      await updateDoc(doc(db, 'users', editUser.id), updateData);
      setGeneratedPassword(newPass);
    } catch (err) {
      setEditError('שגיאה באיפוס הסיסמה: ' + err.message);
    }
    setResetPasswordLoading(false);
  }

  async function openPermissions(user) {
    setPermissionsUser(user);
    try {
      const permDoc = await getDoc(doc(db, 'users', user.id));
      const data = permDoc.data();
      if (data?.permissions) {
        setPermissionsForm({ ...getPermissionsForRole(user.role), ...data.permissions });
      } else {
        setPermissionsForm(getPermissionsForRole(user.role));
      }
    } catch {
      setPermissionsForm(getPermissionsForRole(user.role));
    }
    const expanded = {};
    PERMISSION_GROUPS.forEach(g => { expanded[g.label] = true; });
    setExpandedGroups(expanded);
  }

  async function savePermissions() {
    if (!permissionsUser) return;
    try {
      await updateDoc(doc(db, 'users', permissionsUser.id), { permissions: permissionsForm });
      setPermissionsUser(null);
    } catch (err) {
      alert('שגיאה בשמירת ההרשאות: ' + err.message);
    }
  }

  function togglePermission(key) {
    setPermissionsForm(prev => ({ ...prev, [key]: !prev[key] }));
  }

  function toggleGroup(label) {
    setExpandedGroups(prev => ({ ...prev, [label]: !prev[label] }));
  }

  async function handleAddStaff(e) {
    e.preventDefault();
    if (!addForm.fullName.trim() || !addForm.email.trim()) return;
    if (!addForm.password || addForm.password.length < 6) {
      setAddError('הסיסמא חייבת להכיל לפחות 6 תווים');
      return;
    }
    setAddError('');
    const targetSchoolId = addForm.schoolId || schoolId;

    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, addForm.email, addForm.password);
      await firebaseSignOut(secondaryAuth);
      await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        email: addForm.email,
        fullName: addForm.fullName,
        jobTitle: addForm.jobTitle,
        role: addForm.role,
        schoolId: targetSchoolId,
        schoolIds: [targetSchoolId],
        pendingSchools: [],
        permissions: getPermissionsForRole(addForm.role),
        avatarStyle: addForm.avatarStyle || 'default',
        phone: '',
        avatar: '',
        createdAt: new Date().toISOString(),
        _authPassword: addForm.password
      });

      setShowAddModal(false);
      setAddForm({ fullName: '', email: '', jobTitle: '', role: 'viewer', schoolId: '', password: '', avatarStyle: 'default' });
      isAdmin ? loadAllStaff() : loadStaff();
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        setAddError('כתובת הדוא"ל כבר קיימת במערכת');
      } else {
        setAddError('שגיאה בהוספת המשתמש: ' + err.message);
      }
    }
  }

  function openBulkModal() {
    setBulkRows(Array.from({ length: 5 }, () => ({ ...EMPTY_BULK_ROW })));
    setBulkError('');
    setBulkProgress(null);
    setShowBulkModal(true);
  }

  function updateBulkRow(index, field, value) {
    setBulkRows(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }

  function addBulkRow() {
    setBulkRows(prev => [...prev, { ...EMPTY_BULK_ROW }]);
  }

  function removeBulkRow(index) {
    setBulkRows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  }

  function handleBulkPaste(e, startRow, startField) {
    const pasteData = e.clipboardData.getData('text');
    if (!pasteData.includes('\t') && !pasteData.includes('\n')) return; // normal single-cell paste
    e.preventDefault();

    const fields = ['fullName', 'email', 'jobTitle', 'password', 'role'];
    const startCol = fields.indexOf(startField);
    const lines = pasteData.split('\n').filter(line => line.trim());

    setBulkRows(prev => {
      const updated = [...prev];
      // Ensure enough rows
      while (updated.length < startRow + lines.length) {
        updated.push({ ...EMPTY_BULK_ROW });
      }
      lines.forEach((line, lineIdx) => {
        const cells = line.split('\t');
        cells.forEach((cell, cellIdx) => {
          const colIdx = startCol + cellIdx;
          if (colIdx < fields.length) {
            const field = fields[colIdx];
            let value = cell.trim();
            // Normalize role values
            if (field === 'role') {
              const roleMap = { 'צופה': 'viewer', 'עורך': 'editor', 'מנהל מוסד': 'principal', 'viewer': 'viewer', 'editor': 'editor', 'principal': 'principal' };
              value = roleMap[value] || 'viewer';
            }
            updated[startRow + lineIdx] = { ...updated[startRow + lineIdx], [field]: value };
          }
        });
      });
      return updated;
    });
  }

  async function handleBulkAdd() {
    const validRows = bulkRows.filter(r => r.fullName.trim() && r.email.trim());
    if (validRows.length === 0) {
      setBulkError('יש למלא לפחות שורה אחת עם שם ואימייל');
      return;
    }
    const invalidPasswords = validRows.filter(r => !r.password || r.password.length < 6);
    if (invalidPasswords.length > 0) {
      setBulkError('כל השורות המלאות חייבות לכלול סיסמה (לפחות 6 תווים)');
      return;
    }
    setBulkError('');
    const targetSchoolId = schoolId;
    const results = [];
    setBulkProgress({ current: 0, total: validRows.length, results: [] });

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, row.email.trim(), row.password);
        await firebaseSignOut(secondaryAuth);
        await setDoc(doc(db, 'users', cred.user.uid), {
          uid: cred.user.uid,
          email: row.email.trim(),
          fullName: row.fullName.trim(),
          jobTitle: row.jobTitle.trim(),
          role: row.role,
          schoolId: targetSchoolId,
          schoolIds: [targetSchoolId],
          pendingSchools: [],
          permissions: getPermissionsForRole(row.role),
          avatarStyle: 'default',
          phone: '',
          avatar: '',
          createdAt: new Date().toISOString(),
          _authPassword: row.password,
        });
        results.push({ name: row.fullName, success: true });
      } catch (err) {
        const errorMsg = err.code === 'auth/email-already-in-use' ? 'אימייל כבר קיים' : err.message;
        results.push({ name: row.fullName, success: false, error: errorMsg });
      }
      setBulkProgress({ current: i + 1, total: validRows.length, results: [...results] });
    }

    isAdmin ? loadAllStaff() : loadStaff();
  }

  // Get school names for a user
  function getUserSchoolNames(user) {
    const ids = user.schoolIds || (user.schoolId ? [user.schoolId] : []);
    return ids
      .map(sid => schools.find(s => s.id === sid)?.name || sid)
      .filter(Boolean);
  }

  const canManage = canEdit; // isPrincipal() || isAdmin

  function isUserOnline(user) {
    if (!user.lastSeen) return false;
    if (user.isOnline) {
      // Consider online if lastSeen within last 3 minutes
      const diff = Date.now() - new Date(user.lastSeen).getTime();
      return diff < 180000;
    }
    return false;
  }

  function getLastSeenText(user) {
    if (!user.lastSeen) return 'לא התחבר/ה מעולם';
    if (isUserOnline(user)) return 'מחובר/ת כעת';
    const d = new Date(user.lastSeen);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `נראה/ת לפני ${diffMin} דק׳`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `נראה/ת לפני ${diffHours} שע׳`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `נראה/ת לפני ${diffDays} ימים`;
    return `נראה/ת ב-${d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
  }

  // Can the logged-in user edit this staff member?
  function canEditUser(user) {
    if (isAdmin) return true;
    if (!isPrincipal()) return false;
    // Principal can edit only viewer/editor in their own school (not other principals/admins)
    const userSchoolIds = user.schoolIds || (user.schoolId ? [user.schoolId] : []);
    const inMySchool = userSchoolIds.includes(schoolId);
    const isHigherRole = user.role === 'principal' || user.role === 'global_admin';
    return inMySchool && !isHigherRole;
  }

  // Can the logged-in user delete this staff member?
  // Principals can delete editors/viewers in their school; admins can delete anyone
  function canDeleteUser(user) {
    if (isAdmin) return true;
    if (!isPrincipal()) return false;
    const userSchoolIds = user.schoolIds || (user.schoolId ? [user.schoolId] : []);
    const inMySchool = userSchoolIds.includes(schoolId);
    const isHigherRole = user.role === 'principal' || user.role === 'global_admin';
    return inMySchool && !isHigherRole;
  }

  // Context menu handlers
  function handleContextMenu(e, user) {
    e.preventDefault();
    const menuWidth = 200;
    const menuHeight = 140;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
    if (x < 0) x = 8;
    if (y < 0) y = 8;
    setContextMenu({ x, y, user });
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  useEffect(() => {
    if (!contextMenu) return;
    function handleClick() { closeContextMenu(); }
    function handleScroll() { closeContextMenu(); }
    window.addEventListener('click', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu]);

  function handleSendMessage(user) {
    closeContextMenu();
    navigate(`/messages?userId=${user.id}`);
  }

  async function handleAttachToTask(user) {
    closeContextMenu();
    setTaskAttachUser(user);
    setTaskListLoading(true);
    try {
      const tasksSnap = await getDocs(collection(db, `tasks_${schoolId}`));
      setTaskList(tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading tasks:', err);
      setTaskList([]);
    }
    setTaskListLoading(false);
  }

  async function assignUserToTask(taskId) {
    if (!taskAttachUser) return;
    try {
      await updateDoc(doc(db, `tasks_${schoolId}`, taskId), {
        assigneeIds: arrayUnion(taskAttachUser.id)
      });
      setTaskAttachUser(null);
      setTaskList([]);
    } catch (err) {
      console.error('Error assigning user to task:', err);
    }
  }

  async function openProfilePopup(user) {
    closeContextMenu();
    setProfileUser(user);
    setProfileLoading(true);
    setProfileTasks([]);
    setProfileActivity(null);
    try {
      const tasksQuery = query(
        collection(db, `tasks_${schoolId}`),
        where('assigneeIds', 'array-contains', user.id),
        limit(5)
      );
      const tasksSnap = await getDocs(tasksQuery);
      setProfileTasks(tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error('Error loading profile tasks:', err);
    }
    try {
      const announcementsQuery = query(
        collection(db, `announcements_${schoolId}`),
        where('authorId', '==', user.id),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      const announcementsSnap = await getDocs(announcementsQuery);
      if (!announcementsSnap.empty) {
        const latest = announcementsSnap.docs[0].data();
        setProfileActivity({ type: 'announcement', date: latest.createdAt });
      } else {
        const messagesQuery = query(
          collection(db, `messages_${schoolId}`),
          where('senderId', '==', user.id),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
        const messagesSnap = await getDocs(messagesQuery);
        if (!messagesSnap.empty) {
          const latest = messagesSnap.docs[0].data();
          setProfileActivity({ type: 'message', date: latest.createdAt });
        }
      }
    } catch (err) {
      console.error('Error loading profile activity:', err);
    }
    setProfileLoading(false);
  }

  function getUserTeamNames(user) {
    if (!user.teamIds || user.teamIds.length === 0) return [];
    return user.teamIds
      .map(tid => teams.find(t => t.id === tid)?.name)
      .filter(Boolean);
  }

  function formatActivityDate(dateVal) {
    if (!dateVal) return '';
    try {
      const d = dateVal.toDate ? dateVal.toDate() : new Date(dateVal);
      return d.toLocaleDateString('he-IL');
    } catch {
      return String(dateVal);
    }
  }

  // Filtered staff
  const filteredStaff = staff.filter(user => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        (user.fullName || '').toLowerCase().includes(q) ||
        (user.email || '').toLowerCase().includes(q) ||
        (user.jobTitle || '').toLowerCase().includes(q) ||
        (ROLE_LABELS[user.role] || '').includes(q);
      if (!match) return false;
    }
    if (filterRole && user.role !== filterRole) return false;
    if (filterSchool) {
      const ids = user.schoolIds || (user.schoolId ? [user.schoolId] : []);
      if (!ids.includes(filterSchool)) return false;
    }
    return true;
  });

  const activeFilters = (filterRole ? 1 : 0) + (filterSchool ? 1 : 0);

  return (
    <div className="page">
      <Header title="סגל וקהילה" />
      <div className="page-content">
        <div className="page-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div className="view-toggle">
              <button className={`toggle-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>
                טבלה
              </button>
              <button className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>
                כרטיסיות
              </button>
            </div>
            {canEdit && (
              <>
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                  <UserPlus size={16} />
                  הוספת איש צוות
                </button>
                <button className="btn btn-primary" onClick={openBulkModal} style={{ background: '#059669' }}>
                  <Users size={16} />
                  הוספה מרובה
                </button>
                <button className="btn btn-secondary" onClick={() => setShowRolesManager(true)}>
                  <Shield size={16} />
                  ניהול תפקידים
                </button>
              </>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div className="search-bar">
              <Search size={14} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="חיפוש צוות..."
              />
            </div>
            <button
              className={`btn btn-secondary btn-sm staff-filter-btn ${activeFilters > 0 ? 'staff-filter-btn--active' : ''}`}
              onClick={() => setShowFilters(f => !f)}
            >
              <Filter size={14} />
              סינון
              {activeFilters > 0 && <span className="filter-badge">{activeFilters}</span>}
            </button>
            <span className="staff-count">{filteredStaff.length} אנשי צוות</span>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="staff-filters-bar">
            <div className="staff-filter-group">
              <label>תפקיד</label>
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)}>
                <option value="">הכל</option>
                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            {isAdmin && (
              <div className="staff-filter-group">
                <label>מסגרת</label>
                <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)}>
                  <option value="">הכל</option>
                  {schools.map(s => (
                    <option key={s.id} value={s.id}>{s.name || s.id}</option>
                  ))}
                </select>
              </div>
            )}
            {activeFilters > 0 && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setFilterRole(''); setFilterSchool(''); }}>
                <X size={13} />
                נקה סינון
              </button>
            )}
          </div>
        )}

        {/* Pending Approvals */}
        {canApprove && pendingUsers.length > 0 && (
          <div className="pending-approval-section" style={{ marginBottom: '1.5rem', padding: '1rem', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.95rem', color: '#92400e' }}>
              ממתינים לאישור ({pendingUsers.length})
            </h3>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>שם</th>
                    <th>תפקיד</th>
                    <th>דוא"ל</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map(user => (
                    <tr key={user.id}>
                      <td className="td-bold">
                        <div className="td-user">
                          <div className="td-avatar">{user.fullName?.charAt(0)}</div>
                          {user.fullName}
                        </div>
                      </td>
                      <td>{user.jobTitle || '—'}</td>
                      <td dir="ltr">{user.email}</td>
                      <td>
                        <div className="td-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleApprove(user.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <CheckCircle size={14} /> אישור
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => handleReject(user.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#ef4444' }}>
                            <XCircle size={14} /> דחייה
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Staff Grid */}
        {viewMode === 'grid' ? (
          <div className="staff-grid">
            {filteredStaff.map(user => {
              const schoolNames = getUserSchoolNames(user);
              return (
                <div key={user.id} className="staff-card" onContextMenu={e => handleContextMenu(e, user)}>
                  <div className="staff-card-avatar-wrap">
                    <div className="staff-card-avatar">{user.fullName?.charAt(0) || '?'}</div>
                    <span className={`staff-online-dot ${isUserOnline(user) ? 'staff-online-dot--online' : ''}`} title={getLastSeenText(user)} />
                  </div>
                  <h4 className="staff-card-name">{user.fullName}</h4>
                  <p className="staff-card-title">{user.jobTitle || '—'}</p>
                  {canManage && (
                    <p className="staff-card-lastseen">{getLastSeenText(user)}</p>
                  )}
                  <span className={`role-badge role-${user.role}`}>{ROLE_LABELS[user.role] || 'צופה'}</span>
                  {/* Custom roles */}
                  {user.customRoleIds && user.customRoleIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', justifyContent: 'center', marginTop: '0.3rem' }}>
                      {user.customRoleIds.map(rid => {
                        const r = customRoles.find(cr => cr.id === rid);
                        return r ? <span key={rid} style={{ fontSize: '0.68rem', background: '#ede9fe', color: '#6d28d9', padding: '0.1rem 0.4rem', borderRadius: 4 }}>{r.name}</span> : null;
                      })}
                    </div>
                  )}
                  {/* Teams */}
                  {user.teamIds && user.teamIds.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.2rem', justifyContent: 'center', marginTop: '0.3rem' }}>
                      {user.teamIds.map(tid => {
                        const t = teams.find(tm => tm.id === tid);
                        return t ? <span key={tid} style={{ fontSize: '0.68rem', background: '#ecfdf5', color: '#065f46', padding: '0.1rem 0.4rem', borderRadius: 4 }}>{t.name}</span> : null;
                      })}
                    </div>
                  )}
                  {schoolNames.length > 0 && (
                    <p className="staff-card-school">{schoolNames.join(' • ')}</p>
                  )}
                  <p className="staff-card-email">{user.email}</p>
                  {canEditUser(user) && (
                    <div className="staff-card-actions">
                      <button className="icon-btn" onClick={() => openPermissions(user)} title="הרשאות מפורטות">
                        <Shield size={14} />
                      </button>
                      <button className="icon-btn" onClick={() => openEdit(user)} title="עריכה">
                        <Edit3 size={14} />
                      </button>
                      {canDeleteUser(user) && (
                        <button className="icon-btn icon-btn--danger" onClick={() => handleDelete(user.id)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>שם</th>
                  <th>תפקיד</th>
                  <th>דוא"ל</th>
                  <th>מסגרת</th>
                  <th>הרשאה</th>
                  {canEdit && <th>פעולות</th>}
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map(user => {
                  const schoolNames = getUserSchoolNames(user);
                  return (
                    <tr key={user.id} onContextMenu={e => handleContextMenu(e, user)}>
                      <td className="td-bold">
                        <div className="td-user">
                          <div className="td-avatar">{user.fullName?.charAt(0)}</div>
                          {user.fullName}
                        </div>
                      </td>
                      <td>{user.jobTitle || '—'}</td>
                      <td dir="ltr">{user.email}</td>
                      <td>
                        <div className="td-schools">
                          {schoolNames.length > 0
                            ? schoolNames.map((name, i) => (
                              <span key={i} className="school-tag">{name}</span>
                            ))
                            : <span style={{ color: '#94a3b8', fontSize: '0.78rem' }}>—</span>
                          }
                        </div>
                      </td>
                      <td>
                        <span className={`role-badge role-${user.role}`}>
                          {ROLE_LABELS[user.role] || 'צופה'}
                        </span>
                      </td>
                      {canEdit && (
                        <td>
                          <div className="td-actions">
                            {canEditUser(user) ? (
                              <>
                                <button className="icon-btn" title="הרשאות מפורטות" onClick={() => openPermissions(user)}>
                                  <Shield size={15} />
                                </button>
                                <button className="icon-btn" title="עריכה" onClick={() => openEdit(user)}>
                                  <Edit3 size={15} />
                                </button>
                                {canDeleteUser(user) && (
                                  <button className="icon-btn icon-btn--danger" title="הסרה" onClick={() => handleDelete(user.id)}>
                                    <Trash2 size={15} />
                                  </button>
                                )}
                              </>
                            ) : (
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>—</span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredStaff.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 6 : 5} className="td-empty">
                      {searchQuery || filterRole || filterSchool ? 'לא נמצאו תוצאות' : 'אין אנשי צוות רשומים'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Edit Staff Modal */}
        {editUser && (
          <div className="modal-overlay" onClick={() => setEditUser(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>עריכת איש צוות — {editUser.fullName}</h3>
                <button className="modal-close" onClick={() => setEditUser(null)}><X size={18} /></button>
              </div>
              <div className="modal-form">
                <div className="add-staff-form">
                  <div className="form-group">
                    <label>
                      <User size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.3rem' }} />
                      שם מלא
                    </label>
                    <input
                      value={editForm.fullName}
                      onChange={e => setEditForm(prev => ({ ...prev, fullName: e.target.value }))}
                      placeholder="שם פרטי ומשפחה"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      <Mail size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.3rem' }} />
                      דוא"ל
                    </label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="email@example.com"
                      dir="ltr"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      <Phone size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.3rem' }} />
                      טלפון
                    </label>
                    <input
                      value={editForm.phone}
                      onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="מספר טלפון"
                      dir="ltr"
                    />
                  </div>
                  <div className="form-group">
                    <label>תפקיד</label>
                    <input
                      value={editForm.jobTitle}
                      onChange={e => setEditForm(prev => ({ ...prev, jobTitle: e.target.value }))}
                      placeholder="תפקיד"
                    />
                  </div>
                  <div className="form-group">
                    <label>הרשאה</label>
                    <select
                      value={editForm.role}
                      onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value }))}
                    >
                      <option value="viewer">צופה</option>
                      <option value="editor">עורך</option>
                      {isAdmin && <option value="principal">מנהל מוסד</option>}
                      {isAdmin && <option value="global_admin">מנהל על</option>}
                    </select>
                  </div>

                  {/* Current Schools with removal */}
                  {(() => {
                    const userSchoolIds = (editUser.schoolIds || (editUser.schoolId ? [editUser.schoolId] : [])).filter(sid => !schoolsToRemove.includes(sid));
                    return userSchoolIds.length > 0 && (
                      <div className="form-group">
                        <label>מסגרות נוכחיות</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                          {userSchoolIds.map(sid => {
                            const schoolName = schools.find(s => s.id === sid)?.name || sid;
                            return (
                              <span key={sid} className="school-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.5rem' }}>
                                {schoolName}
                                {(isAdmin || (isPrincipal() && sid === schoolId)) && (
                                  <button
                                    type="button"
                                    onClick={() => setSchoolsToRemove(prev => [...prev, sid])}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#ef4444' }}
                                    title="הסר מסגרת"
                                  >
                                    <XCircle size={13} />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                        {schoolsToRemove.length > 0 && (
                          <span style={{ fontSize: '0.7rem', color: '#f59e0b' }}>
                            {schoolsToRemove.length} מסגרות יוסרו בשמירה
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {isAdmin && (
                    <div className="form-group">
                      <label>שיוך למסגרת נוספת</label>
                      <select
                        value={editForm.assignedSchoolId}
                        onChange={e => setEditForm(prev => ({ ...prev, assignedSchoolId: e.target.value }))}
                      >
                        <option value="">ללא שינוי</option>
                        {schools.map(s => (
                          <option key={s.id} value={s.id}>{s.name || s.id}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Custom Roles */}
                  {customRoles.length > 0 && (
                    <div className="form-group">
                      <label>
                        <Shield size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.3rem' }} />
                        תפקידים מותאמים
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {customRoles.map(role => (
                          <label key={role.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', background: editForm.customRoleIds.includes(role.id) ? '#eff6ff' : '#fff' }}>
                            <input
                              type="checkbox"
                              checked={editForm.customRoleIds.includes(role.id)}
                              onChange={() => setEditForm(prev => ({
                                ...prev,
                                customRoleIds: prev.customRoleIds.includes(role.id)
                                  ? prev.customRoleIds.filter(id => id !== role.id)
                                  : [...prev.customRoleIds, role.id]
                              }))}
                            />
                            {role.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Teams */}
                  {teams.length > 0 && (
                    <div className="form-group">
                      <label>צוותים</label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                        {teams.map(team => (
                          <label key={team.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.3rem 0.6rem', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: '0.8rem', cursor: 'pointer', background: editForm.teamIds.includes(team.id) ? '#eff6ff' : '#fff' }}>
                            <input
                              type="checkbox"
                              checked={editForm.teamIds.includes(team.id)}
                              onChange={() => setEditForm(prev => ({
                                ...prev,
                                teamIds: prev.teamIds.includes(team.id)
                                  ? prev.teamIds.filter(id => id !== team.id)
                                  : [...prev.teamIds, team.id]
                              }))}
                            />
                            {team.name}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Password Change Section */}
                  <div className="form-group">
                    <label>
                      <Lock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.3rem' }} />
                      קביעת סיסמא חדשה
                    </label>
                    <input
                      type="password"
                      value={editForm.newPassword}
                      onChange={e => setEditForm(prev => ({ ...prev, newPassword: e.target.value }))}
                      placeholder="סיסמא חדשה (לפחות 6 תווים)"
                      dir="ltr"
                      minLength={6}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                      הסיסמא תיכנס לתוקף בכניסה הבאה של המשתמש למערכת. השאירו ריק אם אין צורך בשינוי.
                    </span>
                  </div>

                  {/* Admin Reset Password */}
                  <div className="form-group">
                    <label>
                      <Key size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.3rem' }} />
                      איפוס סיסמה אקראי
                    </label>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleResetPassword}
                      disabled={resetPasswordLoading}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: 'fit-content' }}
                    >
                      <RefreshCw size={14} className={resetPasswordLoading ? 'spin' : ''} />
                      {resetPasswordLoading ? 'מאפס...' : 'הנפק סיסמה אקראית'}
                    </button>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                      הסיסמה תיווצר באופן אקראי ותוצג רק לך. העבר/י אותה למשתמש מחוץ למערכת.
                    </span>

                    {generatedPassword && (
                      <div style={{
                        marginTop: '0.5rem',
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: 8,
                        padding: '0.75rem 1rem',
                      }}>
                        <div style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600, marginBottom: '0.35rem' }}>
                          הסיסמה החדשה נוצרה בהצלחה:
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          background: '#fff',
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          padding: '0.5rem 0.75rem',
                        }}>
                          <code style={{
                            flex: 1,
                            fontSize: '1.05rem',
                            fontWeight: 700,
                            letterSpacing: '0.05em',
                            color: '#1e293b',
                            direction: 'ltr',
                            userSelect: 'all',
                          }}>
                            {generatedPassword}
                          </code>
                          <button
                            type="button"
                            onClick={() => { navigator.clipboard.writeText(generatedPassword); }}
                            style={{
                              background: 'none',
                              border: '1px solid #d1d5db',
                              borderRadius: 4,
                              cursor: 'pointer',
                              padding: '0.3rem',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                            title="העתק סיסמה"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: '0.35rem', fontWeight: 500 }}>
                          שימו לב: הסיסמה לא תוצג שוב לאחר סגירת החלון. העתיקו אותה עכשיו.
                        </div>
                      </div>
                    )}
                  </div>

                  {editError && (
                    <div style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 500 }}>{editError}</div>
                  )}
                  <div className="modal-actions">
                    <button className="btn btn-primary" onClick={handleSaveEdit}>
                      <Save size={15} />
                      שמירה
                    </button>
                    <button className="btn btn-secondary" onClick={() => setEditUser(null)}>ביטול</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Add Staff Modal */}
        {showAddModal && (
          <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>הוספת איש צוות</h3>
                <button className="modal-close" onClick={() => setShowAddModal(false)}><X size={18} /></button>
              </div>
              <div className="modal-form">
                <form onSubmit={handleAddStaff} className="add-staff-form">
                  <div className="form-group">
                    <label>שם מלא</label>
                    <input
                      value={addForm.fullName}
                      onChange={e => setAddForm(prev => ({ ...prev, fullName: e.target.value }))}
                      placeholder="שם פרטי ומשפחה"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>דוא"ל</label>
                    <input
                      type="email"
                      value={addForm.email}
                      onChange={e => setAddForm(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="email@example.com"
                      dir="ltr"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>
                      <Lock size={14} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.3rem' }} />
                      סיסמא
                    </label>
                    <input
                      type="password"
                      value={addForm.password}
                      onChange={e => setAddForm(prev => ({ ...prev, password: e.target.value }))}
                      placeholder="סיסמא (לפחות 6 תווים)"
                      dir="ltr"
                      required
                      minLength={6}
                    />
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                      הסיסמא תשמש את איש הצוות להתחברות למערכת
                    </span>
                  </div>
                  <div className="form-group">
                    <label>תפקיד</label>
                    <input
                      value={addForm.jobTitle}
                      onChange={e => setAddForm(prev => ({ ...prev, jobTitle: e.target.value }))}
                      placeholder="תפקיד"
                    />
                  </div>
                  <div className="form-group">
                    <label>מסגרת</label>
                    <select
                      value={addForm.schoolId}
                      onChange={e => setAddForm(prev => ({ ...prev, schoolId: e.target.value }))}
                    >
                      <option value="">מוסד נוכחי</option>
                      {schools.map(s => (
                        <option key={s.id} value={s.id}>{s.name || s.id}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>הרשאה</label>
                    <select
                      value={addForm.role}
                      onChange={e => setAddForm(prev => ({ ...prev, role: e.target.value }))}
                    >
                      <option value="viewer">צופה</option>
                      <option value="editor">עורך</option>
                      {isAdmin && <option value="principal">מנהל מוסד</option>}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>סגנון אוואטר</label>
                    <div className="avatar-style-picker">
                      {AVATAR_STYLES.map(s => (
                        <button
                          key={s.key}
                          type="button"
                          className={`avatar-style-option avatar-style--${s.key} ${addForm.avatarStyle === s.key ? 'avatar-style-option--active' : ''}`}
                          onClick={() => setAddForm(prev => ({ ...prev, avatarStyle: s.key }))}
                          title={s.label}
                        >
                          {addForm.fullName?.charAt(0) || '?'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {addError && (
                    <div style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 500 }}>{addError}</div>
                  )}
                  <div className="modal-actions">
                    <button type="submit" className="btn btn-primary">הוספה</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowAddModal(false)}>ביטול</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Add Modal */}
        {showBulkModal && (
          <div className="modal-overlay" onClick={() => !bulkProgress && setShowBulkModal(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '96vw' }}>
              <div className="modal-header">
                <h3>
                  <Users size={18} style={{ display: 'inline', verticalAlign: 'middle', marginLeft: '0.4rem' }} />
                  הוספת אנשי צוות מרובים
                </h3>
                <button className="modal-close" onClick={() => !bulkProgress && setShowBulkModal(false)}><X size={18} /></button>
              </div>
              <div className="modal-form" style={{ padding: '0.75rem' }}>
                {!bulkProgress ? (
                  <>
                    <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.5rem' }}>
                      מלאו את הטבלה או הדביקו נתונים מאקסל (שם, אימייל, תפקיד, סיסמה, הרשאה). ניתן להדביק שורות וטורים ישירות מגיליון אלקטרוני.
                    </p>
                    <div className="bulk-table-wrapper">
                      <table className="bulk-table">
                        <thead>
                          <tr>
                            <th style={{ width: 36 }}>#</th>
                            <th>שם מלא</th>
                            <th>אימייל</th>
                            <th>תפקיד</th>
                            <th>סיסמה</th>
                            <th>הרשאה</th>
                            <th style={{ width: 36 }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkRows.map((row, idx) => (
                            <tr key={idx} className={row.fullName.trim() && row.email.trim() ? 'bulk-row--filled' : ''}>
                              <td className="bulk-row-num">{idx + 1}</td>
                              <td>
                                <input
                                  value={row.fullName}
                                  onChange={e => updateBulkRow(idx, 'fullName', e.target.value)}
                                  onPaste={e => handleBulkPaste(e, idx, 'fullName')}
                                  placeholder="שם פרטי ומשפחה"
                                  className="bulk-input"
                                />
                              </td>
                              <td>
                                <input
                                  value={row.email}
                                  onChange={e => updateBulkRow(idx, 'email', e.target.value)}
                                  onPaste={e => handleBulkPaste(e, idx, 'email')}
                                  placeholder="email@example.com"
                                  dir="ltr"
                                  className="bulk-input"
                                />
                              </td>
                              <td>
                                <input
                                  value={row.jobTitle}
                                  onChange={e => updateBulkRow(idx, 'jobTitle', e.target.value)}
                                  onPaste={e => handleBulkPaste(e, idx, 'jobTitle')}
                                  placeholder="תפקיד"
                                  className="bulk-input"
                                />
                              </td>
                              <td>
                                <input
                                  value={row.password}
                                  onChange={e => updateBulkRow(idx, 'password', e.target.value)}
                                  onPaste={e => handleBulkPaste(e, idx, 'password')}
                                  placeholder="סיסמה (6+ תווים)"
                                  dir="ltr"
                                  className="bulk-input"
                                />
                              </td>
                              <td>
                                <select
                                  value={row.role}
                                  onChange={e => updateBulkRow(idx, 'role', e.target.value)}
                                  className="bulk-select"
                                >
                                  <option value="viewer">צופה</option>
                                  <option value="editor">עורך</option>
                                  {isAdmin && <option value="principal">מנהל מוסד</option>}
                                </select>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="bulk-remove-btn"
                                  onClick={() => removeBulkRow(idx)}
                                  title="הסר שורה"
                                >
                                  <Trash size={13} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={addBulkRow}>
                        <Plus size={14} />
                        הוסף שורה
                      </button>
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                        {bulkRows.filter(r => r.fullName.trim() && r.email.trim()).length} שורות מלאות מתוך {bulkRows.length}
                      </span>
                    </div>
                    {bulkError && (
                      <div style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 500, marginTop: '0.5rem' }}>
                        {bulkError}
                      </div>
                    )}
                    <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleBulkAdd}
                        style={{ background: '#059669' }}
                      >
                        <UserPlus size={15} />
                        הוסף {bulkRows.filter(r => r.fullName.trim() && r.email.trim()).length} אנשי צוות
                      </button>
                      <button type="button" className="btn btn-secondary" onClick={() => setShowBulkModal(false)}>ביטול</button>
                    </div>
                  </>
                ) : (
                  <div className="bulk-progress">
                    <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                      <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.35rem' }}>
                        {bulkProgress.current < bulkProgress.total ? 'מוסיף אנשי צוות...' : 'הוספה הושלמה'}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
                        {bulkProgress.current} / {bulkProgress.total}
                      </div>
                      <div className="bulk-progress-bar">
                        <div
                          className="bulk-progress-fill"
                          style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="bulk-results">
                      {bulkProgress.results.map((result, idx) => (
                        <div key={idx} className={`bulk-result-item ${result.success ? 'bulk-result--success' : 'bulk-result--error'}`}>
                          {result.success ? <Check size={14} /> : <AlertCircle size={14} />}
                          <span>{result.name}</span>
                          {!result.success && <span className="bulk-result-error">{result.error}</span>}
                        </div>
                      ))}
                    </div>
                    {bulkProgress.current === bulkProgress.total && (
                      <div className="modal-actions" style={{ marginTop: '0.75rem' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => { setShowBulkModal(false); setBulkProgress(null); }}
                        >
                          סגור
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Detailed Permissions Modal */}
        {permissionsUser && (
          <div className="modal-overlay" onClick={() => setPermissionsUser(null)}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 540 }}>
              <div className="modal-header">
                <h3>הרשאות — {permissionsUser.fullName}</h3>
                <button className="modal-close" onClick={() => setPermissionsUser(null)}><X size={18} /></button>
              </div>
              <div style={{ padding: '0.75rem 1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>תפקיד מערכת:</span>
                  <span className={`role-badge role-${permissionsUser.role}`}>
                    {ROLE_LABELS[permissionsUser.role] || 'צופה'}
                  </span>
                </div>
                {/* Custom roles */}
                {permissionsUser.customRoleIds && permissionsUser.customRoleIds.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>תפקידים מותאמים:</span>
                    {permissionsUser.customRoleIds.map(rid => {
                      const r = customRoles.find(cr => cr.id === rid);
                      return r ? <span key={rid} style={{ fontSize: '0.72rem', background: '#ede9fe', color: '#6d28d9', padding: '0.15rem 0.4rem', borderRadius: 4 }}>{r.name}</span> : null;
                    })}
                  </div>
                )}
                {/* Teams */}
                {permissionsUser.teamIds && permissionsUser.teamIds.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>צוותים:</span>
                    {permissionsUser.teamIds.map(tid => {
                      const t = teams.find(tm => tm.id === tid);
                      return t ? <span key={tid} style={{ fontSize: '0.72rem', background: '#ecfdf5', color: '#065f46', padding: '0.15rem 0.4rem', borderRadius: 4 }}>{t.name}</span> : null;
                    })}
                  </div>
                )}
                <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0 0 1rem' }}>
                  ניתן להתאים את ההרשאות לכל משתמש בנפרד. הרשאות מתפקידים מותאמים יתווספו אוטומטית.
                </p>
              </div>
              <div className="permissions-list">
                {PERMISSION_GROUPS.map(group => (
                  <div key={group.label} className="permissions-group">
                    <button className="permissions-group-header" onClick={() => toggleGroup(group.label)}>
                      <span className="permissions-group-title">{group.label}</span>
                      <span className="permissions-group-summary">
                        {group.permissions.filter(p => permissionsForm[p.key]).length}/{group.permissions.length}
                      </span>
                      {expandedGroups[group.label] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {expandedGroups[group.label] && (
                      <div className="permissions-group-items">
                        {group.permissions.map(perm => (
                          <label key={perm.key} className="permissions-item">
                            <input
                              type="checkbox"
                              checked={!!permissionsForm[perm.key]}
                              onChange={() => togglePermission(perm.key)}
                            />
                            <span>{perm.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="modal-actions" style={{ padding: '1rem 1.5rem' }}>
                <button className="btn btn-primary" onClick={savePermissions}>
                  <Save size={16} />
                  שמירת הרשאות
                </button>
                <button className="btn btn-secondary" onClick={() => setPermissionsUser(null)}>ביטול</button>
              </div>
            </div>
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="staff-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={e => e.stopPropagation()}
          >
            <button className="staff-context-menu-item" onClick={() => handleSendMessage(contextMenu.user)}>
              <MessageCircle size={15} />
              <span>שלח הודעה פרטית</span>
            </button>
            <button className="staff-context-menu-item" onClick={() => handleAttachToTask(contextMenu.user)}>
              <Briefcase size={15} />
              <span>צרף למשימה</span>
            </button>
            <button className="staff-context-menu-item" onClick={() => openProfilePopup(contextMenu.user)}>
              <Eye size={15} />
              <span>כרטיס אישי</span>
            </button>
          </div>
        )}

        {/* Task Attachment Popup */}
        {taskAttachUser && (
          <div className="modal-overlay" onClick={() => { setTaskAttachUser(null); setTaskList([]); }}>
            <div className="modal-content staff-task-attach-modal" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>צרף את {taskAttachUser.fullName} למשימה</h3>
                <button className="modal-close" onClick={() => { setTaskAttachUser(null); setTaskList([]); }}><X size={18} /></button>
              </div>
              <div className="staff-task-attach-body">
                {taskListLoading ? (
                  <p className="staff-task-attach-empty">טוען משימות...</p>
                ) : taskList.length === 0 ? (
                  <p className="staff-task-attach-empty">לא נמצאו משימות</p>
                ) : (
                  <div className="staff-task-attach-list">
                    {taskList.map(task => {
                      const alreadyAssigned = (task.assigneeIds || []).includes(taskAttachUser.id);
                      return (
                        <button
                          key={task.id}
                          className={`staff-task-attach-item ${alreadyAssigned ? 'staff-task-attach-item--assigned' : ''}`}
                          onClick={() => !alreadyAssigned && assignUserToTask(task.id)}
                          disabled={alreadyAssigned}
                        >
                          <Briefcase size={14} />
                          <span className="staff-task-attach-item-title">{task.title || task.name || 'משימה ללא שם'}</span>
                          {alreadyAssigned && <span className="staff-task-attach-item-badge">משויך</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Profile Popup */}
        {profileUser && (
          <div className="modal-overlay" onClick={() => setProfileUser(null)}>
            <div className="modal-content staff-profile-modal" onClick={e => e.stopPropagation()}>
              <button className="modal-close staff-profile-close" onClick={() => setProfileUser(null)}><X size={18} /></button>
              <div className="staff-profile-header">
                <div className={`staff-profile-avatar avatar-style--${profileUser.avatarStyle || 'default'}`}>
                  {profileUser.fullName?.charAt(0) || '?'}
                </div>
                <h3 className="staff-profile-name">{profileUser.fullName}</h3>
                {profileUser.jobTitle && (
                  <p className="staff-profile-job">{profileUser.jobTitle}</p>
                )}
                <span className={`role-badge role-${profileUser.role}`}>
                  {ROLE_LABELS[profileUser.role] || 'צופה'}
                </span>
              </div>
              <div className="staff-profile-body">
                {/* Contact info */}
                <div className="staff-profile-section">
                  <div className="staff-profile-contact">
                    <Mail size={14} />
                    <span dir="ltr">{profileUser.email}</span>
                  </div>
                  {profileUser.phone && (
                    <div className="staff-profile-contact">
                      <Phone size={14} />
                      <span dir="ltr">{profileUser.phone}</span>
                    </div>
                  )}
                </div>

                {/* Teams */}
                {(() => {
                  const teamNames = getUserTeamNames(profileUser);
                  return teamNames.length > 0 && (
                    <div className="staff-profile-section">
                      <h4 className="staff-profile-section-title">צוותים</h4>
                      <div className="staff-profile-tags">
                        {teamNames.map((name, i) => (
                          <span key={i} className="staff-profile-tag staff-profile-tag--team">{name}</span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Custom roles */}
                {profileUser.customRoleIds && profileUser.customRoleIds.length > 0 && (
                  <div className="staff-profile-section">
                    <h4 className="staff-profile-section-title">תפקידים מותאמים</h4>
                    <div className="staff-profile-tags">
                      {profileUser.customRoleIds.map(rid => {
                        const r = customRoles.find(cr => cr.id === rid);
                        return r ? <span key={rid} className="staff-profile-tag staff-profile-tag--role">{r.name}</span> : null;
                      })}
                    </div>
                  </div>
                )}

                {/* Recent tasks */}
                <div className="staff-profile-section">
                  <h4 className="staff-profile-section-title">משימות אחרונות</h4>
                  {profileLoading ? (
                    <p className="staff-profile-muted">טוען...</p>
                  ) : profileTasks.length === 0 ? (
                    <p className="staff-profile-muted">אין משימות מוקצות</p>
                  ) : (
                    <div className="staff-profile-tasks">
                      {profileTasks.map(task => (
                        <div key={task.id} className="staff-profile-task-item">
                          <Briefcase size={13} />
                          <span>{task.title || task.name || 'משימה ללא שם'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent activity */}
                <div className="staff-profile-section">
                  <h4 className="staff-profile-section-title">פעילות אחרונה</h4>
                  {profileLoading ? (
                    <p className="staff-profile-muted">טוען...</p>
                  ) : profileActivity ? (
                    <p className="staff-profile-activity">
                      {profileActivity.type === 'announcement' ? 'פרסם הודעה' : 'שלח הודעה'}
                      {' '}
                      <span className="staff-profile-activity-date">{formatActivityDate(profileActivity.date)}</span>
                    </p>
                  ) : (
                    <p className="staff-profile-muted">אין פעילות אחרונה</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Roles Manager Modal */}
        {showRolesManager && (
          <RolesManager
            schoolId={schoolId}
            onClose={() => { setShowRolesManager(false); loadCustomRoles(); }}
          />
        )}
      </div>
    </div>
  );
}
