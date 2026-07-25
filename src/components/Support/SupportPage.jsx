import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import { LifeBuoy, Paperclip } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { db, storage } from '../../firebase';
import { createSupportTicket } from '../../services/adminUserService';
import Header from '../Layout/Header';
import '../Gantt/Gantt.css';

export default function SupportPage() {
  const { currentUser, userData, selectedSchool } = useAuth();
  const schoolId = selectedSchool || userData?.schoolId;
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', issueType: 'technical', urgency: 'normal' });
  const [attachment, setAttachment] = useState(null);
  const [sensitiveConfirmed, setSensitiveConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!schoolId) return undefined;
    return onSnapshot(query(collection(db, 'supportTickets'), where('schoolId', '==', schoolId), orderBy('createdAt', 'desc')), snapshot => setTickets(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))), () => setTickets([]));
  }, [schoolId]);

  async function uploadAttachment() {
    if (!attachment) return [];
    if (!sensitiveConfirmed || attachment.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(attachment.type)) throw new Error('unsafe');
    const id = `${currentUser.uid}_${Date.now()}`;
    const safeName = attachment.name.replace(/[^\p{L}\p{N}._-]/gu, '_');
    const storagePath = `platform-support/${schoolId}/${id}/${safeName}`;
    await setDoc(doc(db, 'supportAttachments', id), { schoolId, uploadedBy: currentUser.uid, status: 'pending', storagePath, mimeType: attachment.type, size: attachment.size, createdAt: serverTimestamp() });
    await uploadBytes(ref(storage, storagePath), attachment, { contentType: attachment.type });
    await setDoc(doc(db, 'supportAttachments', id), { status: 'uploaded', uploadedAt: serverTimestamp() }, { merge: true });
    return [id];
  }

  async function submit(event) {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try {
      const attachmentIds = await uploadAttachment();
      await createSupportTicket({ schoolId, ...form, attachmentIds, technicalContext: { appVersion: document.documentElement.dataset.appVersion || '', route: window.location.hash, browser: navigator.userAgent.slice(0, 180) } });
      setForm({ title: '', description: '', issueType: 'technical', urgency: 'normal' }); setAttachment(null); setSensitiveConfirmed(false); setMessage('הפנייה נשלחה לתמיכת המערכת.');
    } catch { setError('לא ניתן לשלוח את הפנייה. ודאו שאין בצילום מידע רגיש ושהקובץ תקין.'); }
    finally { setSaving(false); }
  }

  return <div className="page"><Header title="תמיכת המערכת" /><div className="page-content"><div className="card" style={{ padding: '1rem' }}><h3><LifeBuoy size={18} /> פתיחת פנייה</h3><p className="form-hint">הפנייה נפרדת מהודעות המוסד. התמיכה אינה מקבלת גישה לשיחות, קבצים או מידע פנימי שלא צירפתם במפורש.</p>{message && <div className="students-feedback students-feedback--success">{message}</div>}{error && <div className="students-feedback students-feedback--error">{error}</div>}<form className="modal-form" onSubmit={submit}><label className="form-group">כותרת<input value={form.title} onChange={event => setForm(previous => ({ ...previous, title: event.target.value }))} required /></label><label className="form-group">תיאור<textarea rows="6" value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} required minLength="10" /></label><div className="student-form-grid"><label className="form-group">סוג<select value={form.issueType} onChange={event => setForm(previous => ({ ...previous, issueType: event.target.value }))}><option value="technical">טכני</option><option value="permissions">הרשאות</option><option value="security">אבטחה</option><option value="billing">חיוב</option><option value="other">אחר</option></select></label><label className="form-group">דחיפות<select value={form.urgency} onChange={event => setForm(previous => ({ ...previous, urgency: event.target.value }))}><option value="low">נמוכה</option><option value="normal">רגילה</option><option value="high">גבוהה</option><option value="critical">קריטית</option></select></label></div><label className="btn btn-secondary"><Paperclip size={14} /> צילום מסך או PDF<input hidden type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setAttachment(event.target.files?.[0] || null)} /></label>{attachment && <label className="students-inline-check"><input type="checkbox" checked={sensitiveConfirmed} onChange={event => setSensitiveConfirmed(event.target.checked)} /> בדקתי שהקובץ אינו מכיל שמות תלמידים, ציונים, מסמכים אישיים או סודות.</label>}<button className="btn btn-primary" disabled={saving || (attachment && !sensitiveConfirmed)}>{saving ? 'שולח…' : 'שליחת פנייה'}</button></form></div><div className="data-table-wrap" style={{ marginTop: '1rem' }}><table className="data-table"><thead><tr><th>פנייה</th><th>סוג</th><th>דחיפות</th><th>סטטוס</th></tr></thead><tbody>{tickets.map(item => <tr key={item.id}><td>{item.title}</td><td>{item.issueType}</td><td>{item.urgency}</td><td>{item.status}</td></tr>)}{!tickets.length && <tr><td colSpan="4" className="td-empty">טרם נפתחו פניות.</td></tr>}</tbody></table></div></div></div>;
}
