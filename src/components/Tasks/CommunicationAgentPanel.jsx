import { useState } from 'react';
import { Bot, Check, LoaderCircle, MessageSquareText, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { callableReason, draftCommunicationWithAgent } from '../../services/adminUserService';

const STYLE_LABELS = {
  respectful: 'מכובד',
  direct: 'ישיר',
  friendly: 'ידידותי',
  formal: 'רשמי',
};

function errorMessage(error) {
  const reason = callableReason(error);
  if (reason === 'agent-not-configured' || reason === 'failed-precondition') {
    return 'סוכן ה־AI טרם הוגדר בשרת. אפשר להמשיך ולערוך את הטיוטה ידנית.';
  }
  if (reason === 'permission-denied') return 'אין לך הרשאת שימוש בסוכן הניסוח.';
  if (reason === 'resource-exhausted') return 'בוצעו יותר מדי בקשות. אפשר לנסות שוב בעוד כמה דקות.';
  return 'סוכן הניסוח אינו זמין כרגע. שום טיוטה או פעולה לא נשמרו.';
}

function emailList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || '')
    .split(/[;,\n]/)
    .map(item => item.trim())
    .filter(Boolean);
}

export default function CommunicationAgentPanel({
  schoolId,
  task,
  form,
  contacts,
  staff,
  onApply,
}) {
  const [request, setRequest] = useState('');
  const [style, setStyle] = useState('respectful');
  const [proposal, setProposal] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function askAgent(operation = 'compose') {
    const prompt = request.trim();
    if (prompt.length < 3) {
      setError('כתבו בקצרה מה תרצו להשיג במייל.');
      return;
    }
    setLoading(true);
    setError('');
    setMessages(previous => [...previous.slice(-3), { role: 'user', text: prompt }]);
    try {
      const result = await draftCommunicationWithAgent({
        schoolId,
        request: prompt,
        operation,
        language: 'he',
        style,
        context: {
          type: task.communicationContext?.type || task.linkedContextType || 'task',
          id: task.communicationContext?.id || task.linkedContextId || task.id,
          label: task.communicationContext?.label || task.linkedContextLabel || task.title || 'משימה',
        },
        contactRefs: contacts
          .filter(contact => ['private', 'institutional'].includes(contact.scope))
          .slice(0, 12)
          .map(contact => ({ id: contact.id, scope: contact.scope })),
        assigneeIds: staff.map(member => member.uid || member.id).filter(Boolean).slice(0, 40),
        currentDraft: {
          recipients: emailList(form.to),
          cc: emailList(form.cc),
          bcc: emailList(form.bcc),
          subject: form.subject,
          body: form.body,
          summary: form.summary,
          priority: form.priority === 'medium' ? 'normal' : form.priority,
          followUpAt: form.nextFollowUpAt || null,
          completionCriteria: form.completionCriteria,
        },
      });
      setProposal(result.proposal);
      setMessages(previous => [...previous, {
        role: 'assistant',
        text: result.proposal.missingFields.length
          ? `נוצרה הצעה. חסרים ${result.proposal.missingFields.length} פרטים שכדאי להשלים.`
          : 'נוצרה הצעה מלאה לבדיקה ולאישור שלך.',
      }]);
    } catch (agentError) {
      setError(errorMessage(agentError));
    } finally {
      setLoading(false);
    }
  }

  return <aside className="communication-agent" aria-label="סוכן תקשורת ומעקב">
    <header><span><Sparkles size={15} /> סוכן תקשורת</span><h3>מה תרצו לכתוב?</h3><p>תארו את הצורך בשפה פשוטה. הסוכן מציע בלבד ואינו שומר, שולח או משנה דבר.</p></header>
    {task.communicationContext?.type === 'student' && <div className="communication-agent-privacy"><ShieldCheck size={15} /> אין להזין מידע רפואי, מספר זהות, ציונים או הערות אישיות של תלמיד.</div>}
    {messages.length > 0 && <div className="communication-agent-messages" aria-live="polite">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`communication-agent-message communication-agent-message--${message.role}`}><MessageSquareText size={13} /><span>{message.text}</span></div>)}</div>}
    <label>הבקשה שלך<textarea value={request} onChange={event => setRequest(event.target.value)} maxLength={4000} placeholder="לדוגמה: נסח מייל לספק כדי לקבל הצעת מחיר, ואם לא יענה תוך שלושה ימים תזכיר לי..." /></label>
    <div className="communication-agent-controls"><label>סגנון<select value={style} onChange={event => setStyle(event.target.value)}>{Object.entries(STYLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button type="button" className="btn btn-primary" onClick={() => askAgent('compose')} disabled={loading}>{loading ? <LoaderCircle className="spin" size={16} /> : <Bot size={16} />} יצירת הצעה</button></div>
    {error && <p className="communication-agent-error" role="alert">{error}</p>}
    {proposal && <section className="communication-agent-proposal">
      <div><strong>הצעת הסוכן</strong><span>טרם הוחלה על הטיוטה</span></div>
      <dl><div><dt>אל</dt><dd dir="ltr">{proposal.recipients.join('; ') || 'חסר נמען'}</dd></div><div><dt>נושא</dt><dd>{proposal.subject || 'חסר נושא'}</dd></div><div><dt>מעקב</dt><dd>{proposal.followUpAt || 'לא נקבע'}</dd></div><div><dt>פעולה הבאה</dt><dd>{proposal.suggestedNextAction || 'בדיקת הטיוטה'}</dd></div></dl>
      {proposal.missingFields.length > 0 && <div className="communication-agent-missing"><strong>מידע שחסר:</strong><ul>{proposal.missingFields.map(item => <li key={item}>{item}</li>)}</ul></div>}
      <div className="communication-agent-proposal-actions"><button type="button" className="btn btn-primary" onClick={() => onApply(proposal)}><Check size={15} /> החלת ההצעה</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => askAgent('shorten')} disabled={loading}>קיצור</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => askAgent('expand')} disabled={loading}>הרחבה</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => askAgent('change_tone')} disabled={loading}><RefreshCw size={14} /> לפי הסגנון שנבחר</button></div>
    </section>}
  </aside>;
}
