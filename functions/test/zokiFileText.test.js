import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { extractAuthorizedFileText, extractInlineFileText, htmlToPlainText, selectRelevantText } from '../src/services/zokiFileText.js';

function fakeStorage(buffer, contentType) {
  return { bucket: () => ({ file: () => ({
    getMetadata: async () => [{ size: buffer.length, contentType }],
    download: async () => [buffer],
  }) }) };
}

function simplePdf(value) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${value.length + 31} >>\nstream\nBT /F1 18 Tf 72 720 Td (${value}) Tj ET\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => { body += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

test('Zoki converts in-app documents to bounded plain text', () => {
  const result = extractInlineFileText({ fileType: 'document', content: '<h1>נוהל טיולים</h1><script>secret()</script><p>יש לקבל אישור מנהל.</p>' });
  assert.match(result, /נוהל טיולים/u);
  assert.match(result, /יש לקבל אישור מנהל/u);
  assert.equal(result.includes('secret'), false);
  assert.equal(htmlToPlainText('&lt;תקין&gt;'), '<תקין>');
});

test('Zoki extracts searchable cell values from an in-app spreadsheet', () => {
  const result = extractInlineFileText({
    fileType: 'spreadsheet',
    content: JSON.stringify({ headers: { A: 'תלמיד' }, cells: { A1: { value: 'נועה' }, B1: { value: '94', formula: '=90+4' } } }),
  });
  assert.match(result, /תלמיד/u);
  assert.match(result, /A1: נועה/u);
  assert.match(result, /B1: 94 \| נוסחה =90\+4/u);
});

test('Zoki selects a relevant passage from a long file instead of only its beginning', () => {
  const content = `${'פתיח כללי '.repeat(500)}\nהציון של נועה הוא 94 במתמטיקה.\n${'נספח '.repeat(500)}`;
  const result = selectRelevantText(content, 'מה הציון של נועה במתמטיקה?');
  assert.match(result, /הציון של נועה הוא 94/u);
  assert.ok(result.length <= 5000);
});

test('uploaded text is read only from the selected school storage prefix', async () => {
  let downloads = 0;
  const storage = { bucket: () => ({ file: () => ({
    getMetadata: async () => [{ size: 30, contentType: 'text/plain' }],
    download: async () => { downloads += 1; return [Buffer.from('נוהל בטיחות מעודכן')]; },
  }) }) };
  const allowed = await extractAuthorizedFileText({
    file: { fileType: 'upload', name: 'rules.txt', storagePath: 'schools/school_a/folder/rules.txt', size: 30 },
    schoolId: 'school_a', question: 'נוהל בטיחות', storage,
  });
  const denied = await extractAuthorizedFileText({
    file: { fileType: 'upload', name: 'rules.txt', storagePath: 'schools/school_b/folder/rules.txt', size: 30 },
    schoolId: 'school_a', question: 'נוהל בטיחות', storage,
  });
  assert.match(allowed, /נוהל בטיחות/u);
  assert.equal(denied, '');
  assert.equal(downloads, 1);
});

test('Zoki OCR reads only an authorized bounded image upload', async () => {
  const image = Buffer.from('small-authorized-image');
  let extractorInput = null;
  const result = await extractAuthorizedFileText({
    file: { fileType: 'upload', name: 'סריקת-אישור.png', type: 'image/png', storagePath: 'schools/school_a/files/approval.png', size: image.length },
    schoolId: 'school_a', question: 'מה כתוב באישור?', storage: fakeStorage(image, 'image/png'),
    imageTextExtractor: async input => {
      extractorInput = input;
      return 'אישור יציאה לטיול בתאריך 12.9';
    },
  });

  assert.equal(extractorInput.mimeType, 'image/png');
  assert.deepEqual(extractorInput.buffer, image);
  assert.match(result, /אישור יציאה לטיול/u);

  let unauthorizedCalls = 0;
  const denied = await extractAuthorizedFileText({
    file: { fileType: 'upload', name: 'secret.png', type: 'image/png', storagePath: 'schools/school_b/files/secret.png', size: image.length },
    schoolId: 'school_a', question: 'מה כתוב?', storage: fakeStorage(image, 'image/png'),
    imageTextExtractor: async () => { unauthorizedCalls += 1; return 'אסור'; },
  });
  assert.equal(denied, '');
  assert.equal(unauthorizedCalls, 0);
});

test('Zoki extracts text from uploaded PDF, Word, Excel and PowerPoint files', async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('ציונים').addRow(['Noa', 94]);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

  const docxArchive = new JSZip();
  docxArchive.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  docxArchive.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  docxArchive.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Zoki Word rule</w:t></w:r></w:p></w:body></w:document>');
  const docx = await docxArchive.generateAsync({ type: 'nodebuffer' });

  const pptxArchive = new JSZip();
  pptxArchive.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Zoki presentation rule</a:t></p:sld>');
  const pptx = await pptxArchive.generateAsync({ type: 'nodebuffer' });

  const cases = [
    { name: 'score.pdf', type: 'application/pdf', buffer: simplePdf('Zoki PDF score 94'), expected: /score 94/u },
    { name: 'rules.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx, expected: /Word rule/u },
    { name: 'scores.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx, expected: /Noa.*94/u },
    { name: 'rules.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: pptx, expected: /presentation rule/u },
  ];
  for (const item of cases) {
    const result = await extractAuthorizedFileText({
      file: { fileType: 'upload', name: item.name, type: item.type, storagePath: `schools/school_a/files/${item.name}`, size: item.buffer.length },
      schoolId: 'school_a', question: 'Zoki rule score Noa', storage: fakeStorage(item.buffer, item.type),
    });
    assert.match(result, item.expected, `${item.name}: ${result}`);
  }
});
