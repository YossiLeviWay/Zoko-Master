import { useEffect, useId, useRef } from 'react';
import { ChevronDown, X } from 'lucide-react';

export default function StaffActions({ name, actions }) {
  const dialog = useRef(null);
  const id = useId();
  return <>
    <button className="staff-actions-trigger" onClick={() => dialog.current.showModal()} aria-haspopup="dialog" aria-controls={id} aria-label={`ניהול ${name}`}>
      ניהול <ChevronDown size={15} />
    </button>
    <dialog ref={dialog} id={id} className="staff-actions-dialog" aria-label={`ניהול ${name}`} onClick={event => { if (event.target === dialog.current) dialog.current.close(); }}>
      <header><div><small>איש צוות</small><h3>{name}</h3></div><button aria-label="סגירת פעולות" onClick={() => dialog.current.close()}><X size={18} /></button></header>
      <div className="staff-actions-list">{actions.map(({ id: actionId, label, icon: Icon, onSelect, danger, disabled }) => <button key={actionId} disabled={disabled} className={danger ? 'is-danger' : ''} onClick={() => { dialog.current.close(); onSelect(); }}><Icon size={18} /><span>{label}</span></button>)}</div>
    </dialog>
  </>;
}

export function StaffChangeDialog({ children, busy, onCancel, label }) {
  const dialog = useRef(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  return <dialog ref={dialog} className="modal-content staff-change-dialog staff-native-dialog" aria-label={label} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>{children}</dialog>;
}
