import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ContextMenu.css';

// One right-click menu for the whole app. A screen only describes WHAT can be done
// with an item; this component handles position, keyboard and closing.
//
//   const { menuProps } = useContextMenu();
//   <li {...menuProps(() => [
//     { label: 'עריכה', icon: Pencil, onClick: edit },
//     { separator: true },
//     { label: 'מחיקה', icon: Trash2, danger: true, onClick: remove },
//   ])}>
//
// menuProps also wires the keyboard menu key / Shift+F10, so it works without a mouse.
const ContextMenuContext = createContext(null);

export function useContextMenu() {
  const context = useContext(ContextMenuContext);
  return context || { open: () => {}, menuProps: () => ({}) };
}

export function ContextMenuProvider({ children }) {
  const [menu, setMenu] = useState(null);
  const close = useCallback(() => setMenu(null), []);

  const open = useCallback((point, items) => {
    const usable = (items || []).filter(item => item && (item.separator || item.label));
    if (!usable.some(item => !item.separator)) return;
    setMenu({ x: point.x, y: point.y, items: usable });
  }, []);

  const menuProps = useCallback(getItems => ({
    onContextMenu: event => {
      // Text fields keep the browser's own menu (copy / paste).
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      open({ x: event.clientX, y: event.clientY }, getItems());
    },
    onPointerDown: event => {
      if (event.pointerType === 'mouse') return;
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const point = { x: event.clientX, y: event.clientY };
      const timer = window.setTimeout(() => open(point, getItems()), 480);
      const stop = () => window.clearTimeout(timer);
      event.currentTarget.addEventListener('pointerup', stop, { once: true });
      event.currentTarget.addEventListener('pointercancel', stop, { once: true });
      event.currentTarget.addEventListener('pointerleave', stop, { once: true });
    },
    onKeyDown: event => {
      if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        open({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, getItems());
      }
    },
  }), [open]);

  const value = useMemo(() => ({ open, close, menuProps }), [open, close, menuProps]);
  return <ContextMenuContext.Provider value={value}>
    {children}
    {menu && <MenuView menu={menu} onClose={close} />}
  </ContextMenuContext.Provider>;
}

function MenuView({ menu, onClose }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  const [active, setActive] = useState(0);
  const actionable = menu.items.map((item, index) => (item.separator || item.disabled ? -1 : index)).filter(index => index >= 0);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const edge = 8;
    setPosition({
      left: Math.max(edge, Math.min(menu.x, window.innerWidth - box.width - edge)),
      top: Math.max(edge, Math.min(menu.y, window.innerHeight - box.height - edge)),
    });
    ref.current.querySelector('[role=menuitem]:not([disabled])')?.focus();
  }, [menu]);

  useEffect(() => {
    const outside = event => { if (!ref.current?.contains(event.target)) onClose(); };
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key === 'Tab') { onClose(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const at = actionable.indexOf(active);
        const next = actionable[(at + (event.key === 'ArrowDown' ? 1 : actionable.length - 1)) % actionable.length];
        setActive(next);
        ref.current?.querySelectorAll('[role=menuitem]')[actionable.indexOf(next)]?.focus();
      }
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [active, actionable, onClose]);

  return createPortal(
    <ul ref={ref} className="app-context-menu" role="menu" dir="rtl" style={position} onContextMenu={event => event.preventDefault()}>
      {menu.items.map((item, index) => item.separator
        ? <li key={`s${index}`} role="separator" />
        : <li key={item.label} role="none">
          <button type="button" role="menuitem" disabled={item.disabled} className={item.danger ? 'is-danger' : ''}
            onClick={() => { onClose(); item.onClick?.(); }}>
            {item.icon && <item.icon size={16} aria-hidden="true" />}<span>{item.label}</span>
          </button>
        </li>)}
    </ul>,
    document.body,
  );
}
