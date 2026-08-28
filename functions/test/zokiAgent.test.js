import assert from 'node:assert/strict';
import test from 'node:test';
import { requestGeminiZokiAnswer, requestGeminiZokiFileText } from '../src/services/geminiZoki.js';
import { scopeAllows } from '../src/services/permissionEngine.js';

test('Zoki sends only pre-authorized sources and requires source-bound JSON', async () => {
  let requestBody = null;
  const result = await requestGeminiZokiAnswer({
    apiKey: 'test-key',
    model: 'test-model',
    question: 'באיזו כיתה לומדת נועה?',
    history: [{ role: 'user', text: 'אני שואל על נועה' }, { role: 'assistant', text: 'באיזה נושא?' }],
    context: {
      adminInstructions: 'השב בקצרה.',
      denied: [],
      sources: [{ id: 'student:1', type: 'student', label: 'נועה', route: '/students', fields: { fullName: 'נועה', className: 'ח1' } }],
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return { candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'נועה לומדת בכיתה ח1.', sourceIds: ['student:1'], followUpQuestion: null }) }] } }] };
        },
      };
    },
  });

  const providerInput = JSON.parse(requestBody.contents[0].parts[0].text);
  assert.deepEqual(providerInput.authorizedSources.map(source => source.id), ['student:1']);
  assert.equal(providerInput.schoolInstructions, 'השב בקצרה.');
  assert.deepEqual(providerInput.conversationHistory.map(item => item.role), ['user', 'assistant']);
  assert.equal(requestBody.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(result.sourceIds, ['student:1']);
});

test('class-scoped authorization never permits another class', () => {
  const scope = { type: 'classes', values: ['class_a'] };
  assert.equal(scopeAllows(scope, { classId: 'class_a' }, 'teacher_1'), true);
  assert.equal(scopeAllows(scope, { classId: 'class_b' }, 'teacher_1'), false);
});

test('Zoki sends an authorized scan as bounded inline data for text extraction', async () => {
  let requestBody = null;
  const image = Buffer.from('fake-png-bytes');
  const result = await requestGeminiZokiFileText({
    apiKey: 'test-key', model: 'test-model', fileName: 'אישור.png', mimeType: 'image/png', buffer: image,
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'אישור מנהל לטיול' }] } }] }) };
    },
  });

  assert.equal(requestBody.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(requestBody.contents[0].parts[1].inlineData.data, image.toString('base64'));
  assert.equal(requestBody.generationConfig.responseMimeType, 'text/plain');
  assert.match(requestBody.systemInstruction.parts[0].text, /untrusted data/u);
  assert.equal(result, 'אישור מנהל לטיול');
});
