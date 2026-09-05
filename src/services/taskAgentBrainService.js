import { draftTaskWithFirebaseAI } from './firebaseAiTaskService';

// Firebase-only mode. Keep legacy imports compatible without contacting an
// external institutional-brain service.
export const isInstitutionalBrainConfigured = false;
export const draftTaskWithInstitutionalBrain = input => draftTaskWithFirebaseAI(input);
export const captureTaskAgentLearning = async () => ({ skipped: true });
const unavailable = async () => { throw Object.assign(new Error('brain-not-configured'), { code: 'brain-not-configured' }); };
export const listBrainCandidates = unavailable;
export const getInstitutionalBrain = unavailable;
export const previewBrainPattern = unavailable;
export const publishBrainPattern = unavailable;
export const rejectBrainPattern = unavailable;
export const syncInstitutionalBrain = unavailable;
export const listBrainHistory = unavailable;
export const restoreBrainVersion = unavailable;
