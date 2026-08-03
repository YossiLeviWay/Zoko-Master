const STAGES = new Set([
  'staffLoad',
  'teamsLoad',
  'rolesLoad',
  'classesLoad',
  'calendarLoad',
  'promptBuild',
  'geminiCall',
  'responseProcessing',
  'nameMatching',
  'proposalDisplay',
]);

const samples = new Map();

const now = () => typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now();

export function startTaskAssistantStage(stage) {
  if (!STAGES.has(stage)) return () => undefined;
  const startedAt = now();
  return () => recordTaskAssistantStage(stage, now() - startedAt);
}

export function recordTaskAssistantStage(stage, durationMs) {
  if (!STAGES.has(stage) || !Number.isFinite(durationMs) || durationMs < 0) return;
  const previous = samples.get(stage) || [];
  samples.set(stage, [...previous.slice(-19), Math.round(durationMs * 10) / 10]);
}

export function getTaskAssistantPerformanceSnapshot() {
  return Object.fromEntries([...samples.entries()].map(([stage, values]) => {
    const total = values.reduce((sum, value) => sum + value, 0);
    return [stage, {
      samples: values.length,
      latestMs: values.at(-1) || 0,
      averageMs: Math.round((total / Math.max(1, values.length)) * 10) / 10,
    }];
  }));
}

export function resetTaskAssistantPerformance() {
  samples.clear();
}
