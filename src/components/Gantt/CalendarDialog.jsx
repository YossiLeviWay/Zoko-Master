import { useEffect, useRef } from 'react';
export default function CalendarDialog({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} className="calendar-dialog" dir="rtl" onCancel={onClose} onClick={event => { if(event.target === ref.current) onClose(); }}><section><header><h2>{title}</h2><button className="btn btn-secondary" onClick={onClose}>סגירה</button></header>{children}</section></dialog>;
}
