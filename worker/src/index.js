import { TOOL_SCHEMAS, buildClaudeRequest, callClaude, heldCapabilities } from './claude.js';
import { V1_TOOLS, guardProposals } from './zokiActionTools.js';
import { offeredCapabilityKeys, runClaudeRounds } from './zokiToolRound.js';
import { allowedTools } from '../../functions/src/roleAgents.js';
import { appendLearningLog, buildSchoolContext, claudeLimitFor, dailyLimitFor, dayKey, learningLogLine, looksLikeAction, replyWithStoredMemory, secondsToMidnight, teachingNote, toolSpecs, validatedProposal, withoutMilestoneRetraction } from './zokiTurn.js';
import { askLocalTiered, buildLocalRequest, localModelConfigured, parseLocalResponse, routeLocalAction, streamLocalTiered } from './localModel.js';
import { roleAgentProfile } from '../../functions/src/roleAgents.js';
import {
  createSchoolBrain,
  fingerprint,
  learningRecord,
  preserveApprovedPatterns,
  relevantBrainContext,
  sanitizeInstitutionalText,
  upsertApprovedPattern,
} from './brain.js';
import { EVENT_PAGE_CAP, eventPageContinues, eventRawFieldSample, eventScanQuery, firestoreParent } from './ganttEvents.js';
import { SNAPSHOT_TTL_MS, buildPersonalContext, buildPersonalSnapshot, buildReflectionRequest, compactPersonalContext, emptyProfile, mergeLearnedProfile, profileIsEmpty, profileText, sanitizeProfile, snapshotText } from './personalBrain.js';

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

function cors(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization,x-firebase-appcheck,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-max-age': '86400',
    vary: 'Origin',
  } : {};
}

const base64Url = input => btoa(String.fromCharCode(...new Uint8Array(input))).replace(/=/gu, '').replace(/\+/gu, '-').replace(/\//gu, '_');

function pemBytes(value) {
  const body = String(value || '').replace(/\\n/gu, '\n').replace(/-----[^-]+-----/gu, '').replace(/\s+/gu, '');
  return Uint8Array.from(atob(body), char => char.charCodeAt(0));
}

async function signedJwt({ issuer, subject = '', audience = '', privateKey, lifetime = 540, claims = {} }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    iss: issuer,
    ...(subject ? { sub: subject } : {}),
    ...(audience ? { aud: audience } : {}),
    iat: now - 30,
    exp: now + lifetime,
    ...claims,
  })));
  const key = await crypto.subtle.importKey('pkcs8', pemBytes(privateKey), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(signature)}`;
}

// ---- The institutional brain lives in Firestore (schoolBrain/{schoolId}), written only by the Worker's admin credentials ----
// Clients cannot read or write it (see firestore.rules); managers reach it only through the Worker endpoints below.
const BRAIN_LIMIT_BYTES = 900000;
let cachedAdmin = { token: '', expiresAt: 0 };

async function adminToken(env) {
  if (cachedAdmin.expiresAt > Date.now() + 60000) return cachedAdmin.token;
  cachedAdmin = { token: await firebaseAdminToken(env), expiresAt: Date.now() + 3000000 };
  return cachedAdmin.token;
}

const brainPath = schoolId => `schoolBrain/${encodeURIComponent(schoolId)}`;
const documentsUrl = env => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const fieldsOf = document => Object.fromEntries(Object.entries(document?.fields || {}).map(([key, value]) => [key, plainValue(value)]));

async function adminGet(env, path) {
  const response = await fetch(`${documentsUrl(env)}/${path}`, { headers: { authorization: `Bearer ${await adminToken(env)}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('brain-read-failed');
  return response.json();
}

async function adminCommit(env, writes) {
  const response = await fetch(`${documentsUrl(env)}:commit`, {
    method: 'POST', headers: { authorization: `Bearer ${await adminToken(env)}`, 'content-type': 'application/json' }, body: JSON.stringify({ writes }),
  });
  if (!response.ok) {
    console.error('firestore-commit-failed', response.status);
    throw new Error('brain-write-failed');
  }
}

const adminWrite = (env, path, fields) => ({
  update: { name: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, firestoreValue(value)])) },
});

// Returns { markdown, sha, exists }. A school with no brain yet gets an empty one (exists:false).
async function readBrain(env, schoolId) {
  const document = await adminGet(env, brainPath(schoolId));
  if (!document) return { markdown: createSchoolBrain({ school: { id: schoolId }, patterns: [] }), sha: '', exists: false };
  const fields = fieldsOf(document);
  return { markdown: String(fields.markdown || ''), sha: String(fields.version || ''), exists: true };
}

// Saves the current brain and keeps this text as a version, in one atomic commit.
async function writeBrain(env, schoolId, markdown, message, author = '') {
  if (new TextEncoder().encode(markdown).length > BRAIN_LIMIT_BYTES) throw new Error('brain-too-large');
  const version = `${Date.now()}`;
  const at = new Date().toISOString();
  await adminCommit(env, [
    adminWrite(env, brainPath(schoolId), { schoolId, markdown, version, updatedAt: at }),
    adminWrite(env, `${brainPath(schoolId)}/versions/${version}`, { markdown, message: String(message).slice(0, 200), author: String(author).slice(0, 120), createdAt: at }),
  ]);
  return { commit: { sha: version } };
}

async function brainHistory(env, schoolId) {
  const response = await fetch(`${documentsUrl(env)}/${brainPath(schoolId)}/versions?pageSize=30&orderBy=${encodeURIComponent('createdAt desc')}`, { headers: { authorization: `Bearer ${await adminToken(env)}` } });
  if (!response.ok) throw new Error('brain-history-failed');
  return ((await response.json()).documents || []).map(document => {
    const fields = fieldsOf(document);
    return { sha: document.name.split('/').pop(), message: fields.message || '', author: fields.author || '', date: fields.createdAt || '' };
  });
}

