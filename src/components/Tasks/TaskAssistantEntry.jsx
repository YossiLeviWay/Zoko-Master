import { useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { FIREBASE_AI_CONFIG } from '../../config/firebaseAi';
import { draftTaskWithFirebaseAI, taskAssistantErrorMessage } from '../../services/firebaseAiTaskService';

export default function TaskAssistantEntry({ uid, schoolId, onManual, onProposal }) {
  const [request, setRequest] = useState('');
  const [answer, setAnswer] = useState('');
  const [proposal, setProposal] = useState(null);
  const [proposalMeta, setProposalMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function askAgent(currentProposal = null) {
    setLoading(true);
    setError('');
    try {
      const result = await draftTaskWithFirebaseAI({ uid, schoolId, request, currentProposal, answer });
      setAnswer('');
      setProposal(result.proposal);
      setProposalMeta({ request, sessionId: result.sessionId, capabilities: result.capabilities });
      if (!result.proposal.followUpQuestion) onProposal(result.proposal, {
        request,
        sessionId: result.sessionId,
        capabilities: result.capabilities,
      });
    } catch (caught) {
      setError(taskAssistantErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return <section className="task-assistant-entry" aria-labelledby="task-assistant-title">
    <div className="task-assistant-copy"><span><Sparkles size={15} /> סוכן המשימות</span><h2 id="task-assistant-title">מה צריך לקדם?</h2></div>
    <div className="task-assistant-compose">
      <label className="sr-only" htmlFor="task-assistant-request">תיאור המשימה</label>
      <textarea id="task-assistant-request" value={request} onChange={event => setRequest(event.target.value)} maxLength={FIREBASE_AI_CONFIG.maxInputLength} rows={2} placeholder="למשל: הכנת מבחנים לשכבת ח׳ בחודש הבא" />
      <div><button type="button" className="btn btn-primary" onClick={() => askAgent()} disabled={loading || request.trim().length < 3}><Bot size={16} /> {loading ? 'מכין הצעה…' : 'המשך עם הסוכן'}</button><button type="button" className="btn btn-link" onClick={onManual}>יצירה ידנית</button></div>
    </div>
    {proposal?.followUpQuestion && <div className="task-assistant-question" role="status"><strong>{proposal.followUpQuestion}</strong><input value={answer} onChange={event => setAnswer(event.target.value)} maxLength={500} placeholder="תשובה קצרה" /><div><button type="button" className="btn btn-primary btn-sm" onClick={() => askAgent(proposal)} disabled={loading || !answer.trim()}>עדכון ההצעה</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => onProposal(proposal, proposalMeta || { request })}>פתיחת הטיוטה</button></div></div>}
    {error && <div className="task-assistant-error" role="alert"><span>{error}</span><button type="button" className="btn btn-secondary btn-sm" onClick={onManual}>יצירה ידנית</button></div>}
  </section>;
}
