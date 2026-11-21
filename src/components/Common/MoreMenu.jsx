import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import './MoreMenu.css';

// One "more" button that holds secondary actions, so a toolbar shows only what people use every day.
// items: [{ label, icon, onClick }] — falsy entries are skipped; renders nothing when empty.
export default function MoreMenu({ items = [], label = 'עוד' }) {
  const list = items.filter(Boolean);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  if (!list.length) return null;
  return <div className="more-menu" ref={ref}>
    <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal size={16} /> {label}</button>
    {open && <ul role="menu" className="more-menu-list">
      {list.map(item => <li key={item.label} role="none"><button type="button" role="menuitem" onClick={() => { setOpen(false); item.onClick(); }}>{item.icon && <item.icon size={16} aria-hidden="true" />}<span>{item.label}</span></button></li>)}
    </ul>}
  </div>;
}