async function restoreBrain(env, schoolId, version, author = '') {
  const document = await adminGet(env, `${brainPath(schoolId)}/versions/${encodeURIComponent(version)}`);
  if (!document) throw new Error('brain-restore-source-failed');
  return writeBrain(env, schoolId, String(fieldsOf(document).markdown || ''), `Restore institutional brain from ${String(version).slice(0, 12)}`, author);
}

async function actorFromToken(request, env) {
  const bearer = request.headers.get('authorization') || '';
  const idToken = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  if (!idToken) throw new Error('unauthenticated');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  if (!response.ok) throw new Error('unauthenticated');
  const user = (await response.json()).users?.[0];
  if (!user?.localId) throw new Error('unauthenticated');
  return { uid: user.localId, idToken };
}

async function firebaseAdminToken(env) {
  const assertion = await signedJwt({
    issuer: env.FIREBASE_CLIENT_EMAIL,
    subject: env.FIREBASE_CLIENT_EMAIL,
    audience: 'https://oauth2.googleapis.com/token',
    privateKey: env.FIREBASE_PRIVATE_KEY,
    lifetime: 3300,
    claims: { scope: 'https://www.googleapis.com/auth/datastore' },
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error('firebase-admin-auth-failed');
  return (await response.json()).access_token;
}

function decodeJwtPart(value) {
  const normalized = String(value || '').replace(/-/gu, '+').replace(/_/gu, '/');
  const bytes = Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), char => char.charCodeAt(0));
  // The signature segment is binary, so the JSON is parsed only when asked for.
  return { bytes, get json() { return JSON.parse(new TextDecoder().decode(bytes)); } };
}

let appCheckKeys = { expiresAt: 0, keys: [] };

async function verifyAppCheck(request, env) {
  if (!env.FIREBASE_PROJECT_NUMBER) return;
  const token = request.headers.get('x-firebase-appcheck') || '';
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('invalid-app-check');
  const header = decodeJwtPart(headerPart).json;
  const payload = decodeJwtPart(payloadPart).json;
  if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new Error('invalid-app-check');
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== `https://firebaseappcheck.googleapis.com/${env.FIREBASE_PROJECT_NUMBER}`
    || !audience.includes(`projects/${env.FIREBASE_PROJECT_NUMBER}`)
    || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) throw new Error('invalid-app-check');
  const allowedApps = String(env.FIREBASE_APP_IDS || '').split(',').map(item => item.trim()).filter(Boolean);
  if (allowedApps.length && !allowedApps.includes(payload.sub)) throw new Error('invalid-app-check');
  if (appCheckKeys.expiresAt <= Date.now()) {
    const response = await fetch('https://firebaseappcheck.googleapis.com/v1/jwks');
    if (!response.ok) throw new Error('app-check-unavailable');
    appCheckKeys = { keys: (await response.json()).keys || [], expiresAt: Date.now() + 6 * 3600000 };
  }
  const jwk = appCheckKeys.keys.find(item => item.kid === header.kid);
  if (!jwk) throw new Error('invalid-app-check');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeJwtPart(signaturePart).bytes,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error('invalid-app-check');
}

function brainDirectory(markdown) {
  const staffSection = String(markdown || '').split('## סגל ותפקידים')[1]?.split('\n## ')[0] || '';
  const unitsSection = String(markdown || '').split('## צוותים, כיתות ותכניות')[1]?.split('\n## ')[0] || '';
  const rows = section => section.split('\n').filter(line => /^\|.+\|$/u.test(line)).slice(2).map(line => line.split('|').slice(1, -1).map(value => value.trim().replace(/\\\|/gu, '|')));
  const staff = rows(staffSection);
  const units = rows(unitsSection);
  return {
    people: new Set(staff.flatMap(row => [row[0], row[1]]).filter(Boolean)),
    teams: new Set(units.filter(row => row[0] === 'צוות').map(row => row[1]).filter(Boolean)),
    entities: new Set(units.filter(row => ['כיתה', 'תכנית'].includes(row[0])).map(row => row[1]).filter(Boolean)),
  };
}

export function validatedAgentProposal(proposal, markdown) {
  const directory = brainDirectory(markdown);
  const strings = (value, allowed) => [...new Set((Array.isArray(value) ? value : []).filter(item => typeof item === 'string' && allowed.has(item)))].slice(0, 12);
  return {
    ...(proposal && typeof proposal === 'object' ? proposal : {}),
    assigneeSuggestions: strings(proposal?.assigneeSuggestions, directory.people),
    teamSuggestions: strings(proposal?.teamSuggestions, directory.teams),
    linkedEntitySuggestions: strings(proposal?.linkedEntitySuggestions, directory.entities),
  };
}

