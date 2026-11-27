import { LOCAL_MODEL_ID, groundingText } from '../utils/zokiOffline.js';

const SYSTEM = 'אתה עוזר בית ספר. ענה בעברית קצרה ורק לפי העובדות שניתנו. אל תמציא אירועים, משימות או כיתות. אין לבצע פעולות ואין להציע שמירה. אם חסר מידע, אמור זאת במשפט אחד.';

let enginePromise = null;

export function webGpuAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

async function defaultEngine() {
  if (!enginePromise) {
    enginePromise = import('@mlc-ai/web-llm').then(({ CreateMLCEngine }) => CreateMLCEngine(LOCAL_MODEL_ID, {
      initProgressCallback: () => undefined,
    })).catch(error => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export async function localModelReply({ question, grounding, engine = defaultEngine, timeoutMs = 45000 } = {}) {
  if (!webGpuAvailable()) return null;
  const facts = groundingText(grounding);
  try {
    const ready = await engine();
    const completion = ready.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `${facts}\n\nשאלה: ${String(question || '').slice(0, 500)}` },
      ],
      temperature: 0.2,
      max_tokens: 220,
    });
    const result = await Promise.race([
      completion,
      new Promise((_, reject) => { setTimeout(() => reject(new Error('local-timeout')), timeoutMs); }),
    ]);
    return String(result?.choices?.[0]?.message?.content || '').replace(/\s+/gu, ' ').trim().slice(0, 800);
  } catch {
    return null;
  }
}
