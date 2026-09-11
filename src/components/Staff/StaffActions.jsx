import { useEffect, useId, useRef } from 'react';
import { anchoredMenuPosition } from '../../utils/anchoredMenu';
import { ChevronDown, X } from 'lucide-react';

export default function StaffActions({ name, actions }) {
  const dialog = useRef(null);
  const id = useId();
  const trigger = useRef(null);
  function openMenu() {
    const menu = dialog.current;
    if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
    menu.style.maxHeight = 'none';
    menu.showPopover();
    const position = anchoredMenuPosition(trigger.current.getBoundingClientRect(), 320, menu.scrollHeight, { width: window.innerWidth, height: window.innerHeight });
    Object.assign(menu.style, Object.fromEntries(Object.entries(position).map(([key, value]) => [key, `${value}px`])));
    menu.querySelector('button')?.focus();
  }
  useEffect(() => {
    const close = () => { if (dialog.current?.matches(':popover-open')) dialog.current.hidePopover(); };
    const onScroll = event => { if (!dialog.current?.contains(event.target)) close(); };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, true); };
  }, []);
  return <>
    <button className="staff-actions-trigger" ref={trigger} onClick={openMenu} aria-haspopup="dialog" aria-controls={id} aria-label={`ניהול ${name}`}>
      ניהול <ChevronDown size={15} />
    </button>
    <div popover="auto" role="dialog" ref={dialog} id={id} className="staff-actions-dialog" aria-label={`ניהול ${name}`}>
      <header><div><small>איש צוות</small><h3>{name}</h3></div><button aria-label="סגירת פעולות" onClick={() => dialog.current.hidePopover()}><X size={18} /></button></header>
      <div className="staff-actions-list">{actions.map(({ id: actionId, label, icon: Icon, onSelect, danger, disabled }) => <button key={actionId} disabled={disabled} className={danger ? 'is-danger' : ''} onClick={() => { dialog.current.hidePopover(); onSelect(); }}><Icon size={18} /><span>{label}</span></button>)}</div>
    </div>
  </>;
}

export function StaffChangeDialog({ children, busy, onCancel, label }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="modal-content staff-change-dialog staff-native-dialog" aria-label={label} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>{children}</dialog>;
}