async function cleanupExpiredInbox(env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return { deleted: 0 };
  const token = await firebaseAdminToken(env);
  const endpoint = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const response = await fetch(`${endpoint}:runQuery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'taskLearningInbox', allDescendants: true }],
      where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'LESS_THAN', value: { stringValue: new Date().toISOString() } } },
      limit: 200,
    } }),
  });
  if (!response.ok) throw new Error('inbox-cleanup-query-failed');
  const rows = await response.json();
  const names = rows.filter(row => row.document?.name).map(row => row.document.name);
  await Promise.all(names.map(name => fetch(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })));
  return { deleted: names.length };
}

async function adminDocuments(env, token, path, pages = 1, pageSize = 1000) {
  const rows = [];
  let pageToken = '';
  for (let page = 0; page < pages; page += 1) {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}?pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      console.log('zoki-firestore-list-failed', String(path).slice(0, 80), response.status);
      break;
    }
    const body = await response.json();
    rows.push(...(body.documents || []).map(document => ({
      id: document.name.split('/').pop(),
      ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, plainValue(value)])),
    })));
    pageToken = body.nextPageToken || '';
    if (!pageToken) break;
  }
  return rows;
}

// The calendar screen (GanttChart, route /calendar) reads events_${schoolId} with
// where('year') and where('month'). Those filters came back empty in production while a bare
// list returned only the first 50 holiday-sync rows and then stopped. Walk the same collection
// by document name and keep every page until a short page arrives.
async function scanEventCollection(env, token, collectionId, parent = '') {
  const parentResource = firestoreParent(env.FIREBASE_PROJECT_ID, parent);
  const rows = [];
  let after = '';
  for (let page = 0; page < EVENT_PAGE_CAP; page += 1) {
    const structuredQuery = eventScanQuery(collectionId, after);
    const response = await fetch(`${documentsUrl(env)}:runQuery`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ parent: parentResource, structuredQuery }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.log('zoki-event-page', collectionId, page + 1, 0, 'http', response.status, detail.replace(/\s+/gu, ' ').slice(0, 120));
      break;
    }
    const body = await response.json();
    const documents = (Array.isArray(body) ? body : []).map(item => item.document).filter(Boolean);
    const fresh = documents.filter(document => document.name !== after);
    const docs = fresh.map(document => ({
      id: document.name.split('/').pop(),
      _name: document.name,
      ...Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, plainValue(value)])),
    }));
    console.log('zoki-event-page', collectionId, page + 1, documents.length, eventPageContinues(documents.length) ? 'more' : 'end', eventRawFieldSample(fresh[0]?.fields));
    rows.push(...docs);
    const lastName = fresh.at(-1)?.name || '';
    const more = eventPageContinues(documents.length) && lastName && lastName !== after;
    if (more && page === EVENT_PAGE_CAP - 1) console.log('zoki-event-page-cap', collectionId, rows.length);
    if (!more) break;
    after = lastName;
  }
  return rows;
}

async function eventsFor(env, token, schoolId) {
  const legacyId = `events_${schoolId}`;
  console.log('zoki-event-paths', legacyId, `schools/${schoolId}/events`);
  const legacy = await scanEventCollection(env, token, legacyId);
  const nested = legacy.length ? [] : await scanEventCollection(env, token, 'events', `schools/${schoolId}`);
  return { legacy, nested };
}

async function dailySchoolSnapshot(env, token, schoolId) {
  const [schoolRows, users, modernTeams, legacyTeams, modernClasses, legacyClasses, initiatives, modernEvents, legacyEvents, modernHolidays, legacyHolidays, files, modernTasks, legacyTasks, modernStudents, legacyStudents] = await Promise.all([
    adminDocuments(env, token, 'schools'),
    adminDocuments(env, token, 'users'),
    adminDocuments(env, token, `schools/${schoolId}/teams`),
    adminDocuments(env, token, `teams_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/classes`),
    adminDocuments(env, token, `classes_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/initiatives`),
    adminDocuments(env, token, `schools/${schoolId}/events`),
    adminDocuments(env, token, `events_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/holidays`),
    adminDocuments(env, token, `holidays_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/files`),
    adminDocuments(env, token, `schools/${schoolId}/tasks`),
    adminDocuments(env, token, `tasks_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/students`),
    adminDocuments(env, token, `students_${schoolId}`),
  ]);
  const merge = (...sets) => [...new Map(sets.flat().map(item => [item.id, item])).values()];
  const teams = merge(modernTeams, legacyTeams);
  const classes = merge(modernClasses, legacyClasses);
  const events = merge(modernEvents, legacyEvents);
  const holidays = merge(modernHolidays, legacyHolidays);
  const tasks = merge(modernTasks, legacyTasks);
  const students = merge(modernStudents, legacyStudents);
  const school = schoolRows.find(item => item.id === schoolId) || { id: schoolId, name: schoolId };
  const activeStaff = users.filter(item => (item.schoolId === schoolId || item.schoolIds?.includes(schoolId)) && !['disabled', 'pending', 'deleting'].includes(item.accountStatus));
  const staffName = id => activeStaff.find(item => item.id === id)?.fullName || '';
  return {
    school: { id: schoolId, name: school.name || schoolId },
    staff: activeStaff.map(item => ({
      id: item.id, name: item.fullName || item.displayName || '', jobTitle: item.jobTitle || item.roleName || '',
      teams: teams.filter(team => team.memberIds?.includes(item.id)).map(team => team.name),
      classes: classes.filter(entry => [entry.teacherId, entry.homeroomTeacherId, ...(entry.staffIds || [])].includes(item.id)).map(entry => entry.name || entry.title),
    })),
    units: [
      ...teams.map(item => ({ type: 'צוות', name: item.name, owners: (item.leaderIds || []).map(staffName).filter(Boolean), summary: item.description || '' })),
      ...classes.map(item => ({ type: 'כיתה', name: item.name || item.title, owners: [staffName(item.teacherId || item.homeroomTeacherId)].filter(Boolean), summary: item.grade || item.gradeLevel || '' })),
      ...initiatives.map(item => ({ type: 'תכנית', name: item.title, owners: [staffName(item.ownerId)].filter(Boolean), summary: item.description || item.summary || '' })),
      ...tasks.filter(item => item.status !== 'archived').map(item => ({
        type: 'משימה',
        name: item.title,
        owners: (item.assigneeIds || [item.assigneeId]).map(staffName).filter(Boolean),
        summary: [item.description, ...(item.steps || item.subtasks || []).map(step => step.title || step.name || step)].filter(Boolean).join(' · '),
      })),
    ],
    students: students.filter(item => item.status !== 'archived').map(item => ({
      name: item.fullName || [item.firstName, item.lastName].filter(Boolean).join(' '),
      className: item.className || classes.find(entry => entry.id === item.classId)?.name || '',
      grade: item.gradeLevel || item.grade || '',
      programs: item.programTypes || item.trackNames || [],
    })),
    calendar: [...events, ...holidays].map(item => ({ date: item.startDate || item.date, range: item.endDate ? `${item.startDate}–${item.endDate}` : '', title: item.name || item.title, summary: item.description || '' })),
    documents: files.map(item => ({ name: item.name, domain: item.type || item.category || '', summary: item.content || item.text || item.description || item.summary || '' })),
    patterns: [],
  };
}

// Schools whose brain is synced every day: ZOKI_SCHOOL_IDS (comma separated).
const configuredSchoolIds = env => String(env.ZOKI_SCHOOL_IDS || '').split(',').map(item => item.trim()).filter(Boolean);

async function syncConfiguredSchools(env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return { synced: 0 };
  const schoolIds = configuredSchoolIds(env);
  const token = await firebaseAdminToken(env);
  let synced = 0;
  for (const schoolId of schoolIds) {
    const snapshot = await dailySchoolSnapshot(env, token, schoolId);
    const current = await readBrain(env, schoolId);
    const generated = createSchoolBrain({ ...snapshot, generatedAt: new Date().toISOString() });
    const next = preserveApprovedPatterns(current.markdown, generated);
    const comparable = value => value.replace(/^updatedAt:.*$/gmu, 'updatedAt: <timestamp>').trim();
    if (comparable(next) !== comparable(current.markdown)) {
      await writeBrain(env, schoolId, next, 'Daily institutional knowledge sync');
      await logLearning(env, schoolId, { kind: 'סנכרון יומי', summary: 'ידע בית הספר התעדכן אוטומטית' });
      synced += 1;
    }
  }
  return { synced };
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])) } };
}

function plainValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(plainValue);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, item]) => [key, plainValue(item)]));
  return null;
}

async function firestore(request, env, path, options = {}) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`, {
    ...options,
    headers: { authorization: request.headers.get('authorization'), 'content-type': 'application/json', ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(response.status === 403 ? 'permission-denied' : 'firestore-failed');
  return response.status === 204 ? null : response.json();
}

async function actorContext(request, env, schoolId) {
  const actor = await actorFromToken(request, env);
  const document = await firestore(request, env, `users/${actor.uid}`);
  const data = Object.fromEntries(Object.entries(document.fields || {}).map(([key, value]) => [key, plainValue(value)]));
  const schools = new Set([...(data.schoolIds || []), data.schoolId].filter(Boolean));
  if (!schools.has(schoolId) || ['disabled', 'pending', 'deleting'].includes(data.accountStatus)) throw new Error('permission-denied');
  const schoolRole = data.rolesBySchool?.[schoolId] || data.role || 'viewer';
  const jobTitle = data.jobTitlesBySchool?.[schoolId] || data.jobTitle || data.roleName || '';
  return { ...actor, fullName: data.fullName || 'איש צוות', role: schoolRole, accessProfile: data.accessProfilesBySchool?.[schoolId] || null, manager: ['principal', 'institution_manager'].includes(schoolRole),
    // Shown to Zoki as "who is in front of you"; never trusted for permissions.
    person: { fullName: data.fullName || '', jobTitle, role: schoolRole, responsibilityAreas: data.responsibilityAreas || [], subjects: data.subjects || [] } };
}

async function geminiJson(env, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error('agent-not-configured');
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL || 'gemini-flash-latest'}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }),
  });
  if (!response.ok) throw new Error('agent-unavailable');
  const text = (await response.json()).candidates?.[0]?.content?.parts?.map(item => item.text || '').join('') || '';
  return JSON.parse(text.replace(/^```json\s*|```$/gu, '').trim());
}

