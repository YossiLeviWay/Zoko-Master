import { useEffect, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';

export default function EventBank({ templates, onSave, onUse, onClose, busy, canManage = true, touchHandle }) {
  const [draft, setDraft] = useState(null);
  const [search, setSearch] = useState('');
  const closeButton = useRef(null);
  useEffect(() => { closeButton.current?.focus({ preventScroll: true }); }, []);

  async function save(event) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    const updated = { ...draft, title: draft.title.trim() };
    const next = templates.some(item => item.id === draft.id)
      ? templates.map(item => item.id === draft.id ? updated : item)
      : [...templates, updated];
    if (await onSave(next)) setDraft(null);
  }

  return <aside className="event-bank" aria-label="בנק אירועים" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); if (draft) setDraft(null); else onClose(); }
  }}>
    <header><h2>בנק אירועים</h2><button ref={closeButton} type="button" onClick={onClose} aria-label="סגירת בנק אירועים"><X size={18}/></button></header>
    <p>גררו תבנית ליום בלוח, או לחצו להוספה.</p>
    {draft ? <form className="event-bank-editor" onSubmit={save}>
      <label>שם האירוע<input required maxLength={180} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
      <label>תיאור<textarea maxLength={3000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></label>
      <small>השינוי יחול על התבנית בלבד.</small>
      <div><button className="btn btn-primary" disabled={busy}>שמירת תבנית</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDraft(null)}>ביטול</button></div>
    </form> : <>
      <input className="event-bank-search" aria-label="חיפוש תבנית" placeholder="חיפוש תבנית…" value={search} onChange={event => setSearch(event.target.value)}/>
      <div className="event-bank-items">{templates.filter(item => item.title.includes(search.trim())).map(item => <article key={item.id} draggable={!busy} onDragStart={event => {
        event.dataTransfer.setData('application/x-zoko-calendar', JSON.stringify({ templateId: item.id }));
        event.dataTransfer.effectAllowed = 'copy';
      }}>
        <button className="calendar-touch-grip" type="button" aria-label={`גרירת ${item.title}`} {...touchHandle({ templateId: item.id })}><GripVertical size={16}/></button>
        <button className="event-bank-use" disabled={busy} onClick={() => onUse(item)} title="הוספה ללוח">{item.title}<span>הוספה ללוח</span></button>
        {canManage && <button className="event-bank-edit" disabled={busy} onClick={() => setDraft({ ...item })} aria-label={`עריכת תבנית ${item.title}`}>עריכה</button>}
      </article>)}</div>
      {canManage && <button className="btn btn-secondary event-bank-new" disabled={busy} onClick={() => setDraft({ id: crypto.randomUUID(), title: '', description: '', color: '#f4512c' })}>+ תבנית חדשה</button>}
    </>}
  </aside>;
}
