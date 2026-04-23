import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  getDocs,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import Header from '../Layout/Header';
import { Plus, Trash2, Save, Table2, X, Search, Calculator, Type, Scissors, Copy, Clipboard, ClipboardPaste, RotateCcw, ArrowDownToLine, ArrowRightToLine, ArrowUpToLine, ArrowLeftToLine, Eraser, Merge, SplitSquareHorizontal, Paintbrush, Palette, Users, Edit3, Share2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Pin } from 'lucide-react';
import '../Gantt/Gantt.css';
import './DataMapper.css';

function colLabel(i) {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function cellRef(ri, ci) {
  return `${colLabel(ci)}${ri + 1}`;
}

function parseNumber(val) {
  if (val === '' || val === null || val === undefined) return NaN;
  return Number(String(val).replace(/,/g, ''));
}

function calcSum(nums) { return nums.reduce((a, b) => a + b, 0); }
function calcAvg(nums) { return nums.length ? calcSum(nums) / nums.length : 0; }
function calcMedian(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function calcMin(nums) { return nums.length ? Math.min(...nums) : 0; }
function calcMax(nums) { return nums.length ? Math.max(...nums) : 0; }
function calcCount(nums) { return nums.length; }

const CALC_FUNCTIONS = [
  { id: 'sum', label: 'סכום', fn: calcSum, icon: '+' },
  { id: 'avg', label: 'ממוצע', fn: calcAvg, icon: 'x̄' },
  { id: 'median', label: 'חציון', fn: calcMedian, icon: 'M' },
  { id: 'min', label: 'מינימום', fn: calcMin, icon: '↓' },
  { id: 'max', label: 'מקסימום', fn: calcMax, icon: '↑' },
  { id: 'count', label: 'ספירה', fn: calcCount, icon: '#' },
];

function parseCellRef(ref) {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const letters = match[1];
  const row = parseInt(match[2], 10) - 1;
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { ri: row, ci: col - 1 };
}

function parseRange(range) {
  const parts = range.split(':');
  if (parts.length !== 2) return [];
  const start = parseCellRef(parts[0].trim());
  const end = parseCellRef(parts[1].trim());
  if (!start || !end) return [];
  const cells = [];
  for (let r = Math.min(start.ri, end.ri); r <= Math.max(start.ri, end.ri); r++) {
    for (let c = Math.min(start.ci, end.ci); c <= Math.max(start.ci, end.ci); c++) {
      cells.push({ ri: r, ci: c });
    }
  }
  return cells;
}

function evaluateFormula(value, rows) {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  if (!v.startsWith('=')) return v;
  const expr = v.slice(1).trim().toUpperCase();

  const fnMatch = expr.match(/^(SUM|AVG|AVERAGE|MEDIAN|MIN|MAX|COUNT)\((.+)\)$/);
  if (fnMatch) {
    const fnName = fnMatch[1];
    const cells = parseRange(fnMatch[2]);
    const nums = cells.map(c => parseNumber(rows[c.ri]?.[c.ci])).filter(n => !isNaN(n));
    if (nums.length === 0) return 0;
    switch (fnName) {
      case 'SUM': return calcSum(nums);
      case 'AVG': case 'AVERAGE': return calcAvg(nums);
      case 'MEDIAN': return calcMedian(nums);
      case 'MIN': return calcMin(nums);
      case 'MAX': return calcMax(nums);
      case 'COUNT': return calcCount(nums);
    }
  }

  try {
    let mathExpr = v.slice(1);
    mathExpr = mathExpr.replace(/[A-Z]+\d+/gi, (ref) => {
      const cell = parseCellRef(ref.toUpperCase());
      if (!cell) return '0';
      const val = rows[cell.ri]?.[cell.ci];
      const num = parseNumber(val);
      return isNaN(num) ? '0' : String(num);
    });
    const safe = mathExpr.replace(/[^0-9+\-*/().%\s]/g, '');
    if (!safe.trim()) return 'שגיאה';
    // eslint-disable-next-line no-new-func
    const result = new Function('return ' + safe)();
    return isNaN(result) || !isFinite(result) ? 'שגיאה' : Math.round(result * 10000) / 10000;
  } catch {
    return 'שגיאה';
  }
}

export default function ExcelWriter() {
  const { userData, currentUser, selectedSchool } = useAuth();
  const uid = currentUser?.uid;
  const [sheets, setSheets] = useState([]);
  const [activeSheet, setActiveSheet] = useState(null);
  const [sheetData, setSheetData] = useState({ columns: [], rows: [] });
  const [showNewSheet, setShowNewSheet] = useState(false);
  const [newSheetName, setNewSheetName] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [columnWidths, setColumnWidths] = useState({});
  const [rowHeights, setRowHeights] = useState({});
  const [editingCell, setEditingCell] = useState(null);
  const [formulaBar, setFormulaBar] = useState('');
  const [selection, setSelection] = useState(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [showFnPicker, setShowFnPicker] = useState(false);
  const [rangeSelecting, setRangeSelecting] = useState(false);
  const [formulaPrefix, setFormulaPrefix] = useState('');
  const [clipboard, setClipboard] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [cellEditMode, setCellEditMode] = useState(false); // false=navigation, true=editing text
  const [mergedCells, setMergedCells] = useState([]); // array of { startRow, startCol, endRow, endCol }
  const [cellStyles, setCellStyles] = useState({}); // keyed by "row-col" => { bg, color }
  const [colorPickerMenu, setColorPickerMenu] = useState(null); // { type: 'bg'|'color', x, y }
  const [sheetContextMenu, setSheetContextMenu] = useState(null); // { x, y, sheetId }
  const [renamingSheetId, setRenamingSheetId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [shareSheetId, setShareSheetId] = useState(null);
  const [shareUsers, setShareUsers] = useState([]);
  const [shareTeams, setShareTeams] = useState([]);
  const [shareSelected, setShareSelected] = useState([]); // selected user/team IDs
  const [fullscreen, setFullscreen] = useState(false);
  const [sheetsCollapsed, setSheetsCollapsed] = useState(false);
  const tableRef = useRef(null);
  const contextMenuRef = useRef(null);

  const PRESET_COLORS = [
    { label: 'לבן', value: '#ffffff' },
    { label: 'צהוב', value: '#fef08a' },
    { label: 'ירוק', value: '#86efac' },
    { label: 'כחול', value: '#93c5fd' },
    { label: 'אדום', value: '#fca5a5' },
    { label: 'כתום', value: '#fdba74' },
    { label: 'סגול', value: '#c4b5fd' },
    { label: 'ורוד', value: '#f9a8d4' },
    { label: 'אפור', value: '#d1d5db' },
  ];

  const schoolId = selectedSchool || userData?.schoolId;

  useEffect(() => {
    if (!schoolId) return;
    const q = query(collection(db, `sheets_${schoolId}`), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setSheets(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId]);

  useEffect(() => {
    if (activeSheet) {
      const sheet = sheets.find(s => s.id === activeSheet);
      if (sheet) {
        let rows;
        try {
          rows = sheet.rowsJson ? JSON.parse(sheet.rowsJson) : (sheet.rows || [['', '', '']]);
        } catch {
          rows = [['', '', '']];
        }
        setSheetData({
          columns: sheet.columns || ['עמודה 1', 'עמודה 2', 'עמודה 3'],
          rows
        });
        // Load mergedCells and cellStyles
        try {
          setMergedCells(sheet.mergedCellsJson ? JSON.parse(sheet.mergedCellsJson) : []);
        } catch { setMergedCells([]); }
        try {
          setCellStyles(sheet.cellStylesJson ? JSON.parse(sheet.cellStylesJson) : {});
        } catch { setCellStyles({}); }
      }
    }
  }, [activeSheet, sheets]);

  useEffect(() => {
    function handleUp() {
      if (isSelecting && rangeSelecting && editingCell) {
        // Finish range selection - close the parenthesis
        const currentVal = formulaBar;
        if (currentVal && !currentVal.endsWith(')')) {
          const finalVal = currentVal + ')';
          setFormulaBar(finalVal);
          updateCell(editingCell.ri, editingCell.ci, finalVal);
        }
        setRangeSelecting(false);
        setFormulaPrefix('');
      }
      setIsSelecting(false);
    }
    window.addEventListener('mouseup', handleUp);
    return () => window.removeEventListener('mouseup', handleUp);
  }, [isSelecting, rangeSelecting, editingCell, formulaBar]);

  async function createSheet(e) {
    e.preventDefault();
    e.stopPropagation();
    const name = newSheetName.trim();
    if (!name || !schoolId) return;
    try {
      const newDoc = await addDoc(collection(db, `sheets_${schoolId}`), {
        name,
        columns: ['עמודה 1', 'עמודה 2', 'עמודה 3'],
        rowsJson: JSON.stringify([['', '', '']]),
        createdBy: userData?.fullName || '',
        createdAt: new Date().toISOString()
      });
      setActiveSheet(newDoc.id);
      setNewSheetName('');
      setShowNewSheet(false);
    } catch (err) {
      alert('שגיאה ביצירת הטבלה: ' + err.message);
    }
  }

  async function saveSheet() {
    if (!activeSheet || !schoolId) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, `sheets_${schoolId}`, activeSheet), {
        columns: sheetData.columns,
        rowsJson: JSON.stringify(sheetData.rows),
        mergedCellsJson: JSON.stringify(mergedCells),
        cellStylesJson: JSON.stringify(cellStyles)
      });
    } catch (err) {
      alert('שגיאה בשמירה: ' + err.message);
    }
    setSaving(false);
  }

  async function togglePinSheet(sheetId, isPinned) {
    if (!uid || !schoolId) return;
    await updateDoc(doc(db, `sheets_${schoolId}`, sheetId), {
      pinnedBy: isPinned ? arrayRemove(uid) : arrayUnion(uid)
    });
  }

  async function deleteSheet(sheetId) {
    if (!confirm('האם למחוק טבלה זו?')) return;
    await deleteDoc(doc(db, `sheets_${schoolId}`, sheetId));
    if (activeSheet === sheetId) {
      setActiveSheet(null);
      setSheetData({ columns: [], rows: [] });
    }
  }

  // Sheet context menu handler
  function handleSheetContextMenu(e, sheetId) {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 180;
    const menuHeight = 130;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > vw) x = vw - menuWidth - 8;
    if (y + menuHeight > vh) y = vh - menuHeight - 8;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    setSheetContextMenu({ x, y, sheetId });
  }

  function closeSheetContextMenu() {
    setSheetContextMenu(null);
  }

  // Rename sheet
  function startRenameSheet(sheetId) {
    const sheet = sheets.find(s => s.id === sheetId);
    setRenamingSheetId(sheetId);
    setRenameValue(sheet?.name || '');
    closeSheetContextMenu();
  }

  async function submitRenameSheet(sheetId) {
    const name = renameValue.trim();
    if (!name || !schoolId) { setRenamingSheetId(null); return; }
    try {
      await updateDoc(doc(db, `sheets_${schoolId}`, sheetId), { name });
    } catch (err) {
      alert('שגיאה בשינוי שם: ' + err.message);
    }
    setRenamingSheetId(null);
    setRenameValue('');
  }

  // Share sheet
  async function openShareModal(sheetId) {
    closeSheetContextMenu();
    setShareSheetId(sheetId);
    // Load existing sharedWith from the sheet
    const sheet = sheets.find(s => s.id === sheetId);
    setShareSelected(sheet?.sharedWith || []);
    // Load users from school
    try {
      const usersQ = query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId));
      const usersSnap = await getDocs(usersQ);
      setShareUsers(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch { setShareUsers([]); }
    // Load teams
    try {
      const teamsSnap = await getDocs(collection(db, `teams_${schoolId}`));
      setShareTeams(teamsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch { setShareTeams([]); }
  }

  function toggleShareItem(id) {
    setShareSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  async function saveShare() {
    if (!shareSheetId || !schoolId) return;
    try {
      await updateDoc(doc(db, `sheets_${schoolId}`, shareSheetId), { sharedWith: shareSelected });
    } catch (err) {
      alert('שגיאה בשיתוף: ' + err.message);
    }
    setShareSheetId(null);
    setShareSelected([]);
  }

  function updateColumn(index, value) {
    setSheetData(prev => {
      const cols = [...prev.columns];
      cols[index] = value;
      return { ...prev, columns: cols };
    });
  }

  function updateCell(rowIndex, colIndex, value) {
    setSheetData(prev => {
      const rows = prev.rows.map(r => [...r]);
      rows[rowIndex][colIndex] = value;
      return { ...prev, rows };
    });
  }

  function getCellDisplay(value) {
    if (typeof value === 'string' && value.trim().startsWith('=')) {
      const result = evaluateFormula(value, sheetData.rows);
      return result === 'שגיאה' ? 'שגיאה' : String(result);
    }
    return value;
  }

  function addColumn() {
    setSheetData(prev => ({
      columns: [...prev.columns, `עמודה ${prev.columns.length + 1}`],
      rows: prev.rows.map(r => [...r, ''])
    }));
  }

  function addRow() {
    setSheetData(prev => ({
      ...prev,
      rows: [...prev.rows, new Array(prev.columns.length).fill('')]
    }));
  }

  function removeColumn(index) {
    if (sheetData.columns.length <= 1) return;
    setSheetData(prev => ({
      columns: prev.columns.filter((_, i) => i !== index),
      rows: prev.rows.map(r => r.filter((_, i) => i !== index))
    }));
  }

  function removeRow(index) {
    if (sheetData.rows.length <= 1) return;
    setSheetData(prev => ({
      ...prev,
      rows: prev.rows.filter((_, i) => i !== index)
    }));
  }

  // Toggle fullscreen mode: hide sidebar and sheets panel
  useEffect(() => {
    if (fullscreen) {
      document.body.classList.add('excel-fullscreen');
    } else {
      document.body.classList.remove('excel-fullscreen');
    }
    return () => document.body.classList.remove('excel-fullscreen');
  }, [fullscreen]);

  const handleColumnResize = useCallback((colIndex, e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columnWidths[colIndex] || 120;
    function onMouseMove(ev) {
      // RTL: dragging right = smaller, dragging left = larger
      setColumnWidths(prev => ({ ...prev, [colIndex]: Math.max(60, startWidth - (ev.clientX - startX)) }));
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [columnWidths]);

  const handleRowResize = useCallback((rowIndex, e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = rowHeights[rowIndex] || 32;
    function onMouseMove(ev) {
      setRowHeights(prev => ({ ...prev, [rowIndex]: Math.max(24, startHeight + (ev.clientY - startY)) }));
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [rowHeights]);

  function handleCellMouseDown(ri, ci, e) {
    if (e.button !== 0) return;

    if (rangeSelecting && editingCell) {
      // In range selection mode - build the range reference
      setSelection({ startRow: ri, startCol: ci, endRow: ri, endCol: ci });
      setIsSelecting(true);
      // Update formula with start cell
      const ref = cellRef(ri, ci);
      const val = formulaPrefix + ref;
      setFormulaBar(val);
      updateCell(editingCell.ri, editingCell.ci, val);
      return;
    }

    setSelection({ startRow: ri, startCol: ci, endRow: ri, endCol: ci });
    setIsSelecting(true);
    setEditingCell({ ri, ci });
    setFormulaBar(sheetData.rows[ri]?.[ci] || '');
    setCellEditMode(false);
    setRangeSelecting(false);
    setFormulaPrefix('');
  }

  function handleCellMouseEnter(ri, ci) {
    if (!isSelecting) return;
    setSelection(prev => prev ? { ...prev, endRow: ri, endCol: ci } : null);

    if (rangeSelecting && editingCell) {
      const startRef = cellRef(
        Math.min(selection.startRow, ri),
        Math.min(selection.startCol, ci)
      );
      const endRef = cellRef(
        Math.max(selection.startRow, ri),
        Math.max(selection.startCol, ci)
      );
      const rangeStr = startRef === endRef ? startRef : `${startRef}:${endRef}`;
      const val = formulaPrefix + rangeStr;
      setFormulaBar(val);
      updateCell(editingCell.ri, editingCell.ci, val);
    }
  }

  function isInSelection(ri, ci) {
    if (!selection) return false;
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    return ri >= minR && ri <= maxR && ci >= minC && ci <= maxC;
  }

  function getSelectedNumbers() {
    if (!selection) return [];
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    const nums = [];
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const n = parseNumber(getCellDisplay(sheetData.rows[r]?.[c]));
        if (!isNaN(n)) nums.push(n);
      }
    }
    return nums;
  }

  function getSelectionLabel() {
    if (!selection) return '';
    const s = cellRef(selection.startRow, selection.startCol);
    const e = cellRef(selection.endRow, selection.endCol);
    return s === e ? s : `${s}:${e}`;
  }

  function handleFormulaBarChange(e) {
    const val = e.target.value;
    setFormulaBar(val);
    if (editingCell) {
      updateCell(editingCell.ri, editingCell.ci, val);
    }
    // Show function picker when typing = at the start
    if (val === '=' || val === '=') {
      setShowFnPicker(true);
    } else {
      setShowFnPicker(false);
    }
  }

  function selectFunction(fnId) {
    const fnName = fnId.toUpperCase();
    if (fnName === 'COUNT') {
      // COUNT doesn't need special handling
    }
    const prefix = `=${fnName}(`;
    setFormulaPrefix(prefix);
    setShowFnPicker(false);
    setRangeSelecting(true);
    if (editingCell) {
      const val = prefix;
      setFormulaBar(val);
      updateCell(editingCell.ri, editingCell.ci, val);
    }
  }

  function handleFormulaBarKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingCell && editingCell.ri < sheetData.rows.length - 1) {
        const nextRi = editingCell.ri + 1;
        setEditingCell({ ri: nextRi, ci: editingCell.ci });
        setFormulaBar(sheetData.rows[nextRi]?.[editingCell.ci] || '');
        setSelection({ startRow: nextRi, startCol: editingCell.ci, endRow: nextRi, endCol: editingCell.ci });
      }
    }
  }

  // Push current state to undo stack (includes rows, mergedCells, cellStyles)
  function pushUndo() {
    setUndoStack(prev => [...prev.slice(-20), JSON.stringify({ rows: sheetData.rows, mergedCells, cellStyles })]);
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack(s => s.slice(0, -1));
    try {
      const snapshot = JSON.parse(prev);
      if (snapshot.rows) {
        setSheetData(sd => ({ ...sd, rows: snapshot.rows }));
      }
      if (snapshot.mergedCells !== undefined) {
        setMergedCells(snapshot.mergedCells);
      }
      if (snapshot.cellStyles !== undefined) {
        setCellStyles(snapshot.cellStyles);
      }
    } catch {}
  }

  // Ensure grid is large enough, then navigate
  function navigateTo(ri, ci) {
    if (ri < 0 || ci < 0) return;
    setSheetData(prev => {
      let { columns, rows } = prev;
      let changed = false;
      // Expand columns if needed
      if (ci >= columns.length) {
        const extra = ci - columns.length + 1;
        columns = [...columns, ...Array.from({ length: extra }, (_, i) => `עמודה ${columns.length + i + 1}`)];
        rows = rows.map(r => [...r, ...new Array(extra).fill('')]);
        changed = true;
      }
      // Expand rows if needed
      if (ri >= rows.length) {
        const extra = ri - rows.length + 1;
        const newRows = Array.from({ length: extra }, () => new Array(columns.length).fill(''));
        rows = [...rows, ...newRows];
        changed = true;
      }
      // Use the (possibly expanded) rows to set formulaBar, avoiding stale reference
      setFormulaBar(rows[ri]?.[ci] ?? '');
      return changed ? { columns, rows } : prev;
    });
    setEditingCell({ ri, ci });
    setSelection({ startRow: ri, startCol: ci, endRow: ri, endCol: ci });
    setCellEditMode(false);
  }

  // Keyboard navigation for cells
  function handleCellKeyDown(ri, ci, e) {
    // Ctrl/Cmd shortcuts always work
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'c') {
        setClipboard({ mode: 'copy', ri, ci, value: sheetData.rows[ri]?.[ci] || '' });
      } else if (e.key === 'x') {
        pushUndo();
        setClipboard({ mode: 'cut', ri, ci, value: sheetData.rows[ri]?.[ci] || '' });
        updateCell(ri, ci, '');
        setFormulaBar('');
        setCellEditMode(false);
      } else if (e.key === 'v' && clipboard) {
        e.preventDefault();
        pushUndo();
        updateCell(ri, ci, clipboard.value);
        setFormulaBar(clipboard.value);
        if (clipboard.mode === 'cut') setClipboard(null);
      } else if (e.key === 'z') {
        e.preventDefault();
        handleUndo();
      }
      return;
    }

    // Enter: if in edit mode, confirm and move down. If in nav mode, enter edit mode.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (cellEditMode) {
        // Confirm edit, move down (auto-expands grid)
        navigateTo(ri + 1, ci);
      } else {
        // Enter edit mode
        setCellEditMode(true);
      }
      return;
    }

    // Escape: exit edit mode or deselect
    if (e.key === 'Escape') {
      if (cellEditMode) {
        setCellEditMode(false);
      } else {
        setEditingCell(null);
        setSelection(null);
      }
      setContextMenu(null);
      return;
    }

    // Tab always navigates (auto-expands grid)
    if (e.key === 'Tab') {
      e.preventDefault();
      const nextCi = e.shiftKey ? Math.max(ci - 1, 0) : ci + 1;
      navigateTo(ri, nextCi);
      return;
    }

    // Arrow keys: in navigation mode they always move. In edit mode they move cursor within text.
    if (!cellEditMode) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateTo(ri + 1, ci);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateTo(Math.max(ri - 1, 0), ci);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateTo(ri, Math.max(ci - 1, 0)); // RTL
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateTo(ri, ci + 1); // RTL - auto-expands grid
      } else if (e.key === 'Delete') {
        pushUndo();
        updateCell(ri, ci, '');
        setFormulaBar('');
      } else if (e.key === 'Backspace') {
        pushUndo();
        updateCell(ri, ci, '');
        setFormulaBar('');
        setCellEditMode(true);
      } else if (e.key === 'F2') {
        // F2 enters edit mode (Excel standard)
        setCellEditMode(true);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Typing a character in nav mode: clear cell and start editing
        pushUndo();
        updateCell(ri, ci, e.key);
        setFormulaBar(e.key);
        setCellEditMode(true);
        e.preventDefault();
      }
    }
    // In edit mode, let the browser handle arrow keys for cursor movement within text
  }

  // Right-click context menu with viewport boundary checking
  function handleContextMenu(ri, ci, e) {
    e.preventDefault();
    setEditingCell({ ri, ci });
    setFormulaBar(sheetData.rows[ri]?.[ci] || '');
    setSelection({ startRow: ri, startCol: ci, endRow: ri, endCol: ci });
    // Set initial position at click; useEffect will reposition after render
    setContextMenu({ x: e.clientX, y: e.clientY, ri, ci });
  }

  // Reposition context menu after render to prevent overflow
  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;
    const el = contextMenuRef.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { x, y } = contextMenu;
    if (x + rect.width > vw) x = vw - rect.width - 8;
    if (y + rect.height > vh) y = vh - rect.height - 8;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    if (x !== contextMenu.x || y !== contextMenu.y) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }, [contextMenu]);

  function closeContextMenu() {
    setContextMenu(null);
  }

  function ctxCopy() {
    if (!contextMenu) return;
    setClipboard({ mode: 'copy', ri: contextMenu.ri, ci: contextMenu.ci, value: sheetData.rows[contextMenu.ri]?.[contextMenu.ci] || '' });
    closeContextMenu();
  }

  function ctxCut() {
    if (!contextMenu) return;
    pushUndo();
    setClipboard({ mode: 'cut', ri: contextMenu.ri, ci: contextMenu.ci, value: sheetData.rows[contextMenu.ri]?.[contextMenu.ci] || '' });
    updateCell(contextMenu.ri, contextMenu.ci, '');
    if (editingCell?.ri === contextMenu.ri && editingCell?.ci === contextMenu.ci) setFormulaBar('');
    closeContextMenu();
  }

  function ctxPaste() {
    if (!contextMenu || !clipboard) return;
    pushUndo();
    updateCell(contextMenu.ri, contextMenu.ci, clipboard.value);
    if (editingCell?.ri === contextMenu.ri && editingCell?.ci === contextMenu.ci) setFormulaBar(clipboard.value);
    if (clipboard.mode === 'cut') setClipboard(null);
    closeContextMenu();
  }

  function ctxDelete() {
    if (!contextMenu) return;
    pushUndo();
    updateCell(contextMenu.ri, contextMenu.ci, '');
    if (editingCell?.ri === contextMenu.ri && editingCell?.ci === contextMenu.ci) setFormulaBar('');
    closeContextMenu();
  }

  function ctxClearRow() {
    if (!contextMenu) return;
    pushUndo();
    setSheetData(prev => {
      const rows = prev.rows.map(r => [...r]);
      rows[contextMenu.ri] = new Array(prev.columns.length).fill('');
      return { ...prev, rows };
    });
    closeContextMenu();
  }

  function ctxDeleteRow() {
    if (!contextMenu || sheetData.rows.length <= 1) return;
    pushUndo();
    removeRow(contextMenu.ri);
    closeContextMenu();
  }

  function ctxDeleteCol() {
    if (!contextMenu || sheetData.columns.length <= 1) return;
    pushUndo();
    removeColumn(contextMenu.ci);
    closeContextMenu();
  }

  function ctxInsertRowBelow() {
    if (!contextMenu) return;
    pushUndo();
    setSheetData(prev => {
      const newRow = new Array(prev.columns.length).fill('');
      const rows = [...prev.rows];
      rows.splice(contextMenu.ri + 1, 0, newRow);
      return { ...prev, rows };
    });
    closeContextMenu();
  }

  function ctxInsertColRight() {
    if (!contextMenu) return;
    pushUndo();
    setSheetData(prev => ({
      columns: [...prev.columns.slice(0, contextMenu.ci + 1), `עמודה ${prev.columns.length + 1}`, ...prev.columns.slice(contextMenu.ci + 1)],
      rows: prev.rows.map(r => [...r.slice(0, contextMenu.ci + 1), '', ...r.slice(contextMenu.ci + 1)])
    }));
    closeContextMenu();
  }

  function ctxInsertRowAbove() {
    if (!contextMenu) return;
    pushUndo();
    setSheetData(prev => {
      const newRow = new Array(prev.columns.length).fill('');
      const rows = [...prev.rows];
      rows.splice(contextMenu.ri, 0, newRow);
      return { ...prev, rows };
    });
    closeContextMenu();
  }

  function ctxInsertColLeft() {
    if (!contextMenu) return;
    pushUndo();
    setSheetData(prev => ({
      columns: [...prev.columns.slice(0, contextMenu.ci), `עמודה ${prev.columns.length + 1}`, ...prev.columns.slice(contextMenu.ci)],
      rows: prev.rows.map(r => [...r.slice(0, contextMenu.ci), '', ...r.slice(contextMenu.ci)])
    }));
    closeContextMenu();
  }

  // --- Cell Merge helpers ---
  function getMergeForCell(ri, ci) {
    return mergedCells.find(m =>
      ri >= m.startRow && ri <= m.endRow && ci >= m.startCol && ci <= m.endCol
    );
  }

  function isMergeOrigin(ri, ci) {
    return mergedCells.some(m => m.startRow === ri && m.startCol === ci);
  }

  function isMergedButNotOrigin(ri, ci) {
    return mergedCells.some(m =>
      ri >= m.startRow && ri <= m.endRow && ci >= m.startCol && ci <= m.endCol &&
      !(m.startRow === ri && m.startCol === ci)
    );
  }

  function ctxMergeCells() {
    if (!selection) { closeContextMenu(); return; }
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    if (minR === maxR && minC === maxC) { closeContextMenu(); return; } // single cell, nothing to merge
    pushUndo();
    // Remove any existing merges that overlap with this range
    const filtered = mergedCells.filter(m =>
      !(m.startRow <= maxR && m.endRow >= minR && m.startCol <= maxC && m.endCol >= minC)
    );
    setMergedCells([...filtered, { startRow: minR, startCol: minC, endRow: maxR, endCol: maxC }]);
    closeContextMenu();
  }

  function ctxUnmergeCells() {
    if (!selection) { closeContextMenu(); return; }
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    pushUndo();
    setMergedCells(mergedCells.filter(m =>
      !(m.startRow <= maxR && m.endRow >= minR && m.startCol <= maxC && m.endCol >= minC)
    ));
    closeContextMenu();
  }

  // --- Cell/Text coloring ---
  function applyColor(type, color) {
    if (!selection) return;
    pushUndo();
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    setCellStyles(prev => {
      const next = { ...prev };
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const key = `${r}-${c}`;
          const existing = next[key] || {};
          if (type === 'bg') {
            next[key] = { ...existing, bg: color };
          } else {
            next[key] = { ...existing, color };
          }
        }
      }
      return next;
    });
    setColorPickerMenu(null);
    closeContextMenu();
  }

  function openColorPicker(type, e) {
    e.stopPropagation();
    setColorPickerMenu({ type, x: e.clientX, y: e.clientY });
  }

  // Close context menus and color picker on click anywhere
  useEffect(() => {
    function handleClick() { setContextMenu(null); setColorPickerMenu(null); setSheetContextMenu(null); }
    if (contextMenu || colorPickerMenu || sheetContextMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu, colorPickerMenu, sheetContextMenu]);

  function insertCalcRow(calcId) {
    if (!editingCell) return;
    const fnName = calcId.toUpperCase();

    if (selection && (selection.startRow !== selection.endRow || selection.startCol !== selection.endCol)) {
      // Multi-cell selection exists - build formula for selection
      const startRef = cellRef(
        Math.min(selection.startRow, selection.endRow),
        Math.min(selection.startCol, selection.endCol)
      );
      const endRef = cellRef(
        Math.max(selection.startRow, selection.endRow),
        Math.max(selection.startCol, selection.endCol)
      );
      const formula = `=${fnName}(${startRef}:${endRef})`;
      updateCell(editingCell.ri, editingCell.ci, formula);
      setFormulaBar(formula);
    } else {
      // No multi-cell selection - enter range selection mode
      selectFunction(calcId);
    }
  }

  const activeSheetData = sheets.find(s => s.id === activeSheet);
  const filteredSheets = sheets.filter(s => {
    if (!searchQuery.trim()) return true;
    return s.name.toLowerCase().includes(searchQuery.toLowerCase());
  }).sort((a, b) => {
    const aPin = a.pinnedBy?.includes(uid) ? 0 : 1;
    const bPin = b.pinnedBy?.includes(uid) ? 0 : 1;
    return aPin - bPin;
  });

  const selectedNums = getSelectedNumbers();
  const selectionMulti = selection && (selection.startRow !== selection.endRow || selection.startCol !== selection.endCol);

  return (
    <div className="page">
      <Header title="מיפוי נתונים" />
      <div className="page-content">
        <div className={`excel-layout${fullscreen ? ' excel-layout--fullscreen' : ''}`}>
          <div className="sheets-panel" style={sheetsCollapsed ? { display: 'none' } : undefined}>
            <div className="sheets-header">
              <h3>טבלאות</h3>
              <button className="icon-btn" onClick={() => setShowNewSheet(true)} title="טבלה חדשה" type="button"><Plus size={16} /></button>
            </div>
            {showNewSheet && (
              <form onSubmit={createSheet} className="new-sheet-form">
                <input value={newSheetName} onChange={e => setNewSheetName(e.target.value)} placeholder="שם הטבלה" autoFocus />
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary btn-sm">צור</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setShowNewSheet(false); setNewSheetName(''); }}>ביטול</button>
                </div>
              </form>
            )}
            <div style={{ padding: '0.35rem 0.35rem 0' }}>
              <div className="search-bar" style={{ minWidth: 'auto' }}>
                <Search size={12} />
                <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="חיפוש..." style={{ fontSize: '0.75rem' }} />
              </div>
            </div>
            <div className="sheet-list">
              {filteredSheets.map(s => {
                const isPinned = s.pinnedBy?.includes(uid);
                return (
                <div
                  key={s.id}
                  className={`sheet-item ${activeSheet === s.id ? 'sheet-item--active' : ''} ${isPinned ? 'sheet-item--pinned' : ''}`}
                  onClick={() => { if (renamingSheetId !== s.id) setActiveSheet(s.id); }}
                  onContextMenu={e => handleSheetContextMenu(e, s.id)}
                >
                  <Table2 size={14} />
                  {renamingSheetId === s.id ? (
                    <input
                      className="sheet-rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') submitRenameSheet(s.id);
                        if (e.key === 'Escape') { setRenamingSheetId(null); setRenameValue(''); }
                      }}
                      onBlur={() => submitRenameSheet(s.id)}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="sheet-name">{s.name}</span>
                  )}
                  {s.sharedWith?.length > 0 && <Users size={11} style={{ color: '#94a3b8', flexShrink: 0 }} />}
                  <button className={`icon-btn ${isPinned ? 'icon-btn--pinned' : ''}`} title={isPinned ? 'הסר נעיצה' : 'נעץ'} onClick={e => { e.stopPropagation(); togglePinSheet(s.id, isPinned); }}><Pin size={12} style={isPinned ? { color: '#2563eb' } : undefined} /></button>
                  <button className="sheet-delete" onClick={e => { e.stopPropagation(); deleteSheet(s.id); }}><Trash2 size={12} /></button>
                </div>
                );
              })}
              {filteredSheets.length === 0 && <p className="sheets-empty">{searchQuery ? 'לא נמצאו תוצאות' : 'אין טבלאות'}</p>}
            </div>
          </div>

          <div className="excel-editor">
            {activeSheet ? (
              <>
                <div className="excel-toolbar">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <button
                      className="icon-btn"
                      title={sheetsCollapsed ? 'הצג פאנל טבלאות' : 'הסתר פאנל טבלאות'}
                      onClick={() => setSheetsCollapsed(prev => !prev)}
                    >
                      {sheetsCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
                    </button>
                    <span className="excel-sheet-name">{activeSheetData?.name}</span>
                  </div>
                  <div className="excel-actions">
                    <button className="btn btn-secondary btn-sm" onClick={addColumn}><Plus size={12} /> עמודה</button>
                    <button className="btn btn-secondary btn-sm" onClick={addRow}><Plus size={12} /> שורה</button>
                    <button className="btn btn-primary btn-sm" onClick={saveSheet} disabled={saving}>
                      <Save size={12} /> {saving ? 'שומר...' : 'שמירה'}
                    </button>
                    <button
                      className="icon-btn"
                      title={fullscreen ? 'צא ממסך מלא' : 'מסך מלא'}
                      onClick={() => { setFullscreen(prev => !prev); setSheetsCollapsed(prev => !prev); }}
                    >
                      {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    </button>
                  </div>
                </div>

                <div className="formula-bar" style={{ position: 'relative' }}>
                  <span className="formula-bar-label">
                    <Type size={12} />
                    {editingCell ? cellRef(editingCell.ri, editingCell.ci) : 'נוסחה'}
                  </span>
                  {rangeSelecting && (
                    <span style={{ background: '#dbeafe', color: '#2563eb', padding: '0.15rem 0.5rem', borderRadius: 8, fontSize: '0.7rem', fontWeight: 600, marginRight: '0.5rem' }}>
                      בחרו תאים בגרירה
                    </span>
                  )}
                  <input
                    className="formula-bar-input"
                    value={editingCell ? formulaBar : ''}
                    onChange={handleFormulaBarChange}
                    onKeyDown={handleFormulaBarKeyDown}
                    placeholder={editingCell ? 'ערך או נוסחה: =2+3, =SUM(A1:A5)...' : 'לחצו על תא'}
                    disabled={!editingCell}
                  />
                  {showFnPicker && editingCell && (
                    <div className="fn-picker" style={{
                      position: 'absolute',
                      zIndex: 50,
                      background: '#fff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      padding: '0.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.15rem',
                      right: 0,
                      top: '100%',
                      minWidth: 160
                    }}>
                      {CALC_FUNCTIONS.map(c => (
                        <button
                          key={c.id}
                          className="fn-picker-item"
                          onClick={() => selectFunction(c.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.4rem 0.6rem',
                            border: 'none',
                            background: 'transparent',
                            borderRadius: 6,
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            fontFamily: 'Inter, sans-serif',
                            textAlign: 'right',
                            width: '100%'
                          }}
                          onMouseEnter={e => e.target.style.background = '#f1f5f9'}
                          onMouseLeave={e => e.target.style.background = 'transparent'}
                        >
                          <span style={{ fontWeight: 700, width: 20, color: '#2563eb' }}>{c.icon}</span>
                          <span>{c.label}</span>
                          <span style={{ fontSize: '0.7rem', color: '#94a3b8', marginRight: 'auto' }}>{c.id.toUpperCase()}()</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="calc-toolbar">
                  <span className="calc-toolbar-label"><Calculator size={13} /> חישובים:</span>
                  <div className="calc-buttons">
                    {CALC_FUNCTIONS.map(c => (
                      <button key={c.id} className="calc-btn" onClick={() => insertCalcRow(c.id)} title={`הוסף שורת ${c.label}`}>
                        <span className="calc-btn-icon">{c.icon}</span>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="excel-table-wrap" ref={tableRef}>
                  <table className="excel-table" style={{ tableLayout: 'fixed' }}>
                    <thead>
                      <tr>
                        <th className="excel-row-num" style={{ width: 40 }}></th>
                        {sheetData.columns.map((col, ci) => (
                          <th key={ci} className="excel-col-header" style={{ width: columnWidths[ci] || 120, position: 'relative' }}>
                            <div className="excel-col-letter">{colLabel(ci)}</div>
                            <input value={col} onChange={e => updateColumn(ci, e.target.value)} className="excel-col-input" />
                            {sheetData.columns.length > 1 && (
                              <button className="excel-col-remove" onClick={() => removeColumn(ci)}><X size={10} /></button>
                            )}
                            <div className="excel-col-resize" onMouseDown={e => handleColumnResize(ci, e)} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheetData.rows.map((row, ri) => (
                        <tr key={ri} style={{ height: rowHeights[ri] || 32 }}>
                          <td className="excel-row-num" style={{ position: 'relative' }}>
                            {ri + 1}
                            {sheetData.rows.length > 1 && (
                              <button className="excel-row-remove" onClick={() => removeRow(ri)}><X size={10} /></button>
                            )}
                            <div className="excel-row-resize" onMouseDown={e => handleRowResize(ri, e)} />
                          </td>
                          {row.map((cell, ci) => {
                            // Skip cells that are part of a merge but not the origin
                            if (isMergedButNotOrigin(ri, ci)) return null;

                            const merge = getMergeForCell(ri, ci);
                            const mergeOrigin = merge && merge.startRow === ri && merge.startCol === ci;
                            const colSpan = mergeOrigin ? (merge.endCol - merge.startCol + 1) : 1;
                            const rowSpan = mergeOrigin ? (merge.endRow - merge.startRow + 1) : 1;

                            const isFocused = editingCell?.ri === ri && editingCell?.ci === ci;
                            const inSel = isInSelection(ri, ci);
                            const isFormula = typeof cell === 'string' && cell.trim().startsWith('=');
                            const displayVal = isFocused ? cell : getCellDisplay(cell);

                            const isEditing = isFocused && cellEditMode;

                            const styleKey = `${ri}-${ci}`;
                            const cs = cellStyles[styleKey];
                            const cellInlineStyle = {
                              width: mergeOrigin ? undefined : (columnWidths[ci] || 120),
                              height: mergeOrigin ? undefined : (rowHeights[ri] || 32),
                              ...(cs?.bg ? { backgroundColor: cs.bg } : {}),
                              ...(cs?.color ? { color: cs.color } : {}),
                            };

                            return (
                              <td
                                key={ci}
                                className={`excel-cell ${inSel ? 'excel-cell--selected' : ''} ${isFocused ? 'excel-cell--focused' : ''} ${isFormula && !isFocused ? 'excel-cell--formula' : ''} ${clipboard?.mode === 'cut' && clipboard.ri === ri && clipboard.ci === ci ? 'excel-cell--cut' : ''}`}
                                style={cellInlineStyle}
                                colSpan={colSpan > 1 ? colSpan : undefined}
                                rowSpan={rowSpan > 1 ? rowSpan : undefined}
                                onMouseDown={e => handleCellMouseDown(ri, ci, e)}
                                onMouseEnter={() => handleCellMouseEnter(ri, ci)}
                                onContextMenu={e => handleContextMenu(ri, ci, e)}
                                onDoubleClick={() => { setEditingCell({ ri, ci }); setCellEditMode(true); }}
                              >
                                <input
                                  value={isEditing ? cell : (isFocused ? (displayVal || '') : (displayVal || ''))}
                                  onChange={e => {
                                    if (!cellEditMode && isFocused) return; // ignore in nav mode
                                    const val = e.target.value;
                                    updateCell(ri, ci, val);
                                    if (isFocused) {
                                      setFormulaBar(val);
                                      if (val === '=') {
                                        setShowFnPicker(true);
                                      } else if (!val.startsWith('=')) {
                                        setShowFnPicker(false);
                                      }
                                    }
                                  }}
                                  onKeyDown={e => handleCellKeyDown(ri, ci, e)}
                                  className={`excel-cell-input ${isFocused && !cellEditMode ? 'excel-cell-input--nav' : ''}`}
                                  style={cs?.color ? { color: cs.color } : undefined}
                                  tabIndex={-1}
                                  autoFocus={isFocused}
                                  readOnly={isFocused && !cellEditMode}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="calc-summary-bar">
                  {selectionMulti && selectedNums.length > 0 ? (
                    <>
                      <span className="calc-summary-item">בחירה: <strong>{getSelectionLabel()}</strong></span>
                      <span className="calc-summary-item">סכום: <strong>{Math.round(calcSum(selectedNums) * 100) / 100}</strong></span>
                      <span className="calc-summary-item">ממוצע: <strong>{Math.round(calcAvg(selectedNums) * 100) / 100}</strong></span>
                      <span className="calc-summary-item">חציון: <strong>{Math.round(calcMedian(selectedNums) * 100) / 100}</strong></span>
                      <span className="calc-summary-item">ספירה: <strong>{calcCount(selectedNums)}</strong></span>
                    </>
                  ) : editingCell ? (
                    <>
                      {CALC_FUNCTIONS.slice(0, 4).map(c => {
                        const colNums = sheetData.rows.map(r => parseNumber(getCellDisplay(r[editingCell.ci]))).filter(n => !isNaN(n));
                        const result = colNums.length > 0 ? Math.round(c.fn(colNums) * 100) / 100 : '—';
                        return <span key={c.id} className="calc-summary-item">{c.label}: <strong>{result}</strong></span>;
                      })}
                    </>
                  ) : (
                    <span className="calc-summary-item">לחצו על תא להצגת סטטיסטיקות</span>
                  )}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <Table2 size={40} className="empty-icon" />
                <p>בחרו טבלה או צרו חדשה</p>
              </div>
            )}
          </div>
        </div>

        {/* Right-click context menu */}
        {contextMenu && (
          <div
            ref={contextMenuRef}
            className="cell-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={e => e.stopPropagation()}
          >
            <button className="ctx-item" onClick={ctxCopy}><Copy size={13} /> העתקה</button>
            <button className="ctx-item" onClick={ctxCut}><Scissors size={13} /> חיתוך</button>
            <button className="ctx-item" onClick={ctxPaste} disabled={!clipboard}>
              <ClipboardPaste size={13} /> הדבקה
            </button>
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={ctxDelete}><Trash2 size={13} /> מחיקת תוכן</button>
            <button className="ctx-item" onClick={ctxClearRow}><Eraser size={13} /> ניקוי שורה</button>
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={ctxInsertRowAbove}><ArrowUpToLine size={13} /> הוספת שורה מעל</button>
            <button className="ctx-item" onClick={ctxInsertRowBelow}><ArrowDownToLine size={13} /> הוספת שורה מתחת</button>
            <button className="ctx-item" onClick={ctxInsertColLeft}><ArrowLeftToLine size={13} /> הוספת עמודה משמאל</button>
            <button className="ctx-item" onClick={ctxInsertColRight}><ArrowRightToLine size={13} /> הוספת עמודה מימין</button>
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={ctxMergeCells} disabled={!selectionMulti}>
              <Merge size={13} /> מיזוג תאים
            </button>
            <button className="ctx-item" onClick={ctxUnmergeCells}>
              <SplitSquareHorizontal size={13} /> ביטול מיזוג
            </button>
            <div className="ctx-divider" />
            <div className="ctx-item ctx-item--submenu" style={{ position: 'relative' }}>
              <button className="ctx-item" onClick={e => openColorPicker('bg', e)} style={{ border: 'none', width: '100%', textAlign: 'right' }}>
                <Paintbrush size={13} /> צבע רקע
              </button>
            </div>
            <div className="ctx-item ctx-item--submenu" style={{ position: 'relative' }}>
              <button className="ctx-item" onClick={e => openColorPicker('color', e)} style={{ border: 'none', width: '100%', textAlign: 'right' }}>
                <Palette size={13} /> צבע טקסט
              </button>
            </div>
            <div className="ctx-divider" />
            <button className="ctx-item ctx-item--danger" onClick={ctxDeleteRow} disabled={sheetData.rows.length <= 1}>
              <Trash2 size={13} /> מחיקת שורה
            </button>
            <button className="ctx-item ctx-item--danger" onClick={ctxDeleteCol} disabled={sheetData.columns.length <= 1}>
              <Trash2 size={13} /> מחיקת עמודה
            </button>
            <div className="ctx-divider" />
            <button className="ctx-item" onClick={handleUndo} disabled={undoStack.length === 0}>
              <RotateCcw size={13} /> ביטול (Ctrl+Z)
            </button>
          </div>
        )}

        {/* Color picker submenu */}
        {colorPickerMenu && (
          <div
            className="cell-context-menu"
            style={{ top: colorPickerMenu.y, left: colorPickerMenu.x, minWidth: 140 }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem', fontWeight: 600, color: '#64748b' }}>
              {colorPickerMenu.type === 'bg' ? 'צבע רקע' : 'צבע טקסט'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, padding: '0.3rem 0.5rem' }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c.value}
                  title={c.label}
                  onClick={() => applyColor(colorPickerMenu.type, c.value)}
                  style={{
                    width: 28, height: 28, borderRadius: 4,
                    backgroundColor: c.value,
                    border: '1px solid #cbd5e1',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Sheet context menu */}
        {sheetContextMenu && (
          <div
            className="cell-context-menu sheet-context-menu"
            style={{ top: sheetContextMenu.y, left: sheetContextMenu.x }}
            onClick={e => e.stopPropagation()}
          >
            <button className="ctx-item" onClick={() => openShareModal(sheetContextMenu.sheetId)}>
              <Share2 size={13} /> שיתוף
            </button>
            <button className="ctx-item" onClick={() => startRenameSheet(sheetContextMenu.sheetId)}>
              <Edit3 size={13} /> שינוי שם
            </button>
            <div className="ctx-divider" />
            <button className="ctx-item ctx-item--danger" onClick={() => { const id = sheetContextMenu.sheetId; closeSheetContextMenu(); deleteSheet(id); }}>
              <Trash2 size={13} /> מחיקה
            </button>
          </div>
        )}

        {/* Share modal */}
        {shareSheetId && (
          <div className="share-modal-overlay" onClick={() => { setShareSheetId(null); setShareSelected([]); }}>
            <div className="share-modal" onClick={e => e.stopPropagation()}>
              <div className="share-modal-header">
                <h3>שיתוף טבלה</h3>
                <button className="icon-btn" onClick={() => { setShareSheetId(null); setShareSelected([]); }}><X size={16} /></button>
              </div>
              <div className="share-modal-body">
                {shareUsers.length > 0 && (
                  <div className="share-section">
                    <h4><Users size={13} /> משתמשים</h4>
                    {shareUsers.map(u => (
                      <label key={u.id} className="share-check-item">
                        <input
                          type="checkbox"
                          checked={shareSelected.includes(u.id)}
                          onChange={() => toggleShareItem(u.id)}
                        />
                        <span>{u.fullName || u.email || u.id}</span>
                      </label>
                    ))}
                  </div>
                )}
                {shareTeams.length > 0 && (
                  <div className="share-section">
                    <h4><Users size={13} /> צוותים</h4>
                    {shareTeams.map(t => (
                      <label key={t.id} className="share-check-item">
                        <input
                          type="checkbox"
                          checked={shareSelected.includes(t.id)}
                          onChange={() => toggleShareItem(t.id)}
                        />
                        <span>{t.name || t.id}</span>
                      </label>
                    ))}
                  </div>
                )}
                {shareUsers.length === 0 && shareTeams.length === 0 && (
                  <p className="sheets-empty">לא נמצאו משתמשים או צוותים</p>
                )}
              </div>
              <div className="share-modal-footer">
                <button className="btn btn-primary btn-sm" onClick={saveShare}>שמירה</button>
                <button className="btn btn-secondary btn-sm" onClick={() => { setShareSheetId(null); setShareSelected([]); }}>ביטול</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
