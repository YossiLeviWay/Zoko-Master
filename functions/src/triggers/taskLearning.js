import { logger } from 'firebase-functions';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { REGION } from '../config.js';
import { GEMINI_API_KEY, GEMINI_EMBEDDING_MODEL } from '../services/geminiTaskAgent.js';
import { recordTaskCompleted, recordTaskCreated } from '../services/taskLearning.js';

const OPTIONS = { region: REGION, secrets: [GEMINI_API_KEY], retry: true };

async function created(event, forcedSchoolId = '') {
  const task = event.data?.data();
  if (!task) return;
  const schoolId = forcedSchoolId || event.params.schoolId || task.schoolId;
  try {
    await recordTaskCreated({
      schoolId,
      taskId: event.params.taskId,
      task,
      apiKey: GEMINI_API_KEY.value(),
      embeddingModel: GEMINI_EMBEDDING_MODEL.value(),
    });
  } catch (error) {
    logger.error('Task learning create failed.', { schoolId, taskId: event.params.taskId, code: error?.code || 'unknown' });
    throw error;
  }
}

async function updated(event, forcedSchoolId = '') {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status || !['done', 'completed'].includes(after.status)) return;
  await recordTaskCompleted({ schoolId: forcedSchoolId || event.params.schoolId || after.schoolId, taskId: event.params.taskId, task: after });
}

export const learnNestedOrganizationTaskCreated = onDocumentCreated({ ...OPTIONS, document: 'schools/{schoolId}/tasks/{taskId}' }, created);
export const learnNestedOrganizationTaskUpdated = onDocumentUpdated({ ...OPTIONS, document: 'schools/{schoolId}/tasks/{taskId}' }, updated);
export const learnLegacyOrganizationTaskCreated = onDocumentCreated({ ...OPTIONS, document: 'tasks_{schoolId}/{taskId}' }, created);
export const learnLegacyOrganizationTaskUpdated = onDocumentUpdated({ ...OPTIONS, document: 'tasks_{schoolId}/{taskId}' }, updated);
export const learnPersonalTaskCreated = onDocumentCreated({ ...OPTIONS, document: 'users/{userId}/personalTasks/{taskId}' }, event => created(event, event.data?.data()?.schoolId));