async function saveCandidate(request, env, schoolId, actor, body) {
  const summary = await geminiJson(env, `סכם את דפוס המשימה בעברית והחזר JSON בלבד עם canonicalIntent, summary, keywords, roles, people, steps, documents, timing. אין לכלול מידע רפואי, כתובות, מספרי זהות או מידע אישי. שמות אנשים מותרים.\n\nבקשה: ${sanitizeInstitutionalText(body.request, 5000)}\nמשימה שנשמרה: ${JSON.stringify(body.savedTask || {})}`).catch(() => ({}));
  const record = learningRecord({ actor, schoolId, request: body.request, proposal: body.proposal, savedTask: body.savedTask, canonicalIntent: summary.canonicalIntent, summary: summary.summary });
  record.groupId = await fingerprint(summary.canonicalIntent || record.canonicalIntent);
  record.keywords = summary.keywords || [];
  record.roles = summary.roles || [];
  record.people = summary.people || [];
  record.steps = summary.steps || [];
  record.documents = summary.documents || [];
  record.timing = summary.timing || '';
  record.createdAt = new Date().toISOString();
  record.expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
  const id = `${record.groupId}_${actor.uid.slice(0, 18)}_${Date.now()}`;
  await firestore(request, env, `schools/${schoolId}/taskLearningInbox?documentId=${encodeURIComponent(id)}`, {
    method: 'POST', body: JSON.stringify({ fields: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, firestoreValue(value)])) }),
  });
  return { id, groupId: record.groupId };
}

async function listCandidates(request, env, schoolId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: { authorization: request.headers.get('authorization'), 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'taskLearningInbox' }], where: { fieldFilter: { field: { fieldPath: 'schoolId' }, op: 'EQUAL', value: { stringValue: schoolId } } }, limit: 100 } }),
  });
  if (!response.ok) throw new Error('firestore-failed');
  const rows = await response.json();
  const records = rows.filter(row => row.document).map(row => ({ id: row.document.name.split('/').pop(), ...Object.fromEntries(Object.entries(row.document.fields || {}).map(([key, value]) => [key, plainValue(value)])) }));
  const groups = new Map();
  records.filter(item => item.status === 'candidate').forEach(item => {
    const current = groups.get(item.groupId) || { id: item.groupId, name: item.summary, canonicalIntent: item.canonicalIntent, keywords: [], roles: [], people: [], steps: [], documents: [], timing: '', sources: [], contributors: [] };
    ['keywords', 'roles', 'people', 'steps', 'documents'].forEach(key => { current[key] = [...new Set([...current[key], ...(item[key] || [])])]; });
    current.timing ||= item.timing || '';
    current.sources.push({ id: item.id, actorId: item.actorId, actorName: item.actorName, originalText: item.originalText, taskId: item.taskId, createdAt: item.createdAt, proposal: item.proposal, savedTask: item.savedTask });
    current.contributors = [...new Set([...current.contributors, item.actorName])];
    groups.set(item.groupId, current);
  });
  return [...groups.values()].sort((a, b) => b.sources.length - a.sources.length);
}

async function deleteSources(request, env, schoolId, sourceIds) {
  await Promise.all((sourceIds || []).slice(0, 100).map(id => firestore(request, env, `schools/${schoolId}/taskLearningInbox/${encodeURIComponent(id)}`, { method: 'DELETE' })));
}

