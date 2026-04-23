import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { db, storage } from '../../firebase';
import PermissionsMenu from '../Shared/PermissionsMenu';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import { usePermissions } from '../../hooks/usePermissions';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  orderBy,
  onSnapshot,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import Header from '../Layout/Header';
import SpreadsheetEditor from './SpreadsheetEditor';
import DocumentEditor from './DocumentEditor';
import {
  FolderPlus,
  Upload,
  Trash2,
  FileText,
  Folder,
  FolderOpen,
  Download,
  Lock,
  X,
  Table2,
  FileEdit,
  Plus,
  Save,
  Search,
  Pin,
  ChevronDown,
  ChevronLeft,
  Maximize2,
  Minimize2,
  Share2,
  Pencil,
  Info,
  MoreVertical,
  Copy,
  History,
  Clock
} from 'lucide-react';
import { createNotifications } from '../../utils/notifications';
import '../Gantt/Gantt.css';
import './Files.css';

export default function FileManager() {
  const { userData, currentUser, selectedSchool, isPrincipal, isGlobalAdmin, isViewer } = useAuth();
  const { permissions } = usePermissions();
  const [showPermissionsPanel, setShowPermissionsPanel] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const uid = currentUser?.uid;
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderVisibility, setFolderVisibility] = useState('all');
  const [uploading, setUploading] = useState(false);

  // In-app file editing
  const [editingFile, setEditingFile] = useState(null);
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileType, setNewFileType] = useState(null);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileSearch, setFileSearch] = useState('');
  const [permMenu, setPermMenu] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [createInFolder, setCreateInFolder] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [renamingItem, setRenamingItem] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [viewerContextMenu, setViewerContextMenu] = useState(null);
  const [folderPerms, setFolderPerms] = useState({});
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const autoSaveTimerRef = useRef(null);
  const lastSavedContentRef = useRef(null);
  const fileEditNotifSentRef = useRef(null); // track which file we already notified about

  const schoolId = selectedSchool || userData?.schoolId;
  const canManage = isPrincipal() || isGlobalAdmin();
  const canUploadFiles = permissions.files_upload;

  function userCanAccessFolder(folder) {
    if (canManage) return true;
    if (folder.visibility === 'principal_only') return false;
    // Check resource_permissions for this folder
    const perm = folderPerms[folder.id];
    if (perm && !perm.public) {
      // Folder has specific permissions set - check user and team access
      const uid = userData?.uid;
      const userTeamIds = userData?.teamIds || [];
      const isInViewers = perm.viewers?.includes(uid) || perm.editors?.includes(uid);
      const isInTeam = (perm.viewerTeams || []).some(t => userTeamIds.includes(t)) ||
                       (perm.editorTeams || []).some(t => userTeamIds.includes(t));
      return isInViewers || isInTeam;
    }
    // No specific permissions or public - use legacy checks
    if (folder.visibility === 'all') return true;
    if (folder.allowedUsers && folder.allowedUsers.includes(userData?.uid)) return true;
    return false;
  }

  function userCanCreateFiles() {
    if (!canUploadFiles) return false;
    if (canManage) return true;
    const folder = folders.find(f => f.id === selectedFolder);
    if (!folder) return false;
    if (folder.allowCreate && folder.allowCreate.includes(userData?.uid)) return true;
    if (userData?.role === 'editor') return true;
    return false;
  }

  async function togglePinFile(fileId, isPinned) {
    if (!uid || !schoolId) return;
    await updateDoc(doc(db, `files_${schoolId}`, fileId), {
      pinnedBy: isPinned ? arrayRemove(uid) : arrayUnion(uid)
    });
  }

  async function togglePinFolder(folderId, isPinned) {
    if (!uid || !schoolId) return;
    await updateDoc(doc(db, `folders_${schoolId}`, folderId), {
      pinnedBy: isPinned ? arrayRemove(uid) : arrayUnion(uid)
    });
  }

  // Load resource permissions for folders
  useEffect(() => {
    if (!schoolId) return;
    const q = query(collection(db, `folders_${schoolId}`));
    const unsub = onSnapshot(q, async (snap) => {
      const perms = {};
      await Promise.all(snap.docs.map(async (d) => {
        try {
          const permDoc = await getDoc(doc(db, 'resource_permissions', `folder_${d.id}`));
          if (permDoc.exists()) perms[d.id] = permDoc.data();
        } catch {}
      }));
      setFolderPerms(perms);
    });
    return unsub;
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId) return;
    const q = query(collection(db, `folders_${schoolId}`), orderBy('name'));
    const unsub = onSnapshot(q, (snap) => {
      const allFolders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setFolders(allFolders.filter(f => userCanAccessFolder(f)));
    });
    return unsub;
  }, [schoolId, canManage, userData, folderPerms]);

  // Load all files for all folders
  useEffect(() => {
    if (!schoolId) return;
    const q = query(collection(db, `files_${schoolId}`), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setFiles(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId]);

  // Open file from URL param (e.g. /files?openFile=abc123)
  useEffect(() => {
    const openFileId = searchParams.get('openFile');
    if (openFileId && files.length > 0 && !editingFile) {
      const file = files.find(f => f.id === openFileId);
      if (file && (file.fileType === 'spreadsheet' || file.fileType === 'document')) {
        setEditingFile(file);
        if (file.folderId) {
          setSelectedFolder(file.folderId);
          setExpandedFolders(prev => ({ ...prev, [file.folderId]: true }));
        }
      }
      // Clear the param so it doesn't re-trigger
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, files]);

  async function createFolder(e) {
    e.preventDefault();
    if (!folderName.trim() || !schoolId) return;
    try {
      await addDoc(collection(db, `folders_${schoolId}`), {
        name: folderName.trim(),
        visibility: folderVisibility,
        allowedUsers: [],
        allowCreate: [],
        createdBy: userData?.fullName || '',
        createdAt: new Date().toISOString()
      });
      setFolderName('');
      setShowNewFolder(false);
    } catch (err) {
      alert('שגיאה ביצירת תיקייה: ' + err.message);
    }
  }

  async function handleUpload(e, folderId) {
    const file = e.target.files[0];
    if (!file || !folderId || !schoolId) return;
    setUploading(true);
    try {
      const storageRef = ref(storage, `schools/${schoolId}/${folderId}/${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      await addDoc(collection(db, `files_${schoolId}`), {
        name: file.name,
        url,
        size: file.size,
        type: file.type,
        fileType: 'upload',
        folderId: folderId,
        storagePath: `schools/${schoolId}/${folderId}/${file.name}`,
        uploadedBy: userData?.fullName || '',
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      alert('שגיאה בהעלאת הקובץ');
    }
    setUploading(false);
    e.target.value = '';
  }

  async function createInAppFile(e) {
    e.preventDefault();
    const folderId = createInFolder || selectedFolder;
    if (!newFileName.trim() || !newFileType || !folderId || !schoolId) return;
    try {
      const initialContent = newFileType === 'spreadsheet'
        ? JSON.stringify({ columns: 5, rows: 10, cells: {}, headers: {}, columnWidths: {}, rowHeights: {} })
        : '<p></p>';

      const newDoc = await addDoc(collection(db, `files_${schoolId}`), {
        name: newFileName.trim(),
        fileType: newFileType,
        content: initialContent,
        folderId: folderId,
        size: 0,
        type: newFileType === 'spreadsheet' ? 'application/x-spreadsheet' : 'text/html',
        uploadedBy: userData?.fullName || '',
        createdAt: new Date().toISOString()
      });
      setNewFileName('');
      setNewFileType(null);
      setShowCreateMenu(false);
      setCreateInFolder(null);
      setEditingFile({ id: newDoc.id, name: newFileName.trim(), fileType: newFileType, content: initialContent });
    } catch (err) {
      alert('שגיאה ביצירת קובץ: ' + err.message);
    }
  }

  function computeSpreadsheetChanges(oldContent, newContent) {
    try {
      const oldData = typeof oldContent === 'string' ? JSON.parse(oldContent) : oldContent;
      const newData = typeof newContent === 'string' ? JSON.parse(newContent) : newContent;
      if (!oldData || !newData) return [];
      const changes = [];
      const oldCells = oldData.cells || {};
      const newCells = newData.cells || {};
      const allRefs = new Set([...Object.keys(oldCells), ...Object.keys(newCells)]);
      for (const ref of allRefs) {
        const oldVal = oldCells[ref]?.value || '';
        const newVal = newCells[ref]?.value || '';
        const oldFormula = oldCells[ref]?.formula || '';
        const newFormula = newCells[ref]?.formula || '';
        if (oldVal !== newVal || oldFormula !== newFormula) {
          changes.push({ cell: ref, oldValue: oldFormula || oldVal, newValue: newFormula || newVal });
        }
      }
      return changes.slice(0, 50); // limit to 50 changes per save
    } catch { return []; }
  }

  async function saveFileContent(content) {
    if (!editingFile || !schoolId) return;
    setFileSaving(true);
    const prevContent = lastSavedContentRef.current;
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, `files_${schoolId}`, editingFile.id), {
        content,
        lastModified: now,
        lastModifiedBy: userData?.fullName || ''
      });

      // Write edit history entry
      try {
        const historyEntry = {
          fileId: editingFile.id,
          fileName: editingFile.name,
          fileType: editingFile.fileType,
          userId: uid,
          userName: userData?.fullName || '',
          timestamp: now,
        };
        if (editingFile.fileType === 'spreadsheet') {
          historyEntry.changes = computeSpreadsheetChanges(prevContent, content);
        } else {
          historyEntry.summary = 'עריכת מסמך';
        }
        // Only write if there are actual changes
        if (editingFile.fileType !== 'spreadsheet' || historyEntry.changes.length > 0) {
          await addDoc(collection(db, `file_history_${schoolId}`), historyEntry);
        }
      } catch {}

      lastSavedContentRef.current = content;
      setEditingFile(prev => ({ ...prev, content }));
      // Notify team members about file edit (once per file session)
      if (fileEditNotifSentRef.current !== editingFile.id) {
        fileEditNotifSentRef.current = editingFile.id;
        const folderId = editingFile.folderId;
        const folder = folders.find(f => f.id === folderId);
        // Notify allowed users of the folder
        if (folder?.allowedUsers) {
          const otherIds = folder.allowedUsers.filter(id => id !== uid);
          if (otherIds.length > 0) {
            createNotifications(otherIds, {
              title: `הקובץ "${editingFile.name}" נערך`,
              body: `${userData?.fullName || 'משתמש'} ערך/ה את הקובץ`,
              type: 'file',
              link: '/files'
            });
          }
        }
      }
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message);
    }
    setFileSaving(false);
  }

  // Auto-save: debounce 1 second after last change
  const autoSave = useCallback((content) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (content !== lastSavedContentRef.current) {
        saveFileContent(content);
      }
    }, 1000);
  }, [editingFile?.id, schoolId]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Track initial content when opening a file
  useEffect(() => {
    if (editingFile) {
      lastSavedContentRef.current = editingFile.content;
    }
  }, [editingFile?.id]);

  async function deleteFolder(folderId) {
    if (!canUploadFiles) return;
    if (!confirm('האם למחוק תיקייה זו וכל תוכנה?')) return;
    const filesSnap = await getDocs(
      query(collection(db, `files_${schoolId}`), where('folderId', '==', folderId))
    );
    for (const fileDoc of filesSnap.docs) {
      const fileData = fileDoc.data();
      if (fileData.storagePath) {
        try { await deleteObject(ref(storage, fileData.storagePath)); } catch {}
      }
      await deleteDoc(doc(db, `files_${schoolId}`, fileDoc.id));
    }
    await deleteDoc(doc(db, `folders_${schoolId}`, folderId));
    if (selectedFolder === folderId) setSelectedFolder(null);
  }

  async function deleteFile(fileItem) {
    if (!canUploadFiles) return;
    if (!confirm('האם למחוק קובץ זה?')) return;
    if (fileItem.storagePath) {
      try { await deleteObject(ref(storage, fileItem.storagePath)); } catch {}
    }
    await deleteDoc(doc(db, `files_${schoolId}`, fileItem.id));
    if (editingFile?.id === fileItem.id) setEditingFile(null);
  }

  async function duplicateFile(fileItem) {
    if (!schoolId || !canUploadFiles) return;
    try {
      const { id, ...data } = fileItem;
      await addDoc(collection(db, `files_${schoolId}`), {
        ...data,
        name: (data.name || 'קובץ') + ' - עותק',
        createdAt: new Date().toISOString(),
        uploadedBy: userData?.fullName || '',
        pinnedBy: [],
      });
    } catch (err) {
      alert('שגיאה בשכפול: ' + err.message);
    }
  }

  function openFile(file) {
    if (file.fileType === 'spreadsheet' || file.fileType === 'document') {
      // Flush pending autosave for current file before switching
      if (editingFile && editingFile.id !== file.id && autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
        if (editingFile.content !== lastSavedContentRef.current) {
          saveFileContent(editingFile.content);
        }
      }
      setEditingFile(file);
      lastSavedContentRef.current = file.content;
      fileEditNotifSentRef.current = null;
      // Reload history if panel is open
      if (showHistory) loadHistory(file.id);
    } else if (file.url) {
      window.open(file.url, '_blank');
    }
  }

  async function loadHistory(fileId) {
    if (!schoolId || !fileId) return;
    setHistoryLoading(true);
    try {
      const q = query(
        collection(db, `file_history_${schoolId}`),
        where('fileId', '==', fileId),
        orderBy('timestamp', 'desc')
      );
      const snap = await getDocs(q);
      setHistoryEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {
      setHistoryEntries([]);
    }
    setHistoryLoading(false);
  }

  function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
    } else {
      setShowHistory(true);
      if (editingFile) loadHistory(editingFile.id);
    }
  }

  function formatHistoryTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' +
      d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  }

  function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function getFileIcon(file, size = 15) {
    if (file.fileType === 'spreadsheet') return <Table2 size={size} className="file-icon file-icon--sheet" />;
    if (file.fileType === 'document') return <FileEdit size={size} className="file-icon file-icon--doc" />;
    return <FileText size={size} className="file-icon" />;
  }

  function toggleFolder(folderId) {
    setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
    setSelectedFolder(folderId);
  }

  function getFolderTooltip(folder) {
    const parts = [];
    if (folder.createdAt) {
      const d = new Date(folder.createdAt);
      parts.push(`נוצר: ${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (folder.createdBy) parts.push(`יוצר: ${folder.createdBy}`);
    if (folder.visibility === 'principal_only') parts.push('הרשאה: מנהל בלבד');
    else if (folder.allowedUsers?.length) parts.push(`הרשאות: ${folder.allowedUsers.length} משתמשים`);
    else parts.push('הרשאה: כולם');
    return parts.join('\n');
  }

  function getFileTooltip(f) {
    const parts = [];
    if (f.createdAt) {
      const d = new Date(f.createdAt);
      parts.push(`נוצר: ${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (f.uploadedBy) parts.push(`העלה: ${f.uploadedBy}`);
    if (f.lastModified) {
      const d = new Date(f.lastModified);
      parts.push(`עודכן: ${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (f.lastModifiedBy) parts.push(`עודכן ע"י: ${f.lastModifiedBy}`);
    const folder = folders.find(fd => fd.id === f.folderId);
    if (folder) parts.push(`תיקייה: ${folder.name}`);
    return parts.join('\n');
  }

  function getFolderNameForFile(fileId) {
    const file = files.find(f => f.id === fileId);
    if (!file) return '';
    const folder = folders.find(f => f.id === file.folderId);
    return folder?.name || '';
  }

  // Screen-aware context menu positioning
  function getMenuPosition(x, y, menuWidth = 200, menuHeight = 200) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: x + menuWidth > vw ? Math.max(0, x - menuWidth) : x,
      y: y + menuHeight > vh ? Math.max(0, y - menuHeight) : y
    };
  }

  function handleContextMenu(e, type, item) {
    e.preventDefault();
    e.stopPropagation();
    const pos = getMenuPosition(e.clientX, e.clientY);
    setContextMenu({ type, item, position: pos });
    setViewerContextMenu(null);
  }

  function handleViewerContextMenu(e) {
    e.preventDefault();
    if (editingFile) return; // no context menu when editing
    const pos = getMenuPosition(e.clientX, e.clientY, 180, 160);
    setViewerContextMenu({ position: pos });
    setContextMenu(null);
  }

  // Close context menus on click outside
  useEffect(() => {
    function handleClick() {
      setContextMenu(null);
      setViewerContextMenu(null);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  async function renameItem() {
    if (!renamingItem || !renameValue.trim()) return;
    try {
      if (renamingItem.type === 'folder') {
        await updateDoc(doc(db, `folders_${schoolId}`, renamingItem.id), { name: renameValue.trim() });
      } else {
        await updateDoc(doc(db, `files_${schoolId}`, renamingItem.id), { name: renameValue.trim() });
      }
    } catch (err) {
      alert('שגיאה בשינוי שם: ' + err.message);
    }
    setRenamingItem(null);
    setRenameValue('');
  }

  function startRename(type, item) {
    setRenamingItem({ type, id: item.id });
    setRenameValue(item.name);
    setContextMenu(null);
  }

  function getFileInfo(f) {
    const parts = [];
    parts.push(`שם: ${f.name}`);
    if (f.createdAt) {
      const d = new Date(f.createdAt);
      parts.push(`נוצר: ${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (f.uploadedBy) parts.push(`יוצר: ${f.uploadedBy}`);
    if (f.lastModified) {
      const d = new Date(f.lastModified);
      parts.push(`עודכן: ${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (f.lastModifiedBy) parts.push(`עודכן ע"י: ${f.lastModifiedBy}`);
    if (f.fileType) parts.push(`סוג: ${f.fileType === 'spreadsheet' ? 'גיליון' : f.fileType === 'document' ? 'מסמך' : 'קובץ'}`);
    if (f.size) parts.push(`גודל: ${formatSize(f.size)}`);
    alert(parts.join('\n'));
  }

  // Sort folders: pinned first, then alphabetical
  const sortedFolders = [...folders]
    .filter(f => !fileSearch.trim() || f.name.toLowerCase().includes(fileSearch.toLowerCase()) ||
      files.some(file => file.folderId === f.id && file.name.toLowerCase().includes(fileSearch.toLowerCase())))
    .sort((a, b) => {
      const aPin = a.pinnedBy?.includes(uid) ? 0 : 1;
      const bPin = b.pinnedBy?.includes(uid) ? 0 : 1;
      if (aPin !== bPin) return aPin - bPin;
      return (a.name || '').localeCompare(b.name || '');
    });

  const pinnedFolders = sortedFolders.filter(f => f.pinnedBy?.includes(uid));
  const unpinnedFolders = sortedFolders.filter(f => !f.pinnedBy?.includes(uid));

  function getFilesForFolder(folderId) {
    return files
      .filter(f => f.folderId === folderId)
      .filter(f => !fileSearch.trim() || f.name.toLowerCase().includes(fileSearch.toLowerCase()))
      .sort((a, b) => {
        const aPin = a.pinnedBy?.includes(uid) ? 0 : 1;
        const bPin = b.pinnedBy?.includes(uid) ? 0 : 1;
        return aPin - bPin;
      });
  }

  // Get pinned files across all folders
  const pinnedFiles = files.filter(f => f.pinnedBy?.includes(uid))
    .filter(f => !fileSearch.trim() || f.name.toLowerCase().includes(fileSearch.toLowerCase()));

  function renderFolderTree(folderList) {
    return folderList.map(folder => {
      const isExpanded = expandedFolders[folder.id];
      const folderFiles = getFilesForFolder(folder.id);
      const isPinnedFolder = folder.pinnedBy?.includes(uid);
      const isSelected = selectedFolder === folder.id;

      return (
        <div key={folder.id} className="tree-folder">
          <div
            className={`tree-folder-item ${isSelected ? 'tree-folder-item--active' : ''}`}
            onClick={() => toggleFolder(folder.id)}
            title={getFolderTooltip(folder)}
            onContextMenu={e => handleContextMenu(e, 'folder', folder)}
          >
            <span className="tree-chevron">
              {isExpanded ? <ChevronDown size={12} /> : <ChevronLeft size={12} />}
            </span>
            {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
            {renamingItem?.type === 'folder' && renamingItem.id === folder.id ? (
              <form className="rename-form-inline" onSubmit={e => { e.preventDefault(); renameItem(); }} onClick={e => e.stopPropagation()}>
                <input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus onBlur={renameItem} />
              </form>
            ) : (
              <span className="tree-folder-name">{folder.name}</span>
            )}
            {folder.visibility === 'principal_only' && <Lock size={10} className="folder-lock" />}
            <span className="tree-folder-count">{folderFiles.length}</span>
            <div className="tree-item-actions" onClick={e => e.stopPropagation()}>
              <button
                className={`tree-pin-btn ${isPinnedFolder ? 'tree-pin-btn--active' : ''}`}
                title={isPinnedFolder ? 'הסר נעיצה' : 'נעץ תיקייה'}
                onClick={() => togglePinFolder(folder.id, isPinnedFolder)}
              >
                <Pin size={11} style={isPinnedFolder ? { color: '#2563eb' } : undefined} />
              </button>
              {canManage && (
                <button
                  className="tree-delete-btn"
                  onClick={() => deleteFolder(folder.id)}
                  title="מחיקת תיקייה"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>

          {isExpanded && (
            <div className="tree-folder-children">
              {folderFiles.map(f => {
                const isPinned = f.pinnedBy?.includes(uid);
                return (
                  <div
                    key={f.id}
                    className={`tree-file-item ${editingFile?.id === f.id ? 'tree-file-item--active' : ''} ${isPinned ? 'tree-file-item--pinned' : ''}`}
                    onClick={() => openFile(f)}
                    title={getFileTooltip(f)}
                    onContextMenu={e => handleContextMenu(e, 'file', f)}
                  >
                    {getFileIcon(f, 13)}
                    {renamingItem?.type === 'file' && renamingItem.id === f.id ? (
                      <form className="rename-form-inline" onSubmit={e => { e.preventDefault(); renameItem(); }} onClick={e => e.stopPropagation()}>
                        <input value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus onBlur={renameItem} />
                      </form>
                    ) : (
                      <span className="tree-file-name">{f.name}</span>
                    )}
                    <div className="tree-item-actions" onClick={e => e.stopPropagation()}>
                      <button
                        className={`tree-pin-btn ${isPinned ? 'tree-pin-btn--active' : ''}`}
                        title={isPinned ? 'הסר נעיצה' : 'נעץ'}
                        onClick={() => togglePinFile(f.id, isPinned)}
                      >
                        <Pin size={10} style={isPinned ? { color: '#2563eb' } : undefined} />
                      </button>
                      {f.url && (
                        <a href={f.url} target="_blank" rel="noopener noreferrer" className="tree-action-btn" title="הורדה">
                          <Download size={10} />
                        </a>
                      )}
                      {canManage && (
                        <button className="tree-delete-btn" onClick={() => deleteFile(f)} title="מחיקה">
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {folderFiles.length === 0 && (
                <div className="tree-empty">ריק</div>
              )}
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <div className="page">
      <Header title="קבצים ותיקיות" onPermissions={() => setShowPermissionsPanel(true)} />
      {showPermissionsPanel && <PagePermissionsPanel feature="files" onClose={() => setShowPermissionsPanel(false)} />}
      <div className="page-content">
        <div className={`files-layout ${fullscreen ? 'files-layout--fullscreen' : ''}`}>
          {/* Right panel - File tree */}
          <div className="files-tree-panel">
            <div className="tree-panel-header">
              <h3>תיקיות וקבצים</h3>
              <div className="tree-panel-actions">
                {selectedFolder && userCanCreateFiles() && (
                  <>
                    <button className="icon-btn" onClick={() => { setNewFileType('spreadsheet'); setCreateInFolder(selectedFolder); }} title="גיליון חדש">
                      <Table2 size={15} />
                    </button>
                    <button className="icon-btn" onClick={() => { setNewFileType('document'); setCreateInFolder(selectedFolder); }} title="מסמך חדש">
                      <FileEdit size={15} />
                    </button>
                  </>
                )}
                {canManage && (
                  <button className="icon-btn" onClick={() => setShowNewFolder(true)} title="תיקייה חדשה">
                    <FolderPlus size={15} />
                  </button>
                )}
              </div>
            </div>

            {showNewFolder && (
              <form onSubmit={createFolder} className="new-folder-form">
                <input
                  value={folderName}
                  onChange={e => setFolderName(e.target.value)}
                  placeholder="שם התיקייה"
                  autoFocus
                />
                <select value={folderVisibility} onChange={e => setFolderVisibility(e.target.value)}>
                  <option value="all">כולם</option>
                  <option value="principal_only">מנהל בלבד</option>
                </select>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary btn-sm">צור</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNewFolder(false)}>ביטול</button>
                </div>
              </form>
            )}

            <div style={{ padding: '0.35rem 0.5rem 0' }}>
              <div className="search-bar" style={{ minWidth: 'auto' }}>
                <Search size={12} />
                <input
                  value={fileSearch}
                  onChange={e => setFileSearch(e.target.value)}
                  placeholder="חיפוש..."
                  style={{ fontSize: '0.75rem' }}
                />
              </div>
            </div>

            <div className="tree-list">
              {/* Pinned section */}
              {(pinnedFolders.length > 0 || pinnedFiles.length > 0) && (
                <>
                  <div className="tree-section-header">
                    <Pin size={11} />
                    <span>נעוצים</span>
                  </div>
                  {renderFolderTree(pinnedFolders)}
                  {pinnedFiles.filter(f => !pinnedFolders.some(pf => pf.id === f.folderId)).map(f => {
                    const folderName = getFolderNameForFile(f.id);
                    return (
                      <div
                        key={`pinned-${f.id}`}
                        className={`tree-file-item tree-file-item--pinned-standalone ${editingFile?.id === f.id ? 'tree-file-item--active' : ''}`}
                        onClick={() => openFile(f)}
                        title={getFileTooltip(f)}
                      >
                        {getFileIcon(f, 13)}
                        <span className="tree-file-name">
                          {f.name}
                          {folderName && <span className="tree-file-folder-tag">{folderName}</span>}
                        </span>
                        <div className="tree-item-actions" onClick={e => e.stopPropagation()}>
                          <button
                            className="tree-pin-btn tree-pin-btn--active"
                            title="הסר נעיצה"
                            onClick={() => togglePinFile(f.id, true)}
                          >
                            <Pin size={10} style={{ color: '#2563eb' }} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="tree-section-divider" />
                </>
              )}

              {/* All folders */}
              {unpinnedFolders.length > 0 && (pinnedFolders.length > 0 || pinnedFiles.length > 0) && (
                <div className="tree-section-header">
                  <Folder size={11} />
                  <span>כל התיקיות</span>
                </div>
              )}
              {renderFolderTree(unpinnedFolders)}

              {sortedFolders.length === 0 && (
                <div className="tree-empty-state">
                  <Folder size={24} className="empty-icon" />
                  <p>אין תיקיות</p>
                </div>
              )}
            </div>
          </div>

          {/* Left panel - File viewer */}
          <div className="files-viewer-panel">
            {editingFile ? (
              <div className="file-viewer-content">
                <div className="file-editor-header">
                  <button className="btn btn-secondary btn-sm" onClick={() => { setEditingFile(null); setFullscreen(false); }}>
                    <X size={14} />
                    סגור
                  </button>
                  <span className="file-editor-name">
                    {editingFile.fileType === 'spreadsheet' ? <Table2 size={16} /> : <FileEdit size={16} />}
                    {editingFile.name}
                  </span>
                  <div className="file-editor-actions">
                    {editingFile.fileType !== 'spreadsheet' && (
                      <button
                        className="icon-btn"
                        onClick={() => setFullscreen(!fullscreen)}
                        title={fullscreen ? 'יציאה ממסך מלא' : 'מסך מלא'}
                      >
                        {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                      </button>
                    )}
                    {!!canUploadFiles && (
                      <>
                        <span className="autosave-status">
                          <span className={`autosave-dot-inline ${fileSaving ? 'autosave-dot-inline--saving' : ''}`} />
                          {fileSaving ? 'שומר...' : 'שמירה אוטומטית'}
                        </span>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => saveFileContent(editingFile.content)}
                          disabled={fileSaving}
                        >
                          <Save size={14} />
                          שמירה
                        </button>
                      </>
                    )}
                    {!canUploadFiles && <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>צפייה בלבד</span>}
                    <button
                      className={`icon-btn ${showHistory ? 'icon-btn--active' : ''}`}
                      onClick={toggleHistory}
                      title="היסטוריית עריכה"
                    >
                      <History size={15} />
                    </button>
                  </div>
                </div>
                <div className="file-editor-body-wrap">
                <div className="file-editor-body">
                  {editingFile.fileType === 'spreadsheet' ? (
                    <SpreadsheetEditor
                      key={editingFile.id}
                      data={typeof editingFile.content === 'string' ? JSON.parse(editingFile.content) : editingFile.content}
                      onChange={!canUploadFiles ? undefined : (newData) => {
                        const json = JSON.stringify(newData);
                        setEditingFile(prev => ({ ...prev, content: json }));
                        autoSave(json);
                      }}
                      onToggleFullscreen={() => setFullscreen(!fullscreen)}
                      isFullscreen={fullscreen}
                      readOnly={!canUploadFiles}
                    />
                  ) : (
                    <DocumentEditor
                      key={editingFile.id}
                      content={editingFile.content || ''}
                      onChange={!canUploadFiles ? undefined : (newContent) => {
                        setEditingFile(prev => ({ ...prev, content: newContent }));
                        autoSave(newContent);
                      }}
                      readOnly={!canUploadFiles}
                    />
                  )}
                </div>
                {/* Edit History Panel */}
                {showHistory && (
                  <div className="file-history-panel">
                    <div className="file-history-header">
                      <History size={14} />
                      <span>היסטוריית עריכה</span>
                      <button className="icon-btn" onClick={() => setShowHistory(false)} style={{ marginRight: 'auto' }}>
                        <X size={14} />
                      </button>
                    </div>
                    <div className="file-history-list">
                      {historyLoading ? (
                        <div className="file-history-empty">טוען...</div>
                      ) : historyEntries.length === 0 ? (
                        <div className="file-history-empty">אין היסטוריית עריכה</div>
                      ) : historyEntries.map(entry => (
                        <div key={entry.id} className="file-history-entry">
                          <div className="file-history-entry-header">
                            <span className="file-history-user">{entry.userName || 'משתמש'}</span>
                            <span className="file-history-time">
                              <Clock size={11} />
                              {formatHistoryTime(entry.timestamp)}
                            </span>
                          </div>
                          {entry.fileType === 'spreadsheet' && entry.changes?.length > 0 ? (
                            <div className="file-history-changes">
                              {entry.changes.map((ch, i) => (
                                <div key={i} className="file-history-change">
                                  <span className="file-history-cell">{ch.cell}</span>
                                  {ch.oldValue ? (
                                    <>
                                      <span className="file-history-old">{ch.oldValue}</span>
                                      <span className="file-history-arrow">←</span>
                                      <span className="file-history-new">{ch.newValue}</span>
                                    </>
                                  ) : (
                                    <span className="file-history-new">{ch.newValue}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="file-history-summary">{entry.summary || 'עריכה'}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                </div>
              </div>
            ) : selectedFolder ? (
              <div className="file-viewer-content">
                <div className="viewer-header">
                  <div className="viewer-folder-info">
                    <FolderOpen size={18} />
                    <h3>{folders.find(f => f.id === selectedFolder)?.name || 'תיקייה'}</h3>
                  </div>
                  <div className="viewer-header-actions">
                    {userCanCreateFiles() && (
                      <div className="create-file-wrap">
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => { setShowCreateMenu(!showCreateMenu); setCreateInFolder(selectedFolder); }}
                        >
                          <Plus size={14} />
                          קובץ חדש
                        </button>
                        {showCreateMenu && (
                          <div className="create-file-menu">
                            <button onClick={() => { setNewFileType('spreadsheet'); setShowCreateMenu(false); }}>
                              <Table2 size={16} />
                              גיליון אלקטרוני
                            </button>
                            <button onClick={() => { setNewFileType('document'); setShowCreateMenu(false); }}>
                              <FileEdit size={16} />
                              מסמך טקסט
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {!!canUploadFiles && (
                      <label className="upload-btn">
                        <Upload size={14} />
                        {uploading ? 'מעלה...' : 'העלאת קובץ'}
                        <input type="file" hidden onChange={e => handleUpload(e, selectedFolder)} disabled={uploading} />
                      </label>
                    )}
                  </div>
                </div>

                {newFileType && (
                  <form onSubmit={createInAppFile} className="new-file-form">
                    <div className="new-file-type-badge">
                      {newFileType === 'spreadsheet' ? <Table2 size={14} /> : <FileEdit size={14} />}
                      {newFileType === 'spreadsheet' ? 'גיליון חדש' : 'מסמך חדש'}
                    </div>
                    <input
                      value={newFileName}
                      onChange={e => setNewFileName(e.target.value)}
                      placeholder="שם הקובץ"
                      autoFocus
                      required
                    />
                    <div className="form-actions">
                      <button type="submit" className="btn btn-primary btn-sm">צור</button>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNewFileType(null)}>ביטול</button>
                    </div>
                  </form>
                )}

                <div className="file-grid" onContextMenu={handleViewerContextMenu}>
                  {getFilesForFolder(selectedFolder).map(f => {
                    const isPinned = f.pinnedBy?.includes(uid);
                    return (
                      <div key={f.id} className={`file-card ${isPinned ? 'file-card--pinned' : ''}`} onClick={() => openFile(f)} onContextMenu={e => handleContextMenu(e, 'file', f)}>
                        <div className="file-card-icon">{getFileIcon(f, 28)}</div>
                        <div className="file-card-info">
                          <div className="file-card-name">{f.name}</div>
                          <div className="file-card-meta">
                            {f.fileType === 'spreadsheet' ? 'גיליון' : f.fileType === 'document' ? 'מסמך' : formatSize(f.size)}
                            {' · '}{f.uploadedBy}
                          </div>
                        </div>
                        <div className="file-card-actions" onClick={e => e.stopPropagation()}>
                          <button
                            className={`tree-pin-btn ${isPinned ? 'tree-pin-btn--active' : ''}`}
                            title={isPinned ? 'הסר נעיצה' : 'נעץ'}
                            onClick={() => togglePinFile(f.id, isPinned)}
                          >
                            <Pin size={13} style={isPinned ? { color: '#2563eb' } : undefined} />
                          </button>
                          {f.url && (
                            <a href={f.url} target="_blank" rel="noopener noreferrer" className="icon-btn" title="הורדה">
                              <Download size={13} />
                            </a>
                          )}
                          {canManage && (
                            <button className="icon-btn icon-btn--danger" onClick={() => deleteFile(f)} title="מחיקה">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {getFilesForFolder(selectedFolder).length === 0 && (
                    <div className="empty-state">
                      <FileText size={32} className="empty-icon" />
                      <p>אין קבצים בתיקייה זו</p>
                      {userCanCreateFiles() && <p className="empty-hint">לחצו "קובץ חדש" ליצירת גיליון או מסמך</p>}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-state" style={{ height: '100%' }}>
                <Folder size={40} className="empty-icon" />
                <p>בחרו תיקייה או קובץ מהעץ</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Context Menu (right-click on files/folders) */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.position.y, left: contextMenu.position.x }}
          onClick={e => e.stopPropagation()}
        >
          {canManage && (
            <button className="context-menu-item" onClick={() => {
              setPermMenu({
                type: contextMenu.type,
                id: contextMenu.item.id,
                name: contextMenu.item.name,
                position: contextMenu.position
              });
              setContextMenu(null);
            }}>
              <Share2 size={14} />
              שיתוף
            </button>
          )}
          <button className="context-menu-item" onClick={() => startRename(contextMenu.type, contextMenu.item)}>
            <Pencil size={14} />
            שינוי שם
          </button>
          <button className="context-menu-item" onClick={() => {
            getFileInfo(contextMenu.item);
            setContextMenu(null);
          }}>
            <Info size={14} />
            מידע
          </button>
          {contextMenu.type === 'file' && contextMenu.item.url && (
            <a
              href={contextMenu.item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="context-menu-item"
              onClick={() => setContextMenu(null)}
              style={{ textDecoration: 'none' }}
            >
              <Download size={14} />
              הורדה
            </a>
          )}
          {contextMenu.type === 'file' && (contextMenu.item.fileType === 'spreadsheet' || contextMenu.item.fileType === 'document') && !!canUploadFiles && (
            <button className="context-menu-item" onClick={() => {
              duplicateFile(contextMenu.item);
              setContextMenu(null);
            }}>
              <Copy size={14} />
              שכפול
            </button>
          )}
          <div className="context-menu-divider" />
          {canManage && (
            <button className="context-menu-item context-menu-item--danger" onClick={() => {
              if (contextMenu.type === 'folder') deleteFolder(contextMenu.item.id);
              else deleteFile(contextMenu.item);
              setContextMenu(null);
            }}>
              <Trash2 size={14} />
              מחיקה
            </button>
          )}
        </div>
      )}

      {/* Viewer panel context menu */}
      {viewerContextMenu && selectedFolder && (
        <div
          className="context-menu"
          style={{ top: viewerContextMenu.position.y, left: viewerContextMenu.position.x }}
          onClick={e => e.stopPropagation()}
        >
          {userCanCreateFiles() && (
            <>
              <button className="context-menu-item" onClick={() => {
                setNewFileType('spreadsheet');
                setCreateInFolder(selectedFolder);
                setViewerContextMenu(null);
              }}>
                <Table2 size={14} />
                גיליון חדש
              </button>
              <button className="context-menu-item" onClick={() => {
                setNewFileType('document');
                setCreateInFolder(selectedFolder);
                setViewerContextMenu(null);
              }}>
                <FileEdit size={14} />
                מסמך חדש
              </button>
              <div className="context-menu-divider" />
            </>
          )}
          <button className="context-menu-item" onClick={() => {
            const folder = folders.find(f => f.id === selectedFolder);
            if (folder) {
              const info = [];
              info.push(`שם: ${folder.name}`);
              if (folder.createdAt) {
                const d = new Date(folder.createdAt);
                info.push(`נוצר: ${d.toLocaleDateString('he-IL')} ${d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`);
              }
              if (folder.createdBy) info.push(`יוצר: ${folder.createdBy}`);
              const folderFiles = files.filter(f => f.folderId === selectedFolder);
              info.push(`מספר קבצים: ${folderFiles.length}`);
              alert(info.join('\n'));
            }
            setViewerContextMenu(null);
          }}>
            <Info size={14} />
            מידע על התיקייה
          </button>
          {canManage && (
            <>
              <div className="context-menu-divider" />
              <button className="context-menu-item context-menu-item--danger" onClick={() => {
                deleteFolder(selectedFolder);
                setViewerContextMenu(null);
              }}>
                <Trash2 size={14} />
                מחיקת תיקייה
              </button>
            </>
          )}
        </div>
      )}

      {/* Permissions Menu */}
      {permMenu && (
        <PermissionsMenu
          resourceType={permMenu.type}
          resourceId={permMenu.id}
          resourceName={permMenu.name}
          schoolId={schoolId}
          position={permMenu.position}
          onClose={() => setPermMenu(null)}
        />
      )}
    </div>
  );
}
