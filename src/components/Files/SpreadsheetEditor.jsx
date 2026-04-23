import { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, Minus, FunctionSquare, Maximize2, Minimize2, Calculator, Merge, Paintbrush, Palette, Scissors, Copy, ClipboardPaste, Trash2, ArrowUpDown, ArrowDownUp, PlusCircle, MinusCircle, Undo2, Redo2, ZoomIn, ZoomOut, Type, Lock, Unlock, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, WrapText, Strikethrough } from 'lucide-react';
import './Editors.css';

function getColLetter(index) {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function parseCellRef(ref) {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const colStr = match[1];
  const row = parseInt(match[2], 10) - 1;
  let col = 0;
  for (let i = 0; i < colStr.length; i++) {
    col = col * 26 + (colStr.charCodeAt(i) - 64);
  }
  col -= 1;
  return { col, row };
}

function parseRange(rangeStr) {
  const parts = rangeStr.split(':');
  if (parts.length !== 2) return null;
  const start = parseCellRef(parts[0].trim());
  const end = parseCellRef(parts[1].trim());
  if (!start || !end) return null;
  return { start, end };
}

function getCellValue(cells, cellRef) {
  const cell = cells[cellRef];
  if (!cell) return 0;
  if (cell.formula) {
    const result = evaluateFormula(cell.formula, cells);
    return typeof result === 'number' ? result : 0;
  }
  const num = parseFloat(cell.value);
  return isNaN(num) ? 0 : num;
}

function getRangeValues(cells, rangeStr) {
  const range = parseRange(rangeStr);
  if (!range) return [];
  const values = [];
  const minCol = Math.min(range.start.col, range.end.col);
  const maxCol = Math.max(range.start.col, range.end.col);
  const minRow = Math.min(range.start.row, range.end.row);
  const maxRow = Math.max(range.start.row, range.end.row);
  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      const ref = getColLetter(c) + (r + 1);
      values.push(getCellValue(cells, ref));
    }
  }
  return values;
}

function evaluateFormula(formula, cells, visited = new Set()) {
  if (!formula || !formula.startsWith('=')) return formula;
  const expr = formula.substring(1).trim().toUpperCase();

  const funcMatch = expr.match(/^(SUM|AVG|AVERAGE|COUNT|MAX|MIN|MEDIAN|MULTIPLY|DIVIDE|SUB|SUBTRACT)\((.+)\)$/);
  if (funcMatch) {
    const func = funcMatch[1];
    const arg = funcMatch[2].trim();
    const values = arg.includes(':')
      ? getRangeValues(cells, arg)
      : arg.split(',').map(a => {
          const trimmed = a.trim();
          const ref = parseCellRef(trimmed);
          if (ref) return getCellValue(cells, trimmed);
          const n = parseFloat(trimmed);
          return isNaN(n) ? 0 : n;
        });

    switch (func) {
      case 'SUM': return values.reduce((a, b) => a + b, 0);
      case 'AVG': case 'AVERAGE': return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      case 'COUNT': return values.length;
      case 'MAX': return values.length ? Math.max(...values) : 0;
      case 'MIN': return values.length ? Math.min(...values) : 0;
      case 'MEDIAN': {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      }
      case 'MULTIPLY': return values.length ? values.reduce((a, b) => a * b, 1) : 0;
      case 'DIVIDE': {
        if (values.length < 2) return '#ERR';
        if (values[1] === 0) return '#DIV/0';
        return values[0] / values[1];
      }
      case 'SUB': case 'SUBTRACT': return values.length < 2 ? '#ERR' : values[0] - values[1];
      default: return '#ERR';
    }
  }

  const singleRef = parseCellRef(expr);
  if (singleRef) {
    if (visited.has(expr)) return '#CIRC';
    visited.add(expr);
    return getCellValue(cells, expr);
  }

  try {
    let replaced = expr.replace(/[A-Z]+\d+/g, (match) => {
      if (visited.has(match)) return '0';
      return getCellValue(cells, match);
    });
    if (/^[\d\s+\-*/().]+$/.test(replaced)) {
      const result = Function('"use strict"; return (' + replaced + ')')();
      return typeof result === 'number' && isFinite(result) ? result : '#ERR';
    }
  } catch { /* fall through */ }

  return '#ERR';
}

function getDisplayValue(cell, cells) {
  if (!cell) return '';
  if (cell.formula) {
    const result = evaluateFormula(cell.formula, cells);
    if (typeof result === 'number') {
      return Number.isInteger(result) ? result.toString() : result.toFixed(2);
    }
    return String(result);
  }
  return cell.value || '';
}

const CALC_FUNCTIONS = [
  { id: 'sum', label: 'סכום', syntax: 'SUM', icon: '+' },
  { id: 'sub', label: 'חיסור', syntax: 'SUBTRACT', icon: '−' },
  { id: 'avg', label: 'ממוצע', syntax: 'AVERAGE', icon: 'x̄' },
  { id: 'median', label: 'חציון', syntax: 'MEDIAN', icon: 'M' },
  { id: 'multiply', label: 'כפל', syntax: 'MULTIPLY', icon: '×' },
  { id: 'divide', label: 'חילוק', syntax: 'DIVIDE', icon: '÷' },
  { id: 'min', label: 'מינימום', syntax: 'MIN', icon: '↓' },
  { id: 'max', label: 'מקסימום', syntax: 'MAX', icon: '↑' },
  { id: 'count', label: 'ספירה', syntax: 'COUNT', icon: '#' },
];

const CELL_COLORS = [
  '#ffffff', '#fef2f2', '#fff7ed', '#fefce8', '#f0fdf4', '#ecfdf5',
  '#f0f9ff', '#eff6ff', '#f5f3ff', '#fdf2f8', '#f1f5f9', '#e2e8f0',
];

const TEXT_COLORS = [
  '#1e293b', '#ef4444', '#f59e0b', '#16a34a', '#2563eb', '#8b5cf6',
  '#ec4899', '#14b8a6', '#64748b', '#a16207',
];

