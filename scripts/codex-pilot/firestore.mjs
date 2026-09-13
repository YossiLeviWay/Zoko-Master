import { PilotError } from './client.mjs';
export function decodeValue(value) {
  if ('nullValue' in value) return null;
  if ('mapValue' in value) return decodeFields(value.mapValue.fields);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('integerValue' in value) return Number(value.integerValue);
  return value.stringValue ?? value.booleanValue ?? value.doubleValue ?? value.timestampValue;
}
export const decodeFields = (fields = {}) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
export function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  throw new PilotError('invalid-value');
}
export const encodeFields = fields => Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
export const safeId = id => typeof id === 'string' && /^[\w-]{1,128}$/.test(id);
export class UserFirestore {
  constructor({ projectId, token, fetchImpl = fetch }) {
    if (!safeId(projectId) || typeof token !== 'string') throw new PilotError('invalid-session');
    this.base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    this.prefix = `projects/${projectId}/databases/(default)/documents/`;
    if (projectId.startsWith('demo-') && /^(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) this.base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents`;
    this.token = token; this.fetch = fetchImpl;
  }
  async request(path, body) {
    const response = await this.fetch(`${this.base}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new PilotError(response.status === 403 ? 'permission-denied' : response.status === 401 ? 'session-expired' : response.status === 409 ? 'data-changed' : 'firebase-unavailable');
    return response.json();
  }
  async get(path) {
    const value = await this.request(`/${path}`);
    return value ? { path, id: path.split('/').pop(), data: decodeFields(value.fields), version: value.updateTime } : null;
  }
  async list(path, where) {
    const segments = path.split('/'); const collectionId = segments.pop(); const parent = segments.length ? `/${segments.join('/')}` : '';
    const result = await this.request(`${parent}:runQuery`, { structuredQuery: { from: [{ collectionId }], ...(where ? { where: { fieldFilter: { field: { fieldPath: where.field }, op: where.op, value: encodeValue(where.value) } } } : {}), limit: 10001 } });
    const rows = (result || []).filter(item => item.document).map(({ document }) => ({ path: document.name.slice(this.prefix.length), id: document.name.split('/').pop(), data: decodeFields(document.fields), version: document.updateTime }));
    if (rows.length > 10000) throw new PilotError('context-too-large');
    return rows;
  }
  async actor(schoolId) {
    let uid;
    try { uid = JSON.parse(Buffer.from(this.token.split('.')[1], 'base64url').toString()).sub; } catch { throw new PilotError('invalid-session'); }
    if (!safeId(uid) || !safeId(schoolId)) throw new PilotError('invalid-session');
    // Firebase authenticates the token. Decoding a subject alone never grants access.
    const record = await this.get(`users/${uid}`); const data = record?.data;
    if (!data || ![data.schoolId, ...(data.schoolIds || [])].includes(schoolId) || (data.accountStatus && data.accountStatus !== 'active') || !['principal', 'institution_manager'].includes(data.rolesBySchool?.[schoolId] || data.role)) throw new PilotError('permission-denied');
    return { uid, schoolId, fullName: data.fullName || '', role: data.rolesBySchool?.[schoolId] || data.role };
  }
  async commit(changes) {
    return this.request(':commit', { writes: changes.map(change => ({ update: { name: `${this.prefix}${change.path}`, fields: encodeFields(change.patch || change.data) }, ...(change.patch ? { updateMask: { fieldPaths: Object.keys(change.patch).map(key => '`' + key + '`') } } : {}), currentDocument: change.version ? { updateTime: change.version } : { exists: false }, ...(change.timestamps?.length ? { updateTransforms: change.timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}) })) });
  }
}