// ---- Per-user daily quota (counter written with the Worker's admin credentials; clients cannot touch it) ----
async function chargeUsage(env, actor, schoolId) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return { used: 0, limit: Infinity };
  const limit = dailyLimitFor(actor.role, env);
  const day = dayKey();
  const token = await firebaseAdminToken(env);
  const name = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/zokiUsage/${actor.uid}_${day}`;
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents:commit`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ writes: [{ update: { name, fields: { uid: { stringValue: actor.uid }, schoolId: { stringValue: schoolId }, day: { stringValue: day } } }, updateMask: { fieldPaths: ['uid', 'schoolId', 'day'] }, updateTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }] }] }),
  });
  // A broken counter must not lock everyone out; the per-minute limit of the model service still applies.
  if (!response.ok) return { used: 0, limit };
  const used = Number((await response.json()).writeResults?.[0]?.transformResults?.[0]?.integerValue || 0);
  if (used > limit) throw Object.assign(new Error('resource-exhausted'), { retryAfter: secondsToMidnight() });
  return { used, limit };
}

// ---- Learning log: what Zoki learned or changed in shared school knowledge (schoolBrain/{schoolId}/meta/learningLog) ----
const LOG_DOCUMENT = schoolId => `${brainPath(schoolId)}/meta/learningLog`;
async function readLearningLog(env, schoolId) {
  const document = await adminGet(env, LOG_DOCUMENT(schoolId));
  return { text: document ? String(fieldsOf(document).text || '') : '' };
}

// Never fails the operation that is being logged.
async function logLearning(env, schoolId, entry) {
  try {
    const { text } = await readLearningLog(env, schoolId);
    await adminCommit(env, [adminWrite(env, LOG_DOCUMENT(schoolId), { text: appendLearningLog(text, learningLogLine(entry)), updatedAt: new Date().toISOString() })]);
  } catch { /* logging is best effort */ }
}

// The user's own saved memories, read with their own token so the Firestore rules decide what is visible.
async function personalMemories(request, env, actor, schoolId) {
  try {
    const document = await firestore(request, env, `zokiAgents/${actor.uid}/scopes/${encodeURIComponent(schoolId)}`);
    return plainValue({ mapValue: { fields: document.fields || {} } }).memories || [];
  } catch { return []; }
}

// A school that has no brain yet gets one built from its current data the first time it is needed.
// Building reads every collection of the school, which is far too heavy to sit in front of an answer:
// in production it runs after the response was sent, and this turn is answered without the brain.
async function firstBrain(env, schoolId, ctx) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) return { markdown: '' };
  const current = await readBrain(env, schoolId);
  if (current.exists) return current;
  const build = async () => {
    const snapshot = await dailySchoolSnapshot(env, await adminToken(env), schoolId);
    const markdown = createSchoolBrain({ ...snapshot, generatedAt: new Date().toISOString() });
    await writeBrain(env, schoolId, markdown, 'Initial institutional knowledge', 'system').catch(() => {});
    return { markdown };
  };
  if (!ctx?.waitUntil) return build();
  ctx.waitUntil(build().catch(() => {}));
  return { markdown: '' };
}