export default function SpreadsheetEditor({ data, onChange, readOnly = false, onToggleFullscreen, isFullscreen }) {
  const initialData = data || { columns: 5, rows: 10, cells: {}, headers: {}, columnWidths: {}, rowHeights: {}, mergedCells: [], cellStyles: {} };
  const [cells, setCells] = useState(initialData.cells || {});
  const [headers, setHeaders] = useState(initialData.headers || {});
  const [numCols, setNumCols] = useState(initialData.columns || 5);
  const [numRows, setNumRows] = useState(initialData.rows || 10);
  const [selectedCell, setSelectedCell] = useState(null);
  const [editingCell, setEditingCell] = useState(null);
  const [formulaValue, setFormulaValue] = useState('');
  const [saveStatus, setSaveStatus] = useState('saved');
  const [columnWidths, setColumnWidths] = useState(initialData.columnWidths || {});
  const [rowHeights, setRowHeights] = useState(initialData.rowHeights || {});
  const [showCalcMenu, setShowCalcMenu] = useState(false);
  const [selection, setSelection] = useState(null);
  const [mergedCells, setMergedCells] = useState(initialData.mergedCells || []);
  const [cellStyles, setCellStyles] = useState(initialData.cellStyles || {});
  const [showCellColorPicker, setShowCellColorPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [formulaSelectMode, setFormulaSelectMode] = useState(false); // true when user is building formula by clicking cells
  const [formulaSelStart, setFormulaSelStart] = useState(null); // starting cell when selecting range in formula mode
  const [isDragging, setIsDragging] = useState(false);
  const [cellContextMenu, setCellContextMenu] = useState(null); // { x, y, type: 'cell'|'row'|'col', row, col }
  const [clipboard, setClipboard] = useState(null); // { cells, type: 'cut'|'copy', startRow, startCol, endRow, endCol }
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [fontSize, setFontSize] = useState(13);
  const [freezeRow, setFreezeRow] = useState(initialData.freezeRow || 0); // number of frozen rows from top
  const [freezeCol, setFreezeCol] = useState(initialData.freezeCol || 0); // number of frozen cols from right
  const saveTimerRef = useRef(null);
  const cellInputRef = useRef(null);
  const formulaInputRef = useRef(null);
  const tableRef = useRef(null);

  const triggerSave = useCallback((newCells, newHeaders, cols, rows, colWidths, rHeights, merged, styles, fRow, fCol) => {
    setSaveStatus('pending');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      onChange?.({
        columns: cols,
        rows: rows,
        cells: newCells,
        headers: newHeaders,
        columnWidths: colWidths || columnWidths,
        rowHeights: rHeights || rowHeights,
        mergedCells: merged || mergedCells,
        cellStyles: styles || cellStyles,
        freezeRow: fRow != null ? fRow : freezeRow,
        freezeCol: fCol != null ? fCol : freezeCol,
      });
      setSaveStatus('saved');
    }, 800);
  }, [onChange, columnWidths, rowHeights, mergedCells, cellStyles, freezeRow, freezeCol]);

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, []);

  useEffect(() => {
    if (selectedCell && !formulaSelectMode) {
      const cell = cells[selectedCell];
      setFormulaValue(cell?.formula || cell?.value || '');
    } else if (!selectedCell) {
      setFormulaValue('');
    }
  }, [selectedCell, cells]);

  // Check if a cell is part of a merge (but not the origin)
  function getMergeForCell(ri, ci) {
    return mergedCells.find(m =>
      ri >= m.startRow && ri <= m.endRow && ci >= m.startCol && ci <= m.endCol
    );
  }

  function isMergeOrigin(ri, ci) {
    return mergedCells.some(m => m.startRow === ri && m.startCol === ci);
  }

  function isMergedButNotOrigin(ri, ci) {
    const merge = getMergeForCell(ri, ci);
    if (!merge) return false;
    return !(merge.startRow === ri && merge.startCol === ci);
  }

  function handleCellClick(cellRef, ri, ci, e) {
    if (readOnly) return;

    // If in formula select mode, append cell ref to formula
    if (formulaSelectMode && editingCell) {
      const currentVal = formulaValue;
      const lastChar = currentVal.slice(-1);
      let newVal;
      if (e?.shiftKey && formulaSelStart) {
        // Shift+click builds a range like A1:C3
        const startRef = getColLetter(formulaSelStart.col) + (formulaSelStart.row + 1);
        const endRef = cellRef;
        // Replace last ref or range with the new range
        const rangePattern = /[A-Z]+\d+(:[A-Z]+\d+)?$/;
        newVal = currentVal.replace(rangePattern, startRef + ':' + endRef);
        setFormulaValue(newVal);
      } else {
        if (lastChar === '(' || lastChar === ',' || lastChar === '+' || lastChar === '-' || lastChar === '*' || lastChar === '/') {
          newVal = currentVal + cellRef;
        } else if (/[A-Z]/.test(lastChar) || /\d/.test(lastChar)) {
          newVal = currentVal + ',' + cellRef;
        } else {
          newVal = currentVal + cellRef;
        }
        setFormulaValue(newVal);
        setFormulaSelStart({ row: ri, col: ci });
      }
      return;
    }

    setSelectedCell(cellRef);
    setEditingCell(null);
    setCellContextMenu(null);
    if (e?.shiftKey && selection) {
      setSelection(prev => ({ ...prev, endRow: ri, endCol: ci }));
    } else {
      setSelection({ startRow: ri, startCol: ci, endRow: ri, endCol: ci });
    }
    setTimeout(() => {
      tableRef.current?.querySelector(`td[data-ref="${cellRef}"]`)?.focus();
    }, 0);
  }

  function handleCellDoubleClick(cellRef) {
    if (readOnly) return;
    setSelectedCell(cellRef);
    setEditingCell(cellRef);
    setFormulaSelectMode(false);
    const cell = cells[cellRef];
    setFormulaValue(cell?.formula || cell?.value || '');
    setTimeout(() => cellInputRef.current?.focus(), 0);
  }

  function commitCell(cellRef, rawValue) {
    pushUndo();
    const newCells = { ...cells };
    const trimmed = (rawValue || '').trim();
    if (!trimmed) {
      delete newCells[cellRef];
    } else if (trimmed.startsWith('=')) {
      newCells[cellRef] = { ...newCells[cellRef], value: '', formula: trimmed };
    } else {
      newCells[cellRef] = { ...newCells[cellRef], value: trimmed, formula: '' };
    }
    setCells(newCells);
    setEditingCell(null);
    setFormulaSelectMode(false);
    setFormulaSelStart(null);
    triggerSave(newCells, headers, numCols, numRows);
  }

  function navigateTo(row, col, extendSelection = false) {
    if (row < 0 || col < 0 || row >= numRows || col >= numCols) return;
    const ref = getColLetter(col) + (row + 1);
    setSelectedCell(ref);
    setEditingCell(null);
    if (extendSelection && selection) {
      setSelection(prev => ({ ...prev, endRow: row, endCol: col }));
    } else {
      setSelection({ startRow: row, startCol: col, endRow: row, endCol: col });
    }
    setTimeout(() => {
      tableRef.current?.querySelector(`td[data-ref="${ref}"]`)?.focus();
    }, 0);
  }

  function handleCellKeyDown(e, cellRef) {
    const ref = parseCellRef(cellRef);
    if (!ref) return;

    if (editingCell === cellRef) {
      // In formula select mode, allow shift+arrow to build range selections
      if (formulaSelectMode && e.shiftKey && ['ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(e.key)) {
        e.preventDefault();
        // Extend formula range using shift+arrow
        const lastRefMatch = formulaValue.match(/([A-Z]+)(\d+)$/);
        if (lastRefMatch) {
          const lastCol = parseCellRef(lastRefMatch[0])?.col;
          const lastRow = parseCellRef(lastRefMatch[0])?.row;
          if (lastCol != null && lastRow != null) {
            let newRow = lastRow, newCol = lastCol;
            if (e.key === 'ArrowDown') newRow = Math.min(lastRow + 1, numRows - 1);
            else if (e.key === 'ArrowUp') newRow = Math.max(lastRow - 1, 0);
            else if (e.key === 'ArrowRight') newCol = Math.max(lastCol - 1, 0); // RTL
            else if (e.key === 'ArrowLeft') newCol = Math.min(lastCol + 1, numCols - 1); // RTL

            const newRef = getColLetter(newCol) + (newRow + 1);
            // If there's a range, extend it; otherwise create one
            if (formulaSelStart) {
              const startRef = getColLetter(formulaSelStart.col) + (formulaSelStart.row + 1);
              const rangePattern = /[A-Z]+\d+(:[A-Z]+\d+)?$/;
              setFormulaValue(formulaValue.replace(rangePattern, startRef + ':' + newRef));
            } else {
              // Start new range from last cell
              setFormulaSelStart({ row: lastRow, col: lastCol });
              setFormulaValue(formulaValue + ':' + newRef);
            }
          }
        }
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        // Auto-close open parenthesis if needed
        let finalVal = formulaValue;
        if (formulaSelectMode) {
          const openCount = (finalVal.match(/\(/g) || []).length;
          const closeCount = (finalVal.match(/\)/g) || []).length;
          if (openCount > closeCount) {
            finalVal += ')'.repeat(openCount - closeCount);
          }
        }
        commitCell(cellRef, finalVal);
        if (ref.row + 1 < numRows) navigateTo(ref.row + 1, ref.col);
      } else if (e.key === 'Escape') {
        setEditingCell(null);
        setFormulaSelectMode(false);
        setFormulaSelStart(null);
        const cell = cells[cellRef];
        setFormulaValue(cell?.formula || cell?.value || '');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitCell(cellRef, formulaValue);
        const nextCol = e.shiftKey ? ref.col - 1 : ref.col + 1;
        if (nextCol >= 0 && nextCol < numCols) navigateTo(ref.row, nextCol);
      }
    } else {
      const shift = e.shiftKey;
      if (e.key === 'ArrowDown') { e.preventDefault(); navigateTo(ref.row + 1, ref.col, shift); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); navigateTo(ref.row - 1, ref.col, shift); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); navigateTo(ref.row, ref.col - 1, shift); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); navigateTo(ref.row, ref.col + 1, shift); }
      else if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        setEditingCell(cellRef);
        const cell = cells[cellRef];
        setFormulaValue(cell?.formula || cell?.value || '');
        setTimeout(() => cellInputRef.current?.focus(), 0);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const nextCol = e.shiftKey ? ref.col - 1 : ref.col + 1;
        if (nextCol >= 0 && nextCol < numCols) navigateTo(ref.row, nextCol);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commitCell(cellRef, '');
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setEditingCell(cellRef);
        if (e.key === '=') {
          setFormulaSelectMode(true);
        }
        setFormulaValue(e.key);
        setTimeout(() => cellInputRef.current?.focus(), 0);
      }
    }
  }

  function handleFormulaBarKeyDown(e) {
    if (e.key === 'Enter' && selectedCell) {
      e.preventDefault();
      // Auto-close open parenthesis
      let finalVal = formulaValue;
      if (formulaSelectMode) {
        const openCount = (finalVal.match(/\(/g) || []).length;
        const closeCount = (finalVal.match(/\)/g) || []).length;
        if (openCount > closeCount) {
          finalVal += ')'.repeat(openCount - closeCount);
        }
      }
      commitCell(selectedCell, finalVal);
    } else if (e.key === 'Escape') {
      setFormulaSelectMode(false);
      setFormulaSelStart(null);
      const cell = cells[selectedCell];
      setFormulaValue(cell?.formula || cell?.value || '');
      formulaInputRef.current?.blur();
    }
  }

  function handleFormulaBarChange(e) {
    const val = e.target.value;
    setFormulaValue(val);
    // Enable formula select mode when formula has open parenthesis or starts with '='
    if (val.startsWith('=')) {
      const openCount = (val.match(/\(/g) || []).length;
      const closeCount = (val.match(/\)/g) || []).length;
      if (openCount > closeCount) {
        setFormulaSelectMode(true);
      } else if (val.length > 1) {
        setFormulaSelectMode(true);
      }
    } else {
      setFormulaSelectMode(false);
      setFormulaSelStart(null);
    }
  }

  function handleFormulaBarFocus() {
    if (selectedCell) {
      setEditingCell(selectedCell);
    }
  }

  function handleHeaderChange(colIndex, value) {
    const newHeaders = { ...headers, [colIndex]: value };
    setHeaders(newHeaders);
    triggerSave(cells, newHeaders, numCols, numRows);
  }

  function addColumn() {
    const newCols = numCols + 1;
    setNumCols(newCols);
    triggerSave(cells, headers, newCols, numRows);
  }
  function removeColumn() {
    if (numCols <= 1) return;
    const removedLetter = getColLetter(numCols - 1);
    const newCells = { ...cells };
    for (let r = 1; r <= numRows; r++) delete newCells[removedLetter + r];
    const newHeaders = { ...headers };
    delete newHeaders[numCols - 1];
    const newCols = numCols - 1;
    setCells(newCells);
    setHeaders(newHeaders);
    setNumCols(newCols);
    if (selectedCell) { const ref = parseCellRef(selectedCell); if (ref && ref.col >= newCols) { setSelectedCell(null); setEditingCell(null); } }
    triggerSave(newCells, newHeaders, newCols, numRows);
  }
  function addRow() {
    const newRows = numRows + 1;
    setNumRows(newRows);
    triggerSave(cells, headers, numCols, newRows);
  }
  function removeRow() {
    if (numRows <= 1) return;
    const newCells = { ...cells };
    for (let c = 0; c < numCols; c++) delete newCells[getColLetter(c) + numRows];
    const newRows = numRows - 1;
    setCells(newCells);
    setNumRows(newRows);
    if (selectedCell) { const ref = parseCellRef(selectedCell); if (ref && ref.row >= newRows) { setSelectedCell(null); setEditingCell(null); } }
    triggerSave(newCells, headers, numCols, newRows);
  }

  // Column/Row resize
  const handleColumnResize = useCallback((colIndex, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startWidth = columnWidths[colIndex] || 100;
    function onMouseMove(ev) { setColumnWidths(prev => ({ ...prev, [colIndex]: Math.max(40, startWidth - (ev.clientX - startX)) })); }
    function onMouseUp() { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
      setColumnWidths(prev => { triggerSave(cells, headers, numCols, numRows, prev, rowHeights); return prev; }); }
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
  }, [columnWidths, cells, headers, numCols, numRows, rowHeights, triggerSave]);

  const handleRowResize = useCallback((rowIndex, e) => {
    e.preventDefault(); e.stopPropagation();
    const startY = e.clientY;
    const startHeight = rowHeights[rowIndex] || 32;
    function onMouseMove(ev) { setRowHeights(prev => ({ ...prev, [rowIndex]: Math.max(20, startHeight + (ev.clientY - startY)) })); }
    function onMouseUp() { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp);
      setRowHeights(prev => { triggerSave(cells, headers, numCols, numRows, columnWidths, prev); return prev; }); }
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
  }, [rowHeights, cells, headers, numCols, numRows, columnWidths, triggerSave]);

  // Mouse drag selection
  function handleCellMouseDown(ri, ci, e) {
    if (readOnly || e.button !== 0 || formulaSelectMode) return;
    setIsDragging(true);
    if (e.shiftKey && selection) {
      setSelection(prev => prev ? { ...prev, endRow: ri, endCol: ci } : { startRow: ri, startCol: ci, endRow: ri, endCol: ci });
    } else {
      setSelection({ startRow: ri, startCol: ci, endRow: ri, endCol: ci });
    }
  }

  function handleCellMouseEnter(ri, ci) {
    if (!isDragging) return;
    setSelection(prev => prev ? { ...prev, endRow: ri, endCol: ci } : null);
  }

  useEffect(() => {
    if (!isDragging) return;
    function onMouseUp() { setIsDragging(false); }
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [isDragging]);

  // Merge cells
  function handleMergeCells() {
    if (!selection) return;
    pushUndo();
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    if (minR === maxR && minC === maxC) return; // single cell

    // Check if already merged - if so, unmerge
    const existingIdx = mergedCells.findIndex(m =>
      m.startRow === minR && m.endRow === maxR && m.startCol === minC && m.endCol === maxC
    );
    let newMerged;
    if (existingIdx >= 0) {
      newMerged = mergedCells.filter((_, i) => i !== existingIdx);
    } else {
      // Remove any overlapping merges
      newMerged = mergedCells.filter(m => {
        return m.endRow < minR || m.startRow > maxR || m.endCol < minC || m.startCol > maxC;
      });
      newMerged.push({ startRow: minR, endRow: maxR, startCol: minC, endCol: maxC });
    }
    setMergedCells(newMerged);
    triggerSave(cells, headers, numCols, numRows, columnWidths, rowHeights, newMerged, cellStyles);
  }

  // Cell background color
  function applyCellColor(color) {
    if (!selection) return;
    pushUndo();
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    const newStyles = { ...cellStyles };
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const key = `${r}-${c}`;
        newStyles[key] = { ...(newStyles[key] || {}), bg: color };
      }
    }
    setCellStyles(newStyles);
    setShowCellColorPicker(false);
    triggerSave(cells, headers, numCols, numRows, columnWidths, rowHeights, mergedCells, newStyles);
  }

  // Text color
  function applyTextColor(color) {
    if (!selection) return;
    pushUndo();
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    const newStyles = { ...cellStyles };
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const key = `${r}-${c}`;
        newStyles[key] = { ...(newStyles[key] || {}), color: color };
      }
    }
    setCellStyles(newStyles);
    setShowTextColorPicker(false);
    triggerSave(cells, headers, numCols, numRows, columnWidths, rowHeights, mergedCells, newStyles);
  }

  // Apply a style property to selection
  function applyStyleProp(prop, value) {
    if (!selection) return;
    pushUndo();
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    const newStyles = { ...cellStyles };
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const key = `${r}-${c}`;
        const cur = newStyles[key] || {};
        // Toggle boolean values
        if (value === 'toggle') {
          newStyles[key] = { ...cur, [prop]: !cur[prop] };
        } else {
          newStyles[key] = { ...cur, [prop]: value };
        }
      }
    }
    setCellStyles(newStyles);
    triggerSave(cells, headers, numCols, numRows, columnWidths, rowHeights, mergedCells, newStyles);
  }

  // Apply font size to selection
  function applyFontSize(size) {
    applyStyleProp('fontSize', size);
  }

  // Get current selected cell style
  function getSelectionStyle() {
    if (!selection) return {};
    const key = `${Math.min(selection.startRow, selection.endRow)}-${Math.min(selection.startCol, selection.endCol)}`;
    return cellStyles[key] || {};
  }

  // Close context menu on click
  useEffect(() => {
    function handleClick() { setCellContextMenu(null); }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Undo/Redo - full state snapshots
  function createSnapshot() {
    return {
      cells: { ...cells },
      cellStyles: { ...cellStyles },
      mergedCells: [...mergedCells],
      numRows,
      numCols,
      headers: { ...headers },
      freezeRow,
      freezeCol,
    };
  }

  function pushUndo(snapshot) {
    const snap = snapshot || createSnapshot();
    setUndoStack(us => {
      const next = [...us, snap];
      return next.length > 50 ? next.slice(-50) : next;
    });
    setRedoStack([]);
  }

  function applySnapshot(snap) {
    setCells(snap.cells);
    setCellStyles(snap.cellStyles);
    setMergedCells(snap.mergedCells);
    setNumRows(snap.numRows);
    setNumCols(snap.numCols);
    setHeaders(snap.headers);
    setFreezeRow(snap.freezeRow);
    setFreezeCol(snap.freezeCol);
    triggerSave(snap.cells, snap.headers, snap.numCols, snap.numRows, columnWidths, rowHeights, snap.mergedCells, snap.cellStyles, snap.freezeRow, snap.freezeCol);
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack(rs => [...rs, createSnapshot()]);
    setUndoStack(us => us.slice(0, -1));
    applySnapshot(prev);
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack(us => [...us, createSnapshot()]);
    setRedoStack(rs => rs.slice(0, -1));
    applySnapshot(next);
  }

  // Handle system clipboard paste with auto-expand rows/columns
  function handleSystemPaste(e) {
    if (readOnly || !selectedCell) return;
    if (editingCell) return; // let normal input paste work
    const pasteData = e.clipboardData?.getData('text');
    if (!pasteData) return;
    // Only intercept multi-cell paste (contains tabs or newlines)
    if (!pasteData.includes('\t') && !pasteData.includes('\n')) return;
    e.preventDefault();

    const ref = parseCellRef(selectedCell);
    if (!ref) return;
    pushUndo();

    const lines = pasteData.split('\n').filter((line, idx, arr) => {
      // Remove trailing empty line from copy
      if (idx === arr.length - 1 && !line.trim()) return false;
      return true;
    });

    let newNumRows = numRows;
    let newNumCols = numCols;

    // Calculate required rows and cols
    const neededRows = ref.row + lines.length;
    const maxCols = lines.reduce((max, line) => Math.max(max, line.split('\t').length), 0);
    const neededCols = ref.col + maxCols;

    if (neededRows > newNumRows) newNumRows = neededRows;
    if (neededCols > newNumCols) newNumCols = neededCols;

    const newCells = { ...cells };
    lines.forEach((line, lineIdx) => {
      const cellValues = line.split('\t');
      cellValues.forEach((val, colIdx) => {
        const targetRef = getColLetter(ref.col + colIdx) + (ref.row + lineIdx + 1);
        const trimmed = val.trim();
        if (trimmed) {
          if (trimmed.startsWith('=')) {
            newCells[targetRef] = { ...newCells[targetRef], value: '', formula: trimmed };
          } else {
            newCells[targetRef] = { ...newCells[targetRef], value: trimmed, formula: '' };
          }
        }
      });
    });

    setCells(newCells);
    if (newNumRows !== numRows) setNumRows(newNumRows);
    if (newNumCols !== numCols) setNumCols(newNumCols);
    triggerSave(newCells, headers, newNumCols, newNumRows);
  }

  // Global Ctrl+Z / Ctrl+Y + paste
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if (readOnly) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !editingCell && selection) {
        e.preventDefault();
        copySelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x' && !editingCell && selection) {
        e.preventDefault();
        cutSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !editingCell && clipboard) {
        // Let system paste handler handle if there's external data; otherwise use internal clipboard
        if (clipboard) pasteClipboard();
      }
    }
    document.addEventListener('keydown', handleGlobalKeyDown);
    document.addEventListener('paste', handleSystemPaste);
    return () => {
      document.removeEventListener('keydown', handleGlobalKeyDown);
      document.removeEventListener('paste', handleSystemPaste);
    };
  });

  // Context menu for cells/rows/columns
  function handleCellContextMenu(e, ri, ci, type) {
    e.preventDefault();
    e.stopPropagation();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const menuW = 200, menuH = 320;
    const x = e.clientX + menuW > vw ? Math.max(0, e.clientX - menuW) : e.clientX;
    const y = e.clientY + menuH > vh ? Math.max(0, e.clientY - menuH) : e.clientY;
    setCellContextMenu({ x, y, type, row: ri, col: ci });
  }

  function cutSelection() {
    if (!selection) return;
    pushUndo();
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    const clipCells = {};
    const clipStyles = {};
    const textRows = [];
    for (let r = minR; r <= maxR; r++) {
      const rowVals = [];
      for (let c = minC; c <= maxC; c++) {
        const ref = getColLetter(c) + (r + 1);
        if (cells[ref]) clipCells[`${r - minR}-${c - minC}`] = { ...cells[ref] };
        const styleKey = `${r}-${c}`;
        if (cellStyles[styleKey]) clipStyles[`${r - minR}-${c - minC}`] = { ...cellStyles[styleKey] };
        const cell = cells[ref];
        const displayVal = cell?.formula ? evaluateFormula(cell.formula, cells) : (cell?.value || '');
        rowVals.push(displayVal);
      }
      textRows.push(rowVals.join('\t'));
    }
    setClipboard({ cells: clipCells, styles: clipStyles, type: 'cut', startRow: minR, startCol: minC, endRow: maxR, endCol: maxC, rows: maxR - minR + 1, cols: maxC - minC + 1 });
    try { navigator.clipboard.writeText(textRows.join('\n')); } catch {}
    // Clear source cells and styles
    const newCells = { ...cells };
    const newStyles = { ...cellStyles };
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        delete newCells[getColLetter(c) + (r + 1)];
        delete newStyles[`${r}-${c}`];
      }
    }
    setCells(newCells);
    setCellStyles(newStyles);
    triggerSave(newCells, headers, numCols, numRows);
    setCellContextMenu(null);
  }

  function copySelection() {
    if (!selection) return;
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    const clipCells = {};
    const clipStyles = {};
    const textRows = [];
    for (let r = minR; r <= maxR; r++) {
      const rowVals = [];
      for (let c = minC; c <= maxC; c++) {
        const ref = getColLetter(c) + (r + 1);
        if (cells[ref]) clipCells[`${r - minR}-${c - minC}`] = { ...cells[ref] };
        const styleKey = `${r}-${c}`;
        if (cellStyles[styleKey]) clipStyles[`${r - minR}-${c - minC}`] = { ...cellStyles[styleKey] };
        const cell = cells[ref];
        const displayVal = cell?.formula ? evaluateFormula(cell.formula, cells) : (cell?.value || '');
        rowVals.push(displayVal);
      }
      textRows.push(rowVals.join('\t'));
    }
    setClipboard({ cells: clipCells, styles: clipStyles, type: 'copy', startRow: minR, startCol: minC, endRow: maxR, endCol: maxC, rows: maxR - minR + 1, cols: maxC - minC + 1 });
    // Write to system clipboard
    try { navigator.clipboard.writeText(textRows.join('\n')); } catch {}
    setCellContextMenu(null);
  }

  function pasteClipboard() {
    if (!clipboard || !selectedCell) return;
    const ref = parseCellRef(selectedCell);
    if (!ref) return;
    pushUndo();
    const newCells = { ...cells };
    const newStyles = { ...cellStyles };
    let newNumRows = numRows;
    let newNumCols = numCols;
    const neededRows = ref.row + clipboard.rows;
    const neededCols = ref.col + clipboard.cols;
    if (neededRows > newNumRows) newNumRows = neededRows;
    if (neededCols > newNumCols) newNumCols = neededCols;
    for (let r = 0; r < clipboard.rows; r++) {
      for (let c = 0; c < clipboard.cols; c++) {
        const srcData = clipboard.cells[`${r}-${c}`];
        const srcStyle = clipboard.styles?.[`${r}-${c}`];
        const targetRef = getColLetter(ref.col + c) + (ref.row + r + 1);
        const targetStyleKey = `${ref.row + r}-${ref.col + c}`;
        if (srcData) {
          newCells[targetRef] = { ...srcData };
        }
        if (srcStyle) {
          newStyles[targetStyleKey] = { ...srcStyle };
        }
      }
    }
    setCells(newCells);
    setCellStyles(newStyles);
    if (newNumRows !== numRows) setNumRows(newNumRows);
    if (newNumCols !== numCols) setNumCols(newNumCols);
    triggerSave(newCells, headers, newNumCols, newNumRows);
    setCellContextMenu(null);
  }

  function clearSelectionContents() {
    if (!selection) return;
    pushUndo();
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    const newCells = { ...cells };
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        delete newCells[getColLetter(c) + (r + 1)];
      }
    }
    setCells(newCells);
    triggerSave(newCells, headers, numCols, numRows);
    setCellContextMenu(null);
  }

  function insertRowAt(rowIndex) {
    pushUndo();
    // Shift all cells from rowIndex down by 1
    const newCells = {};
    Object.entries(cells).forEach(([key, val]) => {
      const parsed = parseCellRef(key);
      if (!parsed) return;
      if (parsed.row >= rowIndex) {
        newCells[getColLetter(parsed.col) + (parsed.row + 2)] = val;
      } else {
        newCells[key] = val;
      }
    });
    setCells(newCells);
    const newRows = numRows + 1;
    setNumRows(newRows);
    triggerSave(newCells, headers, numCols, newRows);
    setCellContextMenu(null);
  }

  function insertColAt(colIndex) {
    pushUndo();
    const newCells = {};
    const newHeaders = {};
    Object.entries(cells).forEach(([key, val]) => {
      const parsed = parseCellRef(key);
      if (!parsed) return;
      if (parsed.col >= colIndex) {
        newCells[getColLetter(parsed.col + 1) + (parsed.row + 1)] = val;
      } else {
        newCells[key] = val;
      }
    });
    Object.entries(headers).forEach(([idx, val]) => {
      const i = parseInt(idx);
      if (i >= colIndex) newHeaders[i + 1] = val;
      else newHeaders[i] = val;
    });
    setCells(newCells);
    setHeaders(newHeaders);
    const newCols = numCols + 1;
    setNumCols(newCols);
    triggerSave(newCells, newHeaders, newCols, numRows);
    setCellContextMenu(null);
  }

  function deleteRowAt(rowIndex) {
    if (numRows <= 1) return;
    pushUndo();
    const newCells = {};
    Object.entries(cells).forEach(([key, val]) => {
      const parsed = parseCellRef(key);
      if (!parsed) return;
      if (parsed.row === rowIndex) return; // skip deleted row
      if (parsed.row > rowIndex) {
        newCells[getColLetter(parsed.col) + parsed.row] = val; // shift up (row+1-1 = row)
      } else {
        newCells[key] = val;
      }
    });
    setCells(newCells);
    const newRows = numRows - 1;
    setNumRows(newRows);
    if (selectedCell) { const ref = parseCellRef(selectedCell); if (ref && ref.row >= newRows) { setSelectedCell(null); setEditingCell(null); } }
    triggerSave(newCells, headers, numCols, newRows);
    setCellContextMenu(null);
  }

  function deleteColAt(colIndex) {
    if (numCols <= 1) return;
    pushUndo();
    const newCells = {};
    const newHeaders = {};
    Object.entries(cells).forEach(([key, val]) => {
      const parsed = parseCellRef(key);
      if (!parsed) return;
      if (parsed.col === colIndex) return; // skip deleted col
      if (parsed.col > colIndex) {
        newCells[getColLetter(parsed.col - 1) + (parsed.row + 1)] = val;
      } else {
        newCells[key] = val;
      }
    });
    Object.entries(headers).forEach(([idx, val]) => {
      const i = parseInt(idx);
      if (i === colIndex) return;
      if (i > colIndex) newHeaders[i - 1] = val;
      else newHeaders[i] = val;
    });
    setCells(newCells);
    setHeaders(newHeaders);
    const newCols = numCols - 1;
    setNumCols(newCols);
    if (selectedCell) { const ref = parseCellRef(selectedCell); if (ref && ref.col >= newCols) { setSelectedCell(null); setEditingCell(null); } }
    triggerSave(newCells, newHeaders, newCols, numRows);
    setCellContextMenu(null);
  }

  function sortColumn(colIndex, ascending) {
    // Get all rows with data in this column
    const rowData = [];
    for (let r = 0; r < numRows; r++) {
      const ref = getColLetter(colIndex) + (r + 1);
      const cell = cells[ref];
      const val = cell ? (cell.formula ? evaluateFormula(cell.formula, cells) : parseFloat(cell.value) || cell.value || '') : '';
      rowData.push({ row: r, sortVal: val });
    }

    // Sort by numeric then alphabetic
    rowData.sort((a, b) => {
      const aNum = typeof a.sortVal === 'number' ? a.sortVal : parseFloat(a.sortVal);
      const bNum = typeof b.sortVal === 'number' ? b.sortVal : parseFloat(b.sortVal);
      if (!isNaN(aNum) && !isNaN(bNum)) return ascending ? aNum - bNum : bNum - aNum;
      const aStr = String(a.sortVal);
      const bStr = String(b.sortVal);
      return ascending ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });

    // Rearrange all columns based on new row order
    pushUndo();
    const newCells = {};
    rowData.forEach((item, newRow) => {
      for (let c = 0; c < numCols; c++) {
        const oldRef = getColLetter(c) + (item.row + 1);
        const newRef = getColLetter(c) + (newRow + 1);
        if (cells[oldRef]) newCells[newRef] = { ...cells[oldRef] };
      }
    });
    setCells(newCells);
    triggerSave(newCells, headers, numCols, numRows);
    setCellContextMenu(null);
  }

  // Select entire row (shift extends)
  function selectRow(ri, shiftKey) {
    if (readOnly) return;
    if (shiftKey && selection) {
      setSelection(prev => ({ startRow: prev.startRow, startCol: 0, endRow: ri, endCol: numCols - 1 }));
    } else {
      setSelection({ startRow: ri, startCol: 0, endRow: ri, endCol: numCols - 1 });
      const ref = getColLetter(0) + (ri + 1);
      setSelectedCell(ref);
    }
    setEditingCell(null);
  }

  // Select entire column (shift extends)
  function selectCol(ci, shiftKey) {
    if (readOnly) return;
    if (shiftKey && selection) {
      setSelection(prev => ({ startRow: 0, startCol: prev.startCol, endRow: numRows - 1, endCol: ci }));
    } else {
      setSelection({ startRow: 0, startCol: ci, endRow: numRows - 1, endCol: ci });
      const ref = getColLetter(ci) + '1';
      setSelectedCell(ref);
    }
    setEditingCell(null);
  }

  // Freeze/unfreeze
  function toggleFreezeRow() {
    if (!selection) return;
    pushUndo();
    const row = Math.max(selection.startRow, selection.endRow) + 1;
    const newFreeze = freezeRow === row ? 0 : row;
    setFreezeRow(newFreeze);
    triggerSave(cells, headers, numCols, numRows, undefined, undefined, undefined, undefined, newFreeze, undefined);
  }

  function toggleFreezeCol() {
    if (!selection) return;
    pushUndo();
    const col = Math.max(selection.startCol, selection.endCol) + 1;
    const newFreeze = freezeCol === col ? 0 : col;
    setFreezeCol(newFreeze);
    triggerSave(cells, headers, numCols, numRows, undefined, undefined, undefined, undefined, undefined, newFreeze);
  }

  function insertCalcFormula(calcId) {
    if (!selectedCell) return;
    const fn = CALC_FUNCTIONS.find(c => c.id === calcId);
    if (!fn) return;
    if (selection && (selection.startRow !== selection.endRow || selection.startCol !== selection.endCol)) {
      const startRef = getColLetter(Math.min(selection.startCol, selection.endCol)) + (Math.min(selection.startRow, selection.endRow) + 1);
      const endRef = getColLetter(Math.max(selection.startCol, selection.endCol)) + (Math.max(selection.startRow, selection.endRow) + 1);
      const formula = `=${fn.syntax}(${startRef}:${endRef})`;
      setFormulaValue(formula);
      setEditingCell(selectedCell);
    } else {
      setFormulaValue(`=${fn.syntax}(`);
      setEditingCell(selectedCell);
      setFormulaSelectMode(true);
      setTimeout(() => formulaInputRef.current?.focus(), 0);
    }
    setShowCalcMenu(false);
  }

  function getSelectionStats() {
    if (!selection) return null;
    const nums = [];
    const minR = Math.min(selection.startRow, selection.endRow);
    const maxR = Math.max(selection.startRow, selection.endRow);
    const minC = Math.min(selection.startCol, selection.endCol);
    const maxC = Math.max(selection.startCol, selection.endCol);
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const ref = getColLetter(c) + (r + 1);
        const cell = cells[ref];
        if (cell) {
          const val = cell.formula ? evaluateFormula(cell.formula, cells) : parseFloat(cell.value);
          if (typeof val === 'number' && !isNaN(val)) nums.push(val);
        }
      }
    }
    if (nums.length < 2) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return { sum: sum.toFixed(2), avg: (sum / nums.length).toFixed(2), count: nums.length };
  }

  const stats = getSelectionStats();
  const curStyle = getSelectionStyle();

  return (
    <div className={`spreadsheet-editor ${isFullscreen ? 'spreadsheet-editor--fullscreen' : ''}`}>
      {!readOnly && (
        <div className="spreadsheet-ribbon">
          {/* Row 1: Main ribbon */}
          <div className="ribbon-row">
            {/* Undo/Redo group */}
            <div className="ribbon-group">
              <button className="ribbon-btn ribbon-btn--labeled" onClick={handleUndo} disabled={undoStack.length === 0} title="ביטול (Ctrl+Z)"><Undo2 size={14} /><span className="ribbon-label">בטל</span></button>
              <button className="ribbon-btn ribbon-btn--labeled" onClick={handleRedo} disabled={redoStack.length === 0} title="חזרה (Ctrl+Y)"><Redo2 size={14} /><span className="ribbon-label">חזור</span></button>
            </div>
            <div className="ribbon-separator" />

            {/* Font group */}
            <div className="ribbon-group">
              <div className="ribbon-font-size">
                <button className="ribbon-btn ribbon-btn--sm" onClick={() => { const s = (curStyle.fontSize || fontSize) - 1; if (s >= 8) applyFontSize(s); }} title="הקטן גופן"><Minus size={10} /></button>
                <span className="ribbon-font-label">{curStyle.fontSize || fontSize}</span>
                <button className="ribbon-btn ribbon-btn--sm" onClick={() => { const s = (curStyle.fontSize || fontSize) + 1; if (s <= 36) applyFontSize(s); }} title="הגדל גופן"><Plus size={10} /></button>
              </div>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.bold ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('bold', 'toggle')} title="מודגש (B)"><Bold size={14} /><span className="ribbon-label">מודגש</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.italic ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('italic', 'toggle')} title="נטוי (I)"><Italic size={14} /><span className="ribbon-label">נטוי</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.underline ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('underline', 'toggle')} title="קו תחתון (U)"><Underline size={14} /><span className="ribbon-label">קו תחתון</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.strikethrough ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('strikethrough', 'toggle')} title="קו חוצה"><Strikethrough size={14} /><span className="ribbon-label">חוצה</span></button>
            </div>
            <div className="ribbon-separator" />

            {/* Colors group */}
            <div className="ribbon-group">
              <div style={{ position: 'relative' }}>
                <button className="ribbon-btn ribbon-btn--color ribbon-btn--labeled" onClick={() => { setShowCellColorPicker(!showCellColorPicker); setShowCalcMenu(false); setShowTextColorPicker(false); }} title="צבע רקע">
                  <Paintbrush size={14} />
                  <span className="ribbon-label">רקע</span>
                  <span className="ribbon-color-indicator" style={{ background: curStyle.bg || '#fff' }} />
                </button>
                {showCellColorPicker && (
                  <div className="color-picker-popup">
                    {CELL_COLORS.map(c => (
                      <button key={c} className="color-swatch-btn" style={{ background: c }} onClick={() => applyCellColor(c)} />
                    ))}
                  </div>
                )}
              </div>
              <div style={{ position: 'relative' }}>
                <button className="ribbon-btn ribbon-btn--color ribbon-btn--labeled" onClick={() => { setShowTextColorPicker(!showTextColorPicker); setShowCalcMenu(false); setShowCellColorPicker(false); }} title="צבע טקסט">
                  <Type size={14} />
                  <span className="ribbon-label">טקסט</span>
                  <span className="ribbon-color-indicator" style={{ background: curStyle.color || '#1e293b' }} />
                </button>
                {showTextColorPicker && (
                  <div className="color-picker-popup">
                    {TEXT_COLORS.map(c => (
                      <button key={c} className="color-swatch-btn" style={{ background: c }} onClick={() => applyTextColor(c)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="ribbon-separator" />

            {/* Alignment group */}
            <div className="ribbon-group">
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.textAlign === 'right' || !curStyle.textAlign ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('textAlign', 'right')} title="ימין"><AlignRight size={14} /><span className="ribbon-label">ימין</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.textAlign === 'center' ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('textAlign', 'center')} title="מרכז"><AlignCenter size={14} /><span className="ribbon-label">מרכז</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.textAlign === 'left' ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('textAlign', 'left')} title="שמאל"><AlignLeft size={14} /><span className="ribbon-label">שמאל</span></button>
              <div className="ribbon-group-break" />
              <button className={`ribbon-btn ribbon-btn--labeled${!curStyle.verticalAlign || curStyle.verticalAlign === 'middle' ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('verticalAlign', 'middle')} title="אמצע אנכי"><AlignVerticalJustifyCenter size={14} /><span className="ribbon-label">אמצע</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.verticalAlign === 'top' ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('verticalAlign', 'top')} title="למעלה"><AlignVerticalJustifyStart size={14} /><span className="ribbon-label">למעלה</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.verticalAlign === 'bottom' ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('verticalAlign', 'bottom')} title="למטה"><AlignVerticalJustifyEnd size={14} /><span className="ribbon-label">למטה</span></button>
              <div className="ribbon-group-break" />
              <button className={`ribbon-btn ribbon-btn--labeled${curStyle.wrapText ? ' ribbon-btn--active' : ''}`} onClick={() => applyStyleProp('wrapText', 'toggle')} title="גלישת טקסט"><WrapText size={14} /><span className="ribbon-label">גלישה</span></button>
            </div>
            <div className="ribbon-separator" />

            {/* Structure group */}
            <div className="ribbon-group">
              <button className="ribbon-btn" onClick={addColumn} title="הוסף עמודה"><Plus size={12} /><span className="ribbon-label">עמודה</span></button>
              <button className="ribbon-btn" onClick={addRow} title="הוסף שורה"><Plus size={12} /><span className="ribbon-label">שורה</span></button>
              <button className="ribbon-btn ribbon-btn--danger" onClick={removeColumn} disabled={numCols <= 1} title="הסר עמודה"><Minus size={12} /><span className="ribbon-label">עמודה</span></button>
              <button className="ribbon-btn ribbon-btn--danger" onClick={removeRow} disabled={numRows <= 1} title="הסר שורה"><Minus size={12} /><span className="ribbon-label">שורה</span></button>
            </div>
            <div className="ribbon-separator" />

            {/* Merge & Freeze group */}
            <div className="ribbon-group">
              <button className="ribbon-btn ribbon-btn--labeled" onClick={handleMergeCells} disabled={!selection} title="מזג/בטל מיזוג"><Merge size={14} /><span className="ribbon-label">מזג</span></button>
              <button className={`ribbon-btn ribbon-btn--labeled${freezeRow ? ' ribbon-btn--active' : ''}`} onClick={toggleFreezeRow} disabled={!selection} title={freezeRow ? 'שחרר שורות' : 'הקפא שורות'}>
                {freezeRow ? <Unlock size={14} /> : <Lock size={14} />}<span className="ribbon-label">{freezeRow ? 'שחרר ש' : 'הקפא ש'}</span>
              </button>
              <button className={`ribbon-btn ribbon-btn--labeled${freezeCol ? ' ribbon-btn--active' : ''}`} onClick={toggleFreezeCol} disabled={!selection} title={freezeCol ? 'שחרר עמודות' : 'הקפא עמודות'}>
                {freezeCol ? <Unlock size={14} /> : <Lock size={14} />}<span className="ribbon-label">{freezeCol ? 'שחרר ע' : 'הקפא ע'}</span>
              </button>
            </div>
            <div className="ribbon-separator" />

            {/* Calc group */}
            <div className="ribbon-group">
              <div style={{ position: 'relative' }}>
                <button className="ribbon-btn ribbon-btn--labeled" onClick={() => { setShowCalcMenu(!showCalcMenu); setShowCellColorPicker(false); setShowTextColorPicker(false); }} title="חישובים">
                  <Calculator size={14} /><span className="ribbon-label">חישוב</span>
                </button>
                {showCalcMenu && (
                  <div className="calc-menu">
                    {CALC_FUNCTIONS.map(fn => (
                      <button key={fn.id} className="calc-menu-item" onClick={() => insertCalcFormula(fn.id)}>
                        <span className="calc-menu-icon">{fn.icon}</span>
                        <span>{fn.label}</span>
                        <span className="calc-menu-syntax">{fn.syntax}()</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="ribbon-separator" />

            {/* Zoom */}
            <div className="ribbon-group">
              <div className="toolbar-zoom-group">
                <button className="ribbon-btn ribbon-btn--sm" onClick={() => setZoomLevel(z => Math.max(50, z - 10))} title="הקטן"><ZoomOut size={12} /></button>
                <input type="range" min="50" max="200" step="10" value={zoomLevel} onChange={e => setZoomLevel(Number(e.target.value))} className="toolbar-zoom-slider" title={`${zoomLevel}%`} />
                <button className="ribbon-btn ribbon-btn--sm" onClick={() => setZoomLevel(z => Math.min(200, z + 10))} title="הגדל"><ZoomIn size={12} /></button>
                <span className="toolbar-zoom-label" onClick={() => setZoomLevel(100)}>{zoomLevel}%</span>
              </div>
            </div>

            {onToggleFullscreen && (
              <>
                <div className="ribbon-separator" />
                <button className="ribbon-btn" onClick={onToggleFullscreen} title={isFullscreen ? 'יציאה ממסך מלא' : 'מסך מלא'}>
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Formula Bar */}
      <div className="formula-bar">
        <span className="cell-ref">{selectedCell || '-'}</span>
        <FunctionSquare size={14} className="formula-icon" />
        <input
          ref={formulaInputRef}
          className={`formula-input ${formulaSelectMode ? 'formula-input--selecting' : ''}`}
          value={formulaValue}
          onChange={handleFormulaBarChange}
          onKeyDown={handleFormulaBarKeyDown}
          onFocus={handleFormulaBarFocus}
          onBlur={() => {
            if (selectedCell && editingCell && !formulaSelectMode) {
              commitCell(selectedCell, formulaValue);
            }
          }}
          placeholder="נוסחה או ערך... (=SUM, =AVERAGE, =MEDIAN...)"
          disabled={readOnly || !selectedCell}
          dir="ltr"
        />
        {formulaSelectMode && (
          <button className="formula-confirm-btn" onClick={() => { if (selectedCell) commitCell(selectedCell, formulaValue); }}>
            ✓
          </button>
        )}
      </div>

      {/* Spreadsheet Grid */}
      <div className="spreadsheet-container" dir="rtl" style={{ zoom: zoomLevel / 100 }}>
        <table className="spreadsheet-table" ref={tableRef} style={{ fontSize: `${fontSize}px` }}>
          <thead>
            <tr>
              <th className="corner-header">#</th>
              {Array.from({ length: numCols }, (_, ci) => (
                <th
                  key={ci}
                  className={`col-header${ci < freezeCol ? ' col-header--frozen' : ''}${ci === freezeCol - 1 ? ' col-header--freeze-border' : ''}`}
                  style={{ width: columnWidths[ci] || 100 }}
                  onContextMenu={(e) => handleCellContextMenu(e, -1, ci, 'col')}
                  onClick={(e) => selectCol(ci, e.shiftKey)}
                >
                  <span className="col-letter">{getColLetter(ci)}</span>
                  <input value={headers[ci] || ''} onChange={(e) => handleHeaderChange(ci, e.target.value)} placeholder={getColLetter(ci)} disabled={readOnly} onClick={e => e.stopPropagation()} />
                  <div className="col-resize-handle" onMouseDown={(e) => handleColumnResize(ci, e)} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: numRows }, (_, ri) => {
              // Calculate sticky top for frozen rows
              let stickyTop = undefined;
              if (ri < freezeRow) {
                stickyTop = 0;
                for (let r = 0; r < ri; r++) stickyTop += (rowHeights[r] || 32);
                // Add header height (~40px)
                stickyTop += 40;
              }
              return (
              <tr key={ri} style={{ height: rowHeights[ri] || 32, ...(ri < freezeRow ? { position: 'sticky', top: stickyTop, zIndex: 4 } : {}) }} className={ri < freezeRow ? 'row--frozen' : ''}>
                <td
                  className={`row-header${ri === freezeRow - 1 ? ' row-header--freeze-border' : ''}`}
                  style={{ position: 'sticky', right: 0 }}
                  onContextMenu={(e) => handleCellContextMenu(e, ri, -1, 'row')}
                  onClick={(e) => selectRow(ri, e.shiftKey)}
                >
                  {ri + 1}
                  <div className="row-resize-handle" onMouseDown={(e) => handleRowResize(ri, e)} />
                </td>
                {Array.from({ length: numCols }, (_, ci) => {
                  // Skip merged cells that aren't the origin
                  if (isMergedButNotOrigin(ri, ci)) return null;

                  const merge = getMergeForCell(ri, ci);
                  const colSpan = merge ? (merge.endCol - merge.startCol + 1) : 1;
                  const rowSpan = merge ? (merge.endRow - merge.startRow + 1) : 1;

                  const cellRefStr = getColLetter(ci) + (ri + 1);
                  const isSelected = selectedCell === cellRefStr;
                  const isEditing = editingCell === cellRefStr;
                  const cell = cells[cellRefStr];
                  const displayVal = getDisplayValue(cell, cells);
                  const isFormula = !!cell?.formula;
                  const isError = displayVal === '#ERR' || displayVal === '#CIRC' || displayVal === '#DIV/0';
                  const inSelection = selection && ri >= Math.min(selection.startRow, selection.endRow) &&
                    ri <= Math.max(selection.startRow, selection.endRow) &&
                    ci >= Math.min(selection.startCol, selection.endCol) &&
                    ci <= Math.max(selection.startCol, selection.endCol);

                  const style = cellStyles[`${ri}-${ci}`] || {};

                  return (
                    <td
                      key={ci}
                      className={`cell${isSelected ? ' cell--selected' : ''}${inSelection && !isSelected ? ' cell--in-selection' : ''}${ri < freezeRow ? ' cell--freeze-row' : ''}${ci < freezeCol ? ' cell--freeze-col' : ''}${ri === freezeRow - 1 ? ' cell--freeze-row-border' : ''}${ci === freezeCol - 1 ? ' cell--freeze-col-border' : ''}`}
                      data-ref={cellRefStr}
                      colSpan={colSpan > 1 ? colSpan : undefined}
                      rowSpan={rowSpan > 1 ? rowSpan : undefined}
                      onClick={(e) => handleCellClick(cellRefStr, ri, ci, e)}
                      onDoubleClick={() => handleCellDoubleClick(cellRefStr)}
                      onKeyDown={(e) => handleCellKeyDown(e, cellRefStr)}
                      onMouseDown={(e) => handleCellMouseDown(ri, ci, e)}
                      onMouseEnter={() => handleCellMouseEnter(ri, ci)}
                      onContextMenu={(e) => handleCellContextMenu(e, ri, ci, 'cell')}
                      tabIndex={isSelected ? 0 : -1}
                      style={{
                        width: columnWidths[ci] || 100,
                        height: rowHeights[ri] || 32,
                      }}
                      data-bg={style.bg || undefined}
                    >
                      {isEditing ? (
                        <input
                          ref={cellInputRef}
                          className="cell-input"
                          value={formulaValue}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormulaValue(val);
                            if (val.startsWith('=')) {
                              const openP = (val.match(/\(/g) || []).length;
                              const closeP = (val.match(/\)/g) || []).length;
                              setFormulaSelectMode(openP > closeP || val.length > 1);
                            } else {
                              setFormulaSelectMode(false);
                            }
                          }}
                          onKeyDown={(e) => handleCellKeyDown(e, cellRefStr)}
                          onBlur={() => { if (!formulaSelectMode) commitCell(cellRefStr, formulaValue); }}
                          autoFocus
                          dir="ltr"
                        />
                      ) : (
                        <div
                          className={`cell-display${isFormula ? ' cell-display--formula' : ''}${isError ? ' cell-display--error' : ''}`}
                          style={{
                            background: style.bg || undefined,
                            color: style.color || undefined,
                            fontWeight: style.bold ? 700 : undefined,
                            fontStyle: style.italic ? 'italic' : undefined,
                            textDecoration: [style.underline && 'underline', style.strikethrough && 'line-through'].filter(Boolean).join(' ') || undefined,
                            textAlign: style.textAlign || undefined,
                            justifyContent: style.textAlign === 'center' ? 'center' : style.textAlign === 'left' ? 'flex-end' : undefined,
                            alignItems: style.verticalAlign === 'top' ? 'flex-start' : style.verticalAlign === 'bottom' ? 'flex-end' : undefined,
                            fontSize: style.fontSize ? `${style.fontSize}px` : undefined,
                            flexWrap: style.wrapText ? 'wrap' : undefined,
                            whiteSpace: style.wrapText ? 'pre-wrap' : undefined,
                          }}
                        >
                          {displayVal}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cell Context Menu */}
      {cellContextMenu && !readOnly && (
        <div className="context-menu" style={{ top: cellContextMenu.y, left: cellContextMenu.x }} onClick={e => e.stopPropagation()}>
          {cellContextMenu.type === 'cell' && (
            <>
              <button className="context-menu-item" onClick={cutSelection}>
                <Scissors size={14} /> גזירה
              </button>
              <button className="context-menu-item" onClick={copySelection}>
                <Copy size={14} /> העתקה
              </button>
              <button className="context-menu-item" onClick={pasteClipboard} disabled={!clipboard}>
                <ClipboardPaste size={14} /> הדבקה
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={() => { insertRowAt(cellContextMenu.row); }}>
                <PlusCircle size={14} /> הוסף שורה
              </button>
              <button className="context-menu-item" onClick={() => { insertColAt(cellContextMenu.col); }}>
                <PlusCircle size={14} /> הוסף עמודה
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item context-menu-item--danger" onClick={() => { deleteRowAt(cellContextMenu.row); }}>
                <MinusCircle size={14} /> מחק שורה
              </button>
              <button className="context-menu-item context-menu-item--danger" onClick={() => { deleteColAt(cellContextMenu.col); }}>
                <MinusCircle size={14} /> מחק עמודה
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={clearSelectionContents}>
                <Trash2 size={14} /> נקה תוכן
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={() => sortColumn(cellContextMenu.col, true)}>
                <ArrowUpDown size={14} /> מיון עולה
              </button>
              <button className="context-menu-item" onClick={() => sortColumn(cellContextMenu.col, false)}>
                <ArrowDownUp size={14} /> מיון יורד
              </button>
            </>
          )}

          {cellContextMenu.type === 'row' && (
            <>
              <button className="context-menu-item" onClick={() => { insertRowAt(cellContextMenu.row); }}>
                <PlusCircle size={14} /> הוסף שורה למעלה
              </button>
              <button className="context-menu-item" onClick={() => { insertRowAt(cellContextMenu.row + 1); }}>
                <PlusCircle size={14} /> הוסף שורה למטה
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item context-menu-item--danger" onClick={() => { deleteRowAt(cellContextMenu.row); }}>
                <MinusCircle size={14} /> מחק שורה {cellContextMenu.row + 1}
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={() => {
                pushUndo();
                const newCells = { ...cells };
                for (let c = 0; c < numCols; c++) delete newCells[getColLetter(c) + (cellContextMenu.row + 1)];
                setCells(newCells);
                triggerSave(newCells, headers, numCols, numRows);
                setCellContextMenu(null);
              }}>
                <Trash2 size={14} /> נקה שורה
              </button>
            </>
          )}

          {cellContextMenu.type === 'col' && (
            <>
              <button className="context-menu-item" onClick={() => { insertColAt(cellContextMenu.col); }}>
                <PlusCircle size={14} /> הוסף עמודה לפני
              </button>
              <button className="context-menu-item" onClick={() => { insertColAt(cellContextMenu.col + 1); }}>
                <PlusCircle size={14} /> הוסף עמודה אחרי
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item context-menu-item--danger" onClick={() => { deleteColAt(cellContextMenu.col); }}>
                <MinusCircle size={14} /> מחק עמודה {getColLetter(cellContextMenu.col)}
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={() => {
                pushUndo();
                const newCells = { ...cells };
                for (let r = 0; r < numRows; r++) delete newCells[getColLetter(cellContextMenu.col) + (r + 1)];
                setCells(newCells);
                triggerSave(newCells, headers, numCols, numRows);
                setCellContextMenu(null);
              }}>
                <Trash2 size={14} /> נקה עמודה
              </button>
              <div className="context-menu-divider" />
              <button className="context-menu-item" onClick={() => sortColumn(cellContextMenu.col, true)}>
                <ArrowUpDown size={14} /> מיון עולה
              </button>
              <button className="context-menu-item" onClick={() => sortColumn(cellContextMenu.col, false)}>
                <ArrowDownUp size={14} /> מיון יורד
              </button>
            </>
          )}
        </div>
      )}

      {/* Status Bar */}
      <div className="spreadsheet-status">
        <div className="autosave-indicator">
          <span className={`autosave-dot${saveStatus === 'pending' ? ' autosave-dot--pending' : ''}`} />
          <span>{saveStatus === 'pending' ? 'שומר...' : 'נשמר'}</span>
        </div>
        {stats && (
          <div className="selection-stats">
            <span>סכום: {stats.sum}</span>
            <span>ממוצע: {stats.avg}</span>
            <span>ספירה: {stats.count}</span>
          </div>
        )}
        <span>{numCols} x {numRows}</span>
      </div>
    </div>
  );
}
