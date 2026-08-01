import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_COMMUNICATION_TEMPLATES,
  COMMUNICATION_TEMPLATE_SCOPE,
  renderCommunicationTemplate,
  sanitizeCommunicationTemplate,
} from '../../src/services/firestore/communicationTemplateRepository.js';

test('built-in communication templates are bounded, immutable presets', () => {
  assert.equal(BUILTIN_COMMUNICATION_TEMPLATES.length, 10);
  assert.equal(BUILTIN_COMMUNICATION_TEMPLATES.every(template => (
    template.builtin === true
      && template.scope === COMMUNICATION_TEMPLATE_SCOPE.BUILTIN
      && Object.isFrozen(template)
  )), true);
});

test('communication template variables render only from the explicit allowlist', () => {
  const rendered = renderCommunicationTemplate({
    subjectTemplate: 'עדכון: {{context}} — {{unknown}}',
    bodyTemplate: 'שלום {{name}}, מטעם {{organization}} בנושא {{subject}}.',
  }, {
    name: 'דנה',
    organization: 'בית הספר',
    subject: 'הטיול',
    context: 'אישור הורים',
    unknown: 'אסור',
  });
  assert.equal(rendered.subject, 'עדכון: אישור הורים — {{unknown}}');
  assert.equal(rendered.body, 'שלום דנה, מטעם בית הספר בנושא הטיול.');
});

test('communication templates reject empty bodies and normalize unsupported tones', () => {
  assert.throws(() => sanitizeCommunicationTemplate({ name: 'ריקה', bodyTemplate: '' }, 'private'));
  const template = sanitizeCommunicationTemplate({
    name: ' תזכורת ',
    bodyTemplate: ' תוכן ',
    tone: 'unsafe-tone',
  }, 'private');
  assert.equal(template.name, 'תזכורת');
  assert.equal(template.bodyTemplate, 'תוכן');
  assert.equal(template.tone, 'respectful');
});
