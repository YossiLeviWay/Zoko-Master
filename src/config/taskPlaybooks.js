const cleanText = (value, maxLength = 180) => typeof value === 'string'
  ? value.trim().slice(0, maxLength)
  : '';

const cleanList = (value, maxItems = 20, maxLength = 120) => [...new Set(
  (Array.isArray(value) ? value : [])
    .map(item => cleanText(item, maxLength))
    .filter(Boolean),
)].slice(0, maxItems);

export const ANNUAL_TRIP_PLAYBOOK_ID = 'annual_school_trip';

export const DEFAULT_TASK_PLAYBOOKS = Object.freeze([
  Object.freeze({
    id: ANNUAL_TRIP_PLAYBOOK_ID,
    name: 'טיול שנתי',
    domain: 'school_trip',
    domainLabels: ['טיול', 'טיולים', 'טיול שנתי', 'מסע', 'סיור'],
    primaryTeamAliases: ['צוות טיולים', 'טיולים וסיורים', 'רכזי טיולים'],
    supportingRoles: ['יועצת', 'יועץ', 'מנהלנית', 'מנהלן', 'מזכירה', 'מזכיר'],
    clarificationQuestions: [{
      id: 'overnight',
      text: 'האם הטיול כולל לינה?',
      material: true,
    }],
    completionCriteria: 'כל האישורים, ההזמנות, התדריכים ובדיקות הבטיחות הושלמו לפני היציאה.',
    commonDocuments: ['אישור תכנית ומסלול', 'הצעות מחיר', 'חוזר הורים', 'רשימת משתתפים'],
    steps: [
      { id: 'goals', phase: 'היערכות', title: 'הגדרת מטרות, מסגרת תקציב ומועד', party: 'team', relativeDays: -90 },
      { id: 'route', phase: 'היערכות', title: 'בניית מסלול ובדיקת התאמה לשכבה', party: 'team', relativeDays: -80 },
      { id: 'approvals', phase: 'אישורים', title: 'ריכוז האישורים הנדרשים למסלול ולפעילות', party: 'team', relativeDays: -70 },
      { id: 'transport', phase: 'ספקים', title: 'קבלת הצעות מחיר והזמנת הסעות', party: 'administration', relativeDays: -60 },
      { id: 'lodging', phase: 'ספקים', title: 'בדיקת מקום לינה והזמנתו', party: 'administration', relativeDays: -60, condition: 'overnight' },
      { id: 'parents', phase: 'תקשורת', title: 'הכנת חוזר הורים וריכוז אישורים', party: 'homeroom_secretary', relativeDays: -35 },
      { id: 'accessibility', phase: 'התאמות', title: 'בדיקת התאמות רגשיות ונגישות נדרשות', party: 'counselor_homeroom', relativeDays: -30 },
      { id: 'students', phase: 'תדריכים', title: 'תדרוך תלמידים וחלוקת מידע מעשי', party: 'homeroom', relativeDays: -14 },
      { id: 'staff', phase: 'תדריכים', title: 'תדרוך הצוות וחלוקת אחריות ליום הפעילות', party: 'team_leader', relativeDays: -10 },
      { id: 'calendar', phase: 'תיאום', title: 'אימות המועד מול לוח השנה והימים החסומים', party: 'team', relativeDays: -45 },
      { id: 'departure', phase: 'ביצוע', title: 'בדיקת נוכחות, ציוד ואישורים לפני יציאה', party: 'homeroom', relativeDays: 0 },
      { id: 'coordination', phase: 'ביצוע', title: 'תיאום שוטף עם הצוות והספקים במהלך הטיול', party: 'team_leader', relativeDays: 0 },
      { id: 'closure', phase: 'סיכום', title: 'סיכום, משוב וסגירת התחייבויות', party: 'team', relativeDays: 7 },
    ],
  }),
]);

function normalizeQuestion(value) {
  if (!value || typeof value !== 'object') return null;
  const id = cleanText(value.id, 60);
  const question = cleanText(value.text, 240);
  return id && question ? { id, text: question, material: value.material !== false } : null;
}

function normalizeStep(value, index) {
  if (!value || typeof value !== 'object') return null;
  const title = cleanText(value.title, 180);
  if (!title) return null;
  const relativeDays = Number.isFinite(Number(value.relativeDays))
    ? Math.max(-365, Math.min(365, Math.round(Number(value.relativeDays))))
    : 0;
  return {
    id: cleanText(value.id, 60) || `step_${index + 1}`,
    phase: cleanText(value.phase, 80) || 'ביצוע',
    title,
    party: cleanText(value.party, 80) || 'team',
    relativeDays,
    condition: cleanText(value.condition, 60),
  };
}

export function normalizeTaskPlaybook(value, fallback = DEFAULT_TASK_PLAYBOOKS[0]) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    id: cleanText(input.id, 80) || fallback.id,
    name: cleanText(input.name, 120) || fallback.name,
    domain: cleanText(input.domain, 80) || fallback.domain,
    domainLabels: cleanList(input.domainLabels?.length ? input.domainLabels : fallback.domainLabels, 20),
    primaryTeamAliases: cleanList(input.primaryTeamAliases?.length ? input.primaryTeamAliases : fallback.primaryTeamAliases, 20),
    supportingRoles: cleanList(input.supportingRoles?.length ? input.supportingRoles : fallback.supportingRoles, 20),
    clarificationQuestions: (Array.isArray(input.clarificationQuestions) ? input.clarificationQuestions : fallback.clarificationQuestions)
      .map(normalizeQuestion).filter(Boolean).slice(0, 5),
    completionCriteria: cleanText(input.completionCriteria, 800) || fallback.completionCriteria,
    commonDocuments: cleanList(input.commonDocuments?.length ? input.commonDocuments : fallback.commonDocuments, 20),
    steps: (Array.isArray(input.steps) ? input.steps : fallback.steps)
      .map(normalizeStep).filter(Boolean).slice(0, 30),
  };
}

export function resolveTaskPlaybooks(storedPlaybooks = []) {
  const stored = new Map((Array.isArray(storedPlaybooks) ? storedPlaybooks : [])
    .map(item => normalizeTaskPlaybook(item))
    .map(item => [item.id, item]));
  return DEFAULT_TASK_PLAYBOOKS.map(playbook => stored.get(playbook.id) || normalizeTaskPlaybook(playbook));
}
