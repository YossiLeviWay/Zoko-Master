import { useEffect, useState } from 'react';
import { zokiRequest } from '../../services/zokiAgentService.js';

export default function ZokiPersonalSettings({ schoolId, manager = false, onClose }) {
  const [profile, setProfile] = useState(null);
  const [limit, setLimit] = useState(4);
  const [preference, setPreference] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([zokiRequest('profile', schoolId, null, 'GET'), manager ? zokiRequest('admin/settings', schoolId, null, 'GET') : Promise.resolve(null)])
      .then(([data, settings]) => { if (active) { setProfile(data); setPreference(data.preferences.join('\n')); if (settings) setLimit(settings.questionsPerMinute); } })
      .catch(() => { if (active) setMessage('לא ניתן לטעון את ההגדרות כרגע.'); });
    return () => { active = false; };
  }, [schoolId, manager]);
  async function change(body) {
    setBusy(true); setMessage('');
    try {
      await zokiRequest('profile', schoolId, body, 'PATCH');
      setProfile(await zokiRequest('profile', schoolId, null, 'GET'));
      setMessage('נשמר.');
    } catch { setMessage('השינוי לא נשמר. נסו שוב.'); }
    finally { setBusy(false); }
  }
  async function saveLimit() {
    setBusy(true);
    try { await zokiRequest('admin/settings', schoolId, { questionsPerMinute: Number(limit) }, 'PUT'); setMessage('מגבלת השאלות נשמרה.'); }
    catch { setMessage('לא ניתן לשמור את המגבלה.'); }
    finally { setBusy(false); }
  }
  async function more() {
    setBusy(true);
    try { const next = await zokiRequest('profile', schoolId, null, 'GET', profile.nextOffset); setProfile(previous => ({ ...next, memories: [...previous.memories, ...next.memories] })); }
    catch { setMessage('לא ניתן לטעון עוד זיכרונות.'); }
    finally { setBusy(false); }
  }
  return <div className="zoki-brain-overlay"><aside className="zoki-brain-panel" role="dialog" aria-modal="true" aria-label="הזיכרון האישי של זוקי">
    <header><h2>מה זוקי זוכר עליי</h2><button type="button" onClick={onClose}>סגירה</button></header>
    <div className="zoki-brain-body">
      {manager && <section><h3>הגדרות שימוש למוסד</h3><label>שאלות למורה בדקה בממשק<input type="number" min="1" max="20" value={limit} onChange={event => setLimit(event.target.value)} /></label><button disabled={busy || !profile} onClick={saveLimit}>שמירת המגבלה</button><p>זו מגבלת שימוש בממשק, ולא תקרת תקציב מחייבת. ההגבלה הנאכפת בשירות של Google אחידה לכל המשתמשים ומוגדרת במסוף Google Cloud.</p></section>}
      {profile && <>
        <label><input type="checkbox" checked={profile.learningEnabled} disabled={busy} onChange={event => change({ operation: 'learning', enabled: event.target.checked })} /> זוקי לומד ושומר זיכרון אוטומטית</label>
        <label>העדפות אישיות בכל המוסדות<textarea maxLength={600} value={preference} onChange={event => setPreference(event.target.value)} /></label><button disabled={busy} onClick={() => change({ operation: 'preferences', content: preference })}>שמירת העדפות</button>
        <h3>זיכרונות מהמוסד הנוכחי</h3>
        <p>מידע מוסדי נשאר בהקשר המוסד. זיכרונות מוצגים רק כל עוד יש לך הרשאה למקורות שלהם.</p>
        {profile.memories.map(memory => <article key={`${memory.id}:${memory.updatedAt}`} className="zoki-knowledge-card"><textarea aria-label="תוכן הזיכרון" maxLength={600} defaultValue={memory.content} id={`memory-${memory.id}`} /><small>{memory.type} · {new Date(memory.updatedAt).toLocaleDateString('he-IL')}</small><button disabled={busy} onClick={() => change({ operation: 'edit', id: memory.id, content: document.getElementById(`memory-${memory.id}`).value })}>שמירה</button><button disabled={busy} onClick={() => change({ operation: 'delete', id: memory.id })}>מחיקה</button></article>)}
        {profile.nextOffset !== null && <button disabled={busy} onClick={more}>עוד זיכרונות</button>}
        <button disabled={busy} onClick={() => { if (window.confirm('למחוק את כל הזיכרונות מהמוסד הנוכחי?')) change({ operation: 'clear' }); }}>מחיקת זיכרונות המוסד</button>
      </>}
      <p>השיחה נעזרת ב‑Gemini. בשירות החינמי Google עשויה להשתמש בתוכן לשיפור מוצריה.</p>
      <p role="status">{message || (!profile ? 'טוען…' : '')}</p>
    </div>
  </aside></div>;
}
