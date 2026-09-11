export function anchoredMenuPosition(anchor, width, height, viewport) {
  const edge = 8, gap = 6;
  const menuWidth = Math.min(width, viewport.width - edge * 2);
  const below = viewport.height - anchor.bottom - gap - edge;
  const above = anchor.top - gap - edge;
  const useBelow = below >= height || below >= above;
  const maxHeight = Math.max(0, useBelow ? below : above);
  return { left: Math.max(edge, Math.min(anchor.right - menuWidth, viewport.width - menuWidth - edge)), top: useBelow ? anchor.bottom + gap : Math.max(edge, anchor.top - gap - Math.min(height, maxHeight)), width: menuWidth, maxHeight };
}