// ---- Personal brain: one document per user and school (zokiPersonalBrain/{uid}__{schoolId}) ----
// Written only with the Worker's admin credentials and denied to every client in firestore.rules.
// Its owner reads and clears it through the Worker; nobody else, managers included, can reach it.
const personalBrainPath = (uid, schoolId) => `zokiPersonalBrain/${encodeURIComponent(`${uid}__${schoolId}`)}`;
const adminReady = env => Boolean(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
const parseJson = value => { try { return JSON.parse(value); } catch { return null; } };

async function liveSnapshot(env, actor, schoolId) {
  const token = await adminToken(env);
  const [modernTeams, legacyTeams, modernClasses, legacyClasses, modernTasks, legacyTasks, modernHolidays, legacyHolidays, loadedEvents] = await Promise.all([
    adminDocuments(env, token, `schools/${schoolId}/teams`), adminDocuments(env, token, `teams_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/classes`), adminDocuments(env, token, `classes_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/tasks`), adminDocuments(env, token, `tasks_${schoolId}`),
    adminDocuments(env, token, `schools/${schoolId}/holidays`), adminDocuments(env, token, `holidays_${schoolId}`),
    eventsFor(env, token, schoolId),
  ]);
  const merge = (...sets) => [...new Map(sets.flat().map(item => [item.id, item])).values()];
  const events = merge(loadedEvents.nested, loadedEvents.legacy);
  const snapshot = buildPersonalSnapshot({
    uid: actor.uid, user: actor.person, manager: actor.manager, teams: merge(modernTeams, legacyTeams), classes: merge(modernClasses, legacyClasses),
    tasks: merge(modernTasks, legacyTasks), events, holidays: merge(modernHolidays, legacyHolidays),
  });
  console.log('zoki-snapshot-events', 'nested', loadedEvents.nested.length, 'legacy', loadedEvents.legacy.length, 'kept', snapshot.events.length);
  return snapshot;
}

// A masked update fails when the document does not exist yet, so the first write creates it whole.
async function writePersonalFields(env, actor, schoolId, fields, { exists, mask }) {
  const write = adminWrite(env, personalBrainPath(actor.uid, schoolId), { uid: actor.uid, schoolId, ...fields });
  if (!exists) {
    await adminCommit(env, [write]);
    return;
  }
  await adminCommit(env, [{ ...write, updateMask: { fieldPaths: ['uid', 'schoolId', ...mask] } }]);
}

function logProfile(action, path, profile, keys = []) {
  const focus = profile?.focus?.[0]?.text || '';
  console.log('zoki-profile', action, path, keys.join(',') || '-', profile?.turns ?? '', profile?.preferences?.length || 0, profile?.focus?.length || 0, profile?.facts?.length || 0, String(profile?.preferences?.[0] || '').slice(0, 60), String(profile?.facts?.[0] || '').slice(0, 60), String(focus).slice(0, 60));
}

async function saveSnapshot(env, actor, schoolId) {
  const next = await liveSnapshot(env, actor, schoolId);
  // Re-read here. The document may have gained a profile while the event queries were in flight,
  // and a create would replace that profile with the snapshot alone.
  const path = personalBrainPath(actor.uid, schoolId);
  const current = await adminGet(env, path);
  await writePersonalFields(env, actor, schoolId, { snapshot: JSON.stringify(next) }, { exists: Boolean(current), mask: ['snapshot'] });
  return next;
}

// Returns { profile, snapshot }. A failure here must never fail the answer: Zoki then simply answers without the personal layer.
// A snapshot that already exists can refresh after the response. The first turn has none, so it is built
// before the answer — otherwise Zoki says it cannot see tasks or the calendar.
async function personalBrainFor(env, actor, schoolId, { ctx } = {}) {
  if (!adminReady(env)) return { profile: emptyProfile(), snapshot: null };
  try {
    const document = await adminGet(env, personalBrainPath(actor.uid, schoolId));
    const stored = fieldsOf(document);
    const profile = sanitizeProfile(parseJson(stored.profile));
    logProfile('read', personalBrainPath(actor.uid, schoolId), profile, Object.keys(stored));
    let snapshot = parseJson(stored.snapshot);
    const fresh = snapshot?.at && Date.now() - Date.parse(snapshot.at) < SNAPSHOT_TTL_MS;
    if (!fresh) {
      if (!snapshot) {
        try { snapshot = await saveSnapshot(env, actor, schoolId); }
        catch (error) { console.error('zoki-snapshot-failed', String(error?.message || error).slice(0, 160)); }
      } else {
        const renew = saveSnapshot(env, actor, schoolId).catch(error => {
          console.error('zoki-snapshot-refresh-failed', String(error?.message || error).slice(0, 160));
        });
        if (ctx?.waitUntil) ctx.waitUntil(renew);
        else await renew;
      }
    }
    return { profile, snapshot };
  } catch (error) {
    console.error('zoki-personal-brain-failed', String(error?.message || error).slice(0, 160));
    return { profile: emptyProfile(), snapshot: null };
  }
}

async function saveProfile(env, actor, schoolId, profile, snapshot) {
  const path = personalBrainPath(actor.uid, schoolId);
  const current = await adminGet(env, path);
  // A create replaces the whole document. Keep the snapshot that was just built, or the
  // next turn would remember the conversation and forget the tasks and the calendar.
  const fields = { profile: JSON.stringify(profile), updatedAt: new Date().toISOString() };
  if (!current && snapshot) fields.snapshot = JSON.stringify(snapshot);
  await writePersonalFields(env, actor, schoolId, fields, { exists: Boolean(current), mask: ['profile', 'updatedAt'] });
  logProfile('write', path, profile, Object.keys(fields));
}

// The user's own "Zoki learns about me" switch (zokiAgents/{uid}.learningEnabled, on unless they turned it off).
async function learningEnabled(request, env, actor) {
  try { return plainValue((await firestore(request, env, `zokiAgents/${actor.uid}`)).fields?.learningEnabled || { booleanValue: true }) !== false; }
  catch { return true; }
}

// After the answer is on its way, Zoki rereads the exchange and updates what it knows about this user.
// Failures are logged (Workers Logs) and never change the answer the user already received.
async function reflectOnTurn(request, env, actor, schoolId, { profile, snapshot, messages, reply, learningOn }) {
  try {
    if (!adminReady(env) || !env.ANTHROPIC_API_KEY) {
      console.log('zoki-reflection-skip', 'not-configured');
      return;
    }
    const lastUser = [...(messages || [])].reverse().find(item => item?.role === 'user')?.content || '';
    if (String(lastUser).trim().length < 8) {
      console.log('zoki-reflection-skip', 'short-turn');
      return;
    }
    // Decided before waitUntil when the caller already checked, so learning does not depend on
    // the incoming request still being readable after the answer was sent.
    const enabled = typeof learningOn === 'boolean' ? learningOn : await learningEnabled(request, env, actor);
    if (!enabled) {
      console.log('zoki-reflection-skip', 'learning-off');
      return;
    }
    // Read again here. The profile from the start of the turn can still be the previous
    // conversation, and a model rewrite must not throw away what this user just said.
    const latest = fieldsOf(await adminGet(env, personalBrainPath(actor.uid, schoolId)));
    const base = sanitizeProfile(parseJson(latest.profile) || profile);
    const keptSnapshot = parseJson(latest.snapshot) || snapshot;
    if (!buildReflectionRequest({ profile: base, messages, reply, role: actor.person?.jobTitle || actor.role, model: 'm' })) {
      console.log('zoki-reflection-skip', 'no-user-text');
      return;
    }
    console.log('zoki-reflection-start', base.turns);
    let response = null;
    try {
      response = await callClaude(env, buildReflectionRequest({ profile: base, messages, reply, role: actor.person?.jobTitle || actor.role, model: env.CLAUDE_MODEL || 'claude-haiku-5-5' }));
    } catch (error) {
      console.log('zoki-reflection-claude-failed', String(error?.message || error).slice(0, 160));
      console.error('zoki-reflection-claude-failed', String(error?.message || error).slice(0, 160));
    }
    const next = mergeLearnedProfile(base, response, messages);
    try {
      await saveProfile(env, actor, schoolId, next, keptSnapshot);
      console.log('zoki-reflection-saved', profileIsEmpty(next) ? 'empty' : 'profile', next.turns, next.preferences.length, next.focus.length, next.facts.length);
    } catch (error) {
      console.log('zoki-reflection-save-failed', String(error?.message || error).slice(0, 160));
      console.error('zoki-reflection-save-failed', String(error?.message || error).slice(0, 160));
    }
  } catch (error) {
    console.log('zoki-reflection-failed', String(error?.message || error).slice(0, 160));
    console.error('zoki-reflection-failed', String(error?.message || error).slice(0, 160));
  }
}

// School knowledge for this turn: the institutional brain, without student data unless the user may see it.
async function schoolContextFor(request, env, schoolId, actor, query, held, ctx) {
  const [brain, memories] = await Promise.all([
    firstBrain(env, schoolId, ctx).catch(() => ({ markdown: '' })),
    personalMemories(request, env, actor, schoolId),
  ]);
  const canSeeStudents = actor.manager || held.includes('students.view');
  return buildSchoolContext({ markdown: brain.markdown, query, canSeeStudents, memories });
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true });
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const schoolId = sanitizeInstitutionalText(body.schoolId || url.searchParams.get('schoolId'), 128);
  if (!schoolId) throw new Error('school-required');
  await verifyAppCheck(request, env);
  const actor = await actorContext(request, env, schoolId);

  if (url.pathname === '/v1/zoki/turn' && request.method === 'POST') {
    // The role comes from the user's stored access profile, never from the request.
    const roleId = actor.accessProfile?.presetId || (actor.manager ? 'pedagogical_coordinator' : '');
    const profile = roleAgentProfile(roleId) || roleAgentProfile('secretary');
    // ZOKI_PROVIDER: "local" = school model only, "claude" = Claude only, anything else = Claude first, school model as the fallback.
    const usage = await chargeUsage(env, actor, schoolId);
    const held = heldCapabilities(actor.accessProfile);
    const offered = offeredCapabilityKeys(held, body.permissionKeys);
    const lastQuestion = [...(body.messages || [])].reverse().find(item => item?.role === 'user')?.content || '';
    const claudeOnly = env.ZOKI_PROVIDER === 'claude';
    const claudeWanted = Boolean(env.ANTHROPIC_API_KEY) && env.ZOKI_PROVIDER !== 'local';
    // Past the user's own Claude allowance (or when Claude is down or out of credit) the answer comes from the school model.
    const claudeAllowed = claudeWanted && (claudeOnly || usage.used <= claudeLimitFor(actor.role, env));
    const [schoolContext, personal] = await Promise.all([
      schoolContextFor(request, env, schoolId, actor, lastQuestion, held, ctx),
      personalBrainFor(env, actor, schoolId, { ctx }),
    ]);
    if (claudeAllowed) {
      try {
        const merged = [schoolContext, body.context].filter(Boolean).join('\n\n');
        const claudeRequest = buildClaudeRequest({ profile, messages: body.messages, context: merged, personal: buildPersonalContext(personal), heldKeys: offered, model: env.CLAUDE_MODEL || 'claude-haiku-5-5' });
        const turned = await runClaudeRounds({
          request: claudeRequest,
          call: payload => callClaude(env, payload),
          context: { events: personal.snapshot?.events || [], tasks: personal.snapshot?.tasks || [] },
        });
        turned.proposals = [...turned.proposals.filter(item => !V1_TOOLS[item.tool]), ...guardProposals(lastQuestion, turned.proposals)];
        const parsed = turned;
        const note = teachingNote(lastQuestion);
        const reply = replyWithStoredMemory(withoutMilestoneRetraction(parsed.reply, body.context || ''), note);
        const result = { ...parsed, reply };
        if (result.reply || result.proposals.length) {
          // The switch is read now; the Claude reflection itself runs after the answer is on its way.
          const learningOn = await learningEnabled(request, env, actor);
          // Do not call reflectOnTurn before waitUntil. Starting it now opens the Claude
          // request during this turn, and the runtime then holds the answer until that call ends.
          const learn = () => reflectOnTurn(request, env, actor, schoolId, {
            profile: personal.profile, snapshot: personal.snapshot, messages: body.messages, reply: result.reply, learningOn,
          });
          console.log('zoki-turn-result', String(result.reply || '').length, (result.proposals || []).map(item => item.tool).join(',') || '-');
          console.log('zoki-reflection-scheduled');
          if (ctx?.waitUntil) ctx.waitUntil(Promise.resolve().then(learn));
          else await learn();
          return json({ ...result, agent: profile.name, provider: 'claude' }, 200, cors(request, env));
        }
      } catch (error) {
        if (claudeOnly || !localModelConfigured(env)) throw error;
        console.warn('claude-fallback', String(error?.message || '').slice(0, 60));
      }
    }
    if (localModelConfigured(env) && !claudeOnly) {
      // The school model has a small context window: the personal layer goes first, in its short form.
      const context = [compactPersonalContext(personal), schoolContext].filter(Boolean).join('\n\n');
      const payload = buildLocalRequest({ messages: body.messages, context });
      // An instruction becomes a proposal the user approves; a question streams straight from the model.
      const tools = toolSpecs(allowedTools(profile, held), TOOL_SCHEMAS);
      if (tools.length && looksLikeAction(lastQuestion)) {
        const proposal = validatedProposal(await routeLocalAction(env, { message: lastQuestion, tools, context }), tools.map(item => item.name), TOOL_SCHEMAS);
        if (proposal) {
          const note = proposal.missing.length ? `כדי להכין את הפעולה חסר: ${proposal.missing.join(', ')}.` : 'הכנתי הצעה. אפשר לאשר אותה או לתקן.';
          return json({ reply: note, proposals: proposal.missing.length ? [] : [{ id: `p_${Date.now()}`, tool: proposal.tool, input: proposal.input }], stopReason: '', sources: [], agent: profile.name }, 200, cors(request, env));
        }
      }
      if (body.stream === true) {
        // Pass the model's token stream straight through so the browser can show the answer as it is written.
        const upstream = await streamLocalTiered(env, payload);
        return new Response(upstream, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no', ...cors(request, env) } });
      }
      return json({ ...parseLocalResponse(await askLocalTiered(env, payload)), agent: profile.name }, 200, cors(request, env));
    }
    throw new Error('agent-not-configured');
  }
  // What Zoki knows about the person asking. Only ever the caller's own brain: there is no way to name another user.
  if (url.pathname === '/v1/zoki/personal-brain' && request.method === 'GET') {
    const personal = await personalBrainFor(env, actor, schoolId, { ctx });
    const learned = profileText(personal.profile);
    return json({ profile: personal.profile, empty: profileIsEmpty(personal.profile), snapshot: [learned, snapshotText(personal.snapshot)].filter(Boolean).join('\n\n'), learningEnabled: await learningEnabled(request, env, actor) }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/zoki/personal-brain/clear' && request.method === 'POST') {
    if (!adminReady(env)) throw new Error('agent-not-configured');
    await saveProfile(env, actor, schoolId, emptyProfile());
    return json({ ok: true }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/draft' && request.method === 'POST') {
    const { markdown } = await readBrain(env, schoolId);
    const context = relevantBrainContext(markdown, body.request);
    const generatedProposal = await geminiJson(env, `אתה סוכן משימות של מוסד חינוכי. החזר JSON בלבד עם title, description, taskType, priority, dueDate, assigneeSuggestions, teamSuggestions, linkedEntitySuggestions, subtasks, completionCriteria, followUpQuestion, reasoningSummary, domain, commonDocuments. אין לבצע פעולה בפועל. השתמש רק באנשי צוות שמופיעים במוח.\n\nמוח מוסדי:\n${context}\n\nבקשת המשתמש:\n${sanitizeInstitutionalText(body.request, 1800)}`);
    const proposal = validatedAgentProposal(generatedProposal, markdown);
    return json({ proposal, sessionId: `worker_${Date.now()}`, capabilities: { canAssign: actor.manager, collaborationMode: actor.manager ? 'assign' : 'invite' }, degraded: false }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/learning/capture' && request.method === 'POST') {
    const result = await saveCandidate(request, env, schoolId, actor, body);
    await logLearning(env, schoolId, { kind: 'נלמד דפוס מועמד', actor: actor.fullName, summary: body.savedTask?.title || body.request });
    return json({ ok: true, ...result }, 200, cors(request, env));
  }
  if (!actor.manager) throw new Error('permission-denied');
  if (url.pathname === '/v1/task-agent/candidates' && request.method === 'GET') return json({ patterns: await listCandidates(request, env, schoolId) }, 200, cors(request, env));
  if (url.pathname === '/v1/task-agent/learning-log' && request.method === 'GET') return json({ markdown: (await readLearningLog(env, schoolId)).text }, 200, cors(request, env));
  if (url.pathname === '/v1/task-agent/brain' && request.method === 'GET') return json(await readBrain(env, schoolId), 200, cors(request, env));
  if (url.pathname === '/v1/task-agent/brain/history' && request.method === 'GET') return json({ versions: await brainHistory(env, schoolId) }, 200, cors(request, env));
  if (url.pathname === '/v1/task-agent/brain/preview' && request.method === 'POST') {
    const { markdown } = await readBrain(env, schoolId);
    const next = upsertApprovedPattern(markdown, { ...body.pattern, id: body.pattern?.id || await fingerprint(body.pattern?.canonicalIntent || body.pattern?.name) });
    return json({ markdown: next, previousLength: markdown.length, nextLength: next.length }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/brain/publish' && request.method === 'POST') {
    const pattern = { ...body.pattern, id: body.pattern?.id || await fingerprint(body.pattern?.canonicalIntent || body.pattern?.name) };
    const { markdown } = await readBrain(env, schoolId);
    const next = upsertApprovedPattern(markdown, pattern);
    const result = await writeBrain(env, schoolId, next, `Approve task pattern: ${sanitizeInstitutionalText(pattern.name, 80) || pattern.id}`, actor.fullName);
    await deleteSources(request, env, schoolId, body.sourceIds);
    await logLearning(env, schoolId, { kind: 'דפוס אושר', actor: actor.fullName, summary: pattern.name || pattern.canonicalIntent });
    return json({ ok: true, commitSha: result.commit?.sha || '' }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/candidates/reject' && request.method === 'POST') {
    await deleteSources(request, env, schoolId, body.sourceIds);
    await logLearning(env, schoolId, { kind: 'דפוס נדחה', actor: actor.fullName, summary: `נדחו ${(body.sourceIds || []).length} מקורות` });
    return json({ ok: true }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/brain/sync' && request.method === 'POST') {
    const current = await readBrain(env, schoolId);
    const generated = createSchoolBrain({ ...(body.snapshot || {}), school: { ...(body.snapshot?.school || {}), id: schoolId }, generatedAt: new Date().toISOString() });
    const markdown = preserveApprovedPatterns(current.markdown, generated);
    const result = await writeBrain(env, schoolId, markdown, 'Sync institutional knowledge', actor.fullName);
    await logLearning(env, schoolId, { kind: 'סנכרון ידע', actor: actor.fullName, summary: 'ידע בית הספר עודכן מהנתונים הנוכחיים' });
    return json({ ok: true, commitSha: result.commit?.sha || '' }, 200, cors(request, env));
  }
  if (url.pathname === '/v1/task-agent/brain/restore' && request.method === 'POST') {
    if (!/^\d{10,16}$/u.test(body.sha || '')) throw new Error('invalid-version');
    const result = await restoreBrain(env, schoolId, body.sha, actor.fullName);
    await logLearning(env, schoolId, { kind: 'שחזור ידע', actor: actor.fullName, summary: `שוחזרה גרסה ${body.sha.slice(0, 8)}` });
    return json({ ok: true, commitSha: result.commit?.sha || '' }, 200, cors(request, env));
  }
  throw new Error('not-found');
}

export default {
  async fetch(request, env, ctx) {
    try { return await handle(request, env, ctx); }
    catch (error) {
      const code = error?.message || 'internal-error';
      // Path and error code only: never request bodies, tokens or school data.
      console.warn('worker-error', new URL(request.url).pathname, String(code).slice(0, 120));
      const status = ['unauthenticated', 'invalid-app-check'].includes(code) ? 401 : code === 'permission-denied' ? 403 : code === 'not-found' ? 404 : code === 'resource-exhausted' ? 429 : 400;
      return json({ error: code, ...(error?.retryAfter ? { retryAfter: error.retryAfter } : {}) }, status, cors(request, env));
    }
  },
  async scheduled(_event, env, context) {
    context.waitUntil(Promise.all([cleanupExpiredInbox(env), syncConfiguredSchools(env)]));
  },
};
