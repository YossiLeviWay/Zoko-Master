import { useEffect, useState } from 'react';
import { BookOpen, Bot, Settings2, Sparkles } from 'lucide-react';
import { FIREBASE_AI_CONFIG } from '../../config/firebaseAi';
import { draftTaskWithFirebaseAI, preloadTaskAssistantRuntime, taskAssistantErrorMessage } from '../../services/firebaseAiTaskService';
import {
  buildGeminiSchoolContext,
  createLocalTaskProposal,
  primeSchoolContext,
  resolveTaskAssistantWithFallback,
  resolveSchoolTaskContext,
  schoolContextStatusMessage,
} from '../../services/schoolContextResolver';
import TaskPlaybookManager from './TaskPlaybookManager';

const preferenceKey = uid => `zoko-task-agent-preferences:${uid}`;
const storedPreferences = uid => {
  try {
    return JSON.parse(window.localStorage.getItem(preferenceKey(uid)) || '{}');
  } catch {
    return {};
  }
};

export default function TaskAssistantEntry({ uid, contextConfig, canManagePlaybooks = false, onManual, onProposal }) {
  const [request, setRequest] = useState('');
  const [answer, setAnswer] = useState('');
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const [showPreferences, setShowPreferences] = useState(false);
  const [showPlaybooks, setShowPlaybooks] = useState(false);
  const [preferences, setPreferences] = useState(() => storedPreferences(uid));

  useEffect(() => {
    if (!contextConfig?.schoolId) return;
    primeSchoolContext(contextConfig);
    preloadTaskAssistantRuntime().catch(() => undefined);
  }, [contextConfig]);

  async function askAgent(currentProposal = null) {
    setLoading(true);
    setError('');
    setProgressMessage('בודק צוותים, תפקידים ולוח שנה...');
    try {
      await Promise.resolve();
      const localContext = resolveSchoolTaskContext({ ...contextConfig, request });
      const latestPreferences = storedPreferences(uid);
      const preferredTeamId = latestPreferences.personalization === false
        ? ''
        : latestPreferences.preferredTeamsByDomain?.[localContext.inferred.domain];
      if (preferredTeamId && localContext.teams.some(team => team.id === preferredTeamId)) {
        localContext.teams = [
          ...localContext.teams.filter(team => team.id === preferredTeamId),
          ...localContext.teams.filter(team => team.id !== preferredTeamId),
        ];
      }
      const localProposal = createLocalTaskProposal(request, localContext, { answer, currentProposal });
      setProgressMessage(schoolContextStatusMessage(localContext));
      const result = await resolveTaskAssistantWithFallback({
        localProposal,
        generate: async () => {
          const agentResult = await draftTaskWithFirebaseAI({
            uid,
            schoolId: contextConfig.schoolId,
            request,
            currentProposal,
            answer,
            organizationContext: buildGeminiSchoolContext(localContext),
          });
          return agentResult.proposal;
        },
      });
      setAnswer('');
      setProposal(result.proposal);
      if (result.usedLocalFallback) {
        setProgressMessage('הסוכן החכם לא השיב בזמן. מוצגת הצעה מקומית שאפשר לערוך.');
        onProposal(result.proposal, { request, localFallback: true });
      } else if (!result.proposal.followUpQuestion) {
        onProposal(result.proposal, { request });
      }
    } catch (caught) {
      if (['sensitive-content', 'too-short'].includes(caught?.code)) {
        setError(taskAssistantErrorMessage(caught));
      } else {
        try {
          const localContext = resolveSchoolTaskContext({ ...contextConfig, request });
          const localProposal = createLocalTaskProposal(request, localContext, { answer, currentProposal });
          setProposal(localProposal);
          setProgressMessage('הסוכן החכם לא השיב בזמן. מוצגת הצעה מקומית שאפשר לערוך.');
          onProposal(localProposal, { request, localFallback: true });
        } catch {
          setError(taskAssistantErrorMessage(caught));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  function savePreferences(next) {
    setPreferences(next);
    window.localStorage.setItem(preferenceKey(uid), JSON.stringify(next));
  }

  return <section className="task-assistant-entry" aria-labelledby="task-assistant-title">
    <div className="task-assistant-copy"><span><Sparkles size={15} /> סוכן המשימות</span><h2 id="task-assistant-title">מה צריך לקדם?</h2><p>כתבו במילים פשוטות. הסוכן יעזור לבנות את המשימה, לחבר אנשים ולקבוע את הצעד הבא.</p></div>
    <div className="task-assistant-compose">
      <label className="sr-only" htmlFor="task-assistant-request">תיאור המשימה</label>
      <textarea id="task-assistant-request" value={request} onChange={event => setRequest(event.target.value)} maxLength={FIREBASE_AI_CONFIG.maxInputLength} rows={2} placeholder="למשל: צריך לקדם את הטיול השנתי של כיתה י״א במהלך אוקטובר..." />
      <div><button type="button" className="btn btn-primary" onClick={() => askAgent()} disabled={loading || request.trim().length < 3}><Bot size={16} /> {loading ? 'מכין הצעה…' : 'המשך עם הסוכן'}</button><button type="button" className="btn btn-link" onClick={onManual}>יצירה ידנית</button><button type="button" className="btn btn-link" onClick={() => setShowPreferences(value => !value)} aria-expanded={showPreferences}><Settings2 size={14} /> העדפות הסוכן</button></div>
    </div>
    {progressMessage && <div className="task-assistant-progress" role="status" aria-live="polite">{progressMessage}</div>}
    {proposal?.followUpQuestion && <div className="task-assistant-question" role="status"><strong>{proposal.followUpQuestion}</strong><input value={answer} onChange={event => setAnswer(event.target.value)} maxLength={500} placeholder="תשובה קצרה" /><div><button type="button" className="btn btn-primary btn-sm" onClick={() => askAgent(proposal)} disabled={loading || !answer.trim()}>עדכון ההצעה</button><button type="button" className="btn btn-secondary btn-sm" onClick={() => onProposal(proposal, { request })}>הצגת הטיוטה עכשיו</button></div></div>}
    {error && <div className="task-assistant-error" role="alert"><span>{error}</span><button type="button" className="btn btn-secondary btn-sm" onClick={onManual}>מעבר ליצירה ידנית</button></div>}
    {showPreferences && <div className="task-assistant-preferences"><label><input type="checkbox" checked={preferences.personalization !== false} onChange={event => savePreferences({ ...preferences, personalization: event.target.checked })} /> התאמה אישית בסיסית</label><label>סוג ברירת מחדל<select value={preferences.defaultType || 'personal'} onChange={event => savePreferences({ ...preferences, defaultType: event.target.value })}><option value="personal">אישית</option><option value="assigned">לאדם</option><option value="team">לצוות</option><option value="initiative">תכנית</option></select></label><label><input type="checkbox" checked={preferences.preferSubtasks === true} onChange={event => savePreferences({ ...preferences, preferSubtasks: event.target.checked })} /> להעדיף חלוקה לשלבים</label>{canManagePlaybooks && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowPlaybooks(true)}><BookOpen size={14} /> תבנית עבודה מוסדית</button>}<button type="button" className="btn btn-link" onClick={() => { window.localStorage.removeItem(preferenceKey(uid)); setPreferences({}); }}>מחיקת ההעדפות</button></div>}
    <small>הסוכן אינו מקבל מסמכים או פרטי תלמידים רגישים, ואינו שומר דבר ללא אישור.</small>
    {showPlaybooks && <TaskPlaybookManager schoolId={contextConfig.schoolId} actorId={uid} canManage={canManagePlaybooks} playbooks={contextConfig.sources?.playbooks || []} approvedRules={contextConfig.sources?.approvedRules || []} onClose={() => setShowPlaybooks(false)} />}
  </section>;
}
