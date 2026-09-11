// Pure orchestration boundary: the provider interprets language; code validates
// IDs, bounds work and loads only sources authorized by the caller.
export const ZOKI_CONTEXT_LIMITS = Object.freeze({ candidates: 84, sources: 12, historyMessages: 24, historyCharacters: 24000 });
const invalid = (code = 'invalid-ai-response') => Object.assign(new Error(code), { code });

export function boundedZokiHistory(messages = []) {
  const result = [];
  let remaining = ZOKI_CONTEXT_LIMITS.historyCharacters;
  for (const message of messages.slice(-ZOKI_CONTEXT_LIMITS.historyMessages).reverse()) {
    if (!message || message.error || message.localOnly || !['user', 'assistant', 'zoki'].includes(message.role)) continue;
    const text = String(message.text || '').slice(0, Math.min(5000, remaining));
    if (!text) continue;
    result.unshift({ role: message.role === 'zoki' ? 'assistant' : message.role, text });
    remaining -= text.length;
    if (!remaining) break;
  }
  return result;
}

export function allowedSourceIds(ids, sources, limit = ZOKI_CONTEXT_LIMITS.sources) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw invalid();
  const allowed = new Set(sources.map(source => source.id));
  if (ids.some(id => !allowed.has(id))) throw invalid('invalid-ai-source');
  return [...new Set(ids)].slice(0, limit);
}

export function normalizeSemanticResult(parsed, input) {
  if (!parsed || typeof parsed.answer !== 'string' || !parsed.answer.trim()
    || !['none', 'create_task', 'end_conversation'].includes(parsed.actionIntent)) throw invalid();
  const createTask = parsed.actionIntent === 'create_task';
  if (createTask && (typeof parsed.actionRequest !== 'string' || !parsed.actionRequest.trim())) throw invalid();
  const targetType = ['role', 'person', 'team'].includes(parsed.actionTargetType) ? parsed.actionTargetType : 'none';
  if (createTask && targetType !== 'none' && (typeof parsed.actionTargetLabel !== 'string' || !parsed.actionTargetLabel.trim())) throw invalid();
  return {
    answer: parsed.answer.slice(0, 5000),
    actionIntent: parsed.actionIntent,
    actionRequest: createTask ? parsed.actionRequest.trim().slice(0, 2000) : '',
    actionTargetType: createTask ? targetType : 'none',
    actionTargetLabel: createTask && targetType !== 'none' ? String(parsed.actionTargetLabel || '').trim().slice(0, 120) : '',
    sourceIds: allowedSourceIds(parsed.sourceIds, input.authorizedSources, 8),
    memoryMutations: Array.isArray(parsed.memoryMutations) ? parsed.memoryMutations.slice(0, 3) : [],
  };
}

export async function runSemanticZokiTurn({ provider, input, sources, assertSession = () => {} }) {
  const history = boundedZokiHistory(input.history);
  let selected = sources;
  assertSession();
  if (sources.length > ZOKI_CONTEXT_LIMITS.sources) {
    const selection = await provider.selectSources({
      question: input.question, history, today: input.today,
      catalog: sources.map(source => ({ id: source.id, label: source.label, fields: Object.fromEntries(
        Object.entries(source.fields).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 180) : value]),
      ) })),
      coverage: input.coverage,
    });
    assertSession();
    const ids = allowedSourceIds(selection?.sourceIds, sources);
    selected = ids.map(id => sources.find(source => source.id === id));
  }
  const result = await provider.generateTurn({ ...input, history, authorizedSources: selected });
  assertSession();
  return { result, selectedSources: selected };
}
