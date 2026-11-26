// In-cell spreadsheet editing. The grid is RTL, so "right" is the previous column index.

const HEBREW = /[\u0590-\u05FF]/u;

export function editDir(value) {
  const text = String(value || '');
  if (text.startsWith('=')) return 'ltr';
  return HEBREW.test(text) ? 'rtl' : 'auto';
}

export function blurShouldCommit(relatedTarget) {
  if (!relatedTarget || typeof relatedTarget.closest !== 'function') return true;
  return !relatedTarget.closest('.spreadsheet-edit-surface');
}

export function nextAfterEdit({ row, col, rows, cols, key, shift = false }) {
  if (key === 'Tab') {
    const nextCol = shift ? col + 1 : col - 1;
    if (nextCol < 0 || nextCol >= cols) return null;
    return { kind: 'cell', row, col: nextCol };
  }
  if (key === 'Enter') {
    const nextRow = shift ? row - 1 : row + 1;
    if (nextRow < 0 || nextRow >= rows) return null;
    return { kind: 'cell', row: nextRow, col };
  }
  return null;
}

export function nextAfterHeader({ col, cols, rows, key, shift = false }) {
  if (key === 'Tab') {
    const nextCol = shift ? col + 1 : col - 1;
    if (nextCol < 0 || nextCol >= cols) return null;
    return { kind: 'header', col: nextCol };
  }
  if (key === 'Enter' && !shift && rows > 0) return { kind: 'cell', row: 0, col };
  return null;
}

export function placeCaret(node) {
  if (!node || typeof node.focus !== 'function') return;
  node.focus();
  const end = String(node.value || '').length;
  if (typeof node.setSelectionRange === 'function') node.setSelectionRange(end, end);
}
