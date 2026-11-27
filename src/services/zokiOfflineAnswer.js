import { HOSTING_PROXY, LOCAL_DATA_NOTE, LOCAL_MODEL_NOTE, answerFromSchoolData, schoolGrounding } from '../utils/zokiOffline.js';
import { localModelReply } from './zokiLocalModel.js';

// (a) the caller already tried the Worker. (b) same-origin retry is impossible here.
// (c) a local model, then the data already on the device.
export async function offlineAnswer({ question, sources, today, model = localModelReply } = {}) {
  const grounding = schoolGrounding(sources, today);
  const dataAnswer = answerFromSchoolData(question, grounding);
  let modelText = '';
  try { modelText = await model({ question, grounding }) || ''; }
  catch { modelText = ''; }
  if (modelText) return { note: LOCAL_MODEL_NOTE, answer: modelText, layer: 'local-model', clientAction: null, proxy: HOSTING_PROXY };
  return { note: LOCAL_DATA_NOTE, answer: dataAnswer, layer: 'local-data', clientAction: null, proxy: HOSTING_PROXY };
}
