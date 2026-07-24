import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createCvPdf, safeCvFilename } from '../../src/services/cvPdfService.js';

const entry = (title, description) => ({
  title, subtitle: '', organization: 'זוקו', period: '2025–2026', description,
  bullets: ['עבודה בטוחה ומדויקת', 'עמידה בזמנים ושיתוף פעולה'],
  category: '', level: '', quote: '', contact: '', link: '',
});

test('generates a searchable Hebrew A4 PDF with embedded font, RTL content and page breaks', async () => {
  const [normal, bold] = await Promise.all([
    readFile('public/fonts/NotoSansHebrew-Regular.ttf'),
    readFile('public/fonts/NotoSansHebrew-Bold.ttf'),
  ]);
  const longEntries = Array.from({ length: 18 }, (_, index) => entry(`ניסיון מקצועי ${index + 1}`, 'תיאור ניסיון מעשי בעברית ללא חיתוך של שורות או המצאת מידע.'));
  const snapshot = {
    personal: { fullName: 'יוסי לוי', professionalTitle: 'טכנאי מערכות', phone: '050-0000000', email: 'yossi@example.test', city: 'תל אביב', birthDate: '', professionalLink: 'https://example.test/profile', photoPath: '' },
    summary: 'איש מקצוע אחראי בעל ניסיון מעשי, יכולת למידה ועבודה בצוות.',
    education: [entry('בית הספר עתיד עוצמ״ה', 'לימודים מקצועיים')],
    experiences: longEntries, practicalExperience: [], projects: [],
    skills: [entry('אבחון תקלות', '')], credentials: [entry('הכשרת בטיחות', '')],
    recommendations: [entry('מנהל עבודה', 'עובד אחראי ומסור')], languages: [],
    sectionOrder: ['summary', 'experiences', 'recommendations', 'skills', 'credentials', 'education', 'languages'],
    hiddenSections: [],
    design: { templateId: 'classic_professional', templateName: 'קלאסי מקצועי', accentColor: '#607D8B', showPhoto: false, sidebarSections: ['skills', 'credentials', 'education', 'languages'] },
  };
  const result = await createCvPdf(snapshot, { fontBytes: { normal, bold }, generatedAt: new Date('2026-07-23T00:00:00Z') });
  const bytes = new Uint8Array(result.arrayBuffer);
  const pdfStructure = new TextDecoder('latin1').decode(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  assert.ok(bytes.length > 10_000);
  assert.ok(result.pageCount >= 2);
  assert.match(pdfStructure, /\/ToUnicode/);
  assert.match(pdfStructure, /mailto:yossi@example\.test/);
  assert.match(pdfStructure, /https:\/\/example\.test\/profile/);
  assert.equal(result.filename, 'קורות-חיים_יוסי-לוי_2026-07-23.pdf');
  assert.equal(safeCvFilename('../שם/מסוכן', new Date('2026-07-23T00:00:00Z')).includes('/'), false);
  await writeFile('/tmp/zoko-cv-hebrew-test.pdf', bytes);
});
