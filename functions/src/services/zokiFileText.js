import { adminStorage } from './firebaseAdmin.js';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 1_000_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const extractionCache = new Map();
const OCR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);
const MIME_BY_EXTENSION = Object.freeze({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' });

const text = value => typeof value === 'string' ? value : value == null ? '' : String(value);

function normalize(value, max = MAX_EXTRACTED_CHARS) {
  return text(value).replace(/\0/gu, '').replace(/\r\n?/gu, '\n').replace(/[\t ]+/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim().slice(0, max);
}

function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match;
    const hexadecimal = entity[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match; } catch { return match; }
  });
}

export function htmlToPlainText(value) {
  return normalize(decodeEntities(text(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replace(/<\/?(?:p|div|br|li|tr|h[1-6]|table|section|article)\b[^>]*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')));
}

function spreadsheetText(content) {
  let data = content;
  if (typeof content === 'string') {
    try { data = JSON.parse(content); } catch { return normalize(content); }
  }
  if (!data || typeof data !== 'object') return '';
  const lines = [];
  Object.entries(data.headers || {}).slice(0, 500).forEach(([key, value]) => {
    const label = typeof value === 'object' ? value?.value || value?.label : value;
    if (label != null && String(label).trim()) lines.push(`כותרת ${key}: ${String(label).trim()}`);
  });
  Object.entries(data.cells || {}).slice(0, 10_000).forEach(([reference, cell]) => {
    const value = typeof cell === 'object' ? cell?.value : cell;
    const formula = typeof cell === 'object' ? cell?.formula : '';
    const parts = [value, formula && formula !== value ? `נוסחה ${formula}` : ''].filter(part => part != null && String(part).trim());
    if (parts.length) lines.push(`${reference}: ${parts.join(' | ')}`);
  });
  return normalize(lines.join('\n'));
}

export function extractInlineFileText(file = {}) {
  if (file.fileType === 'document') return htmlToPlainText(file.content);
  if (file.fileType === 'spreadsheet') return spreadsheetText(file.content);
  return normalize(file.content || file.text || file.plainText || file.summary || '');
}

function extension(file) {
  const match = text(file.name).toLowerCase().match(/\.([a-z0-9]+)$/u);
  return match?.[1] || '';
}

function mayNeedOcr(file) {
  const ext = extension(file);
  const declaredType = text(file.type).toLowerCase();
  return OCR_MIME_TYPES.has(declaredType) || Boolean(MIME_BY_EXTENSION[ext]);
}

async function pdfText(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try { return normalize((await parser.getText()).text); }
  finally { await parser.destroy().catch(() => undefined); }
}

async function docxText(buffer) {
  const mammoth = await import('mammoth');
  return normalize((await mammoth.extractRawText({ buffer })).value);
}

function excelCellText(cell) {
  if (cell?.text) return cell.text;
  if (cell?.value && typeof cell.value === 'object') return cell.value.result ?? cell.value.text ?? '';
  return cell?.value ?? '';
}

async function xlsxText(buffer) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'drawing', 'picture', 'conditionalFormatting'] });
  const lines = [];
  let cells = 0;
  workbook.eachSheet(sheet => {
    if (cells >= 10_000) return;
    lines.push(`גיליון: ${sheet.name}`);
    sheet.eachRow((row, rowNumber) => {
      if (cells >= 10_000) return;
      const values = [];
      row.eachCell((cell, columnNumber) => {
        if (cells >= 10_000) return;
        const value = normalize(excelCellText(cell), 500);
        if (value) values.push(`${columnNumber}=${value}`);
        cells += 1;
      });
      if (values.length) lines.push(`שורה ${rowNumber}: ${values.join(' | ')}`);
    });
  });
  return normalize(lines.join('\n'));
}

async function officeXmlText(buffer, prefix) {
  const JSZip = (await import('jszip')).default;
  const archive = await JSZip.loadAsync(buffer);
  const names = Object.keys(archive.files).filter(name => name.startsWith(prefix) && name.endsWith('.xml')).sort().slice(0, 300);
  const xmlParts = await Promise.all(names.map(name => archive.file(name)?.async('string')));
  return normalize(xmlParts.filter(Boolean).map(htmlToPlainText).join('\n'));
}

async function storedFileText({ file, schoolId, storage, imageTextExtractor }) {
  const path = text(file.storagePath);
  if (!path || !path.startsWith(`schools/${schoolId}/`)) return '';
  const stored = storage.bucket().file(path);
  const [metadata] = await stored.getMetadata();
  const size = Number(metadata.size || file.size || 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) return '';
  const [buffer] = await stored.download();
  const ext = extension(file);
  const declaredType = text(file.type || metadata.contentType).toLowerCase();
  const type = OCR_MIME_TYPES.has(declaredType) ? declaredType : (MIME_BY_EXTENSION[ext] || declaredType);
  if (type.startsWith('text/') || ['csv', 'tsv', 'txt', 'md', 'json', 'xml', 'html', 'htm'].includes(ext)) return normalize(buffer.toString('utf8'));
  if (type === 'application/pdf' || ext === 'pdf') {
    const extracted = await pdfText(buffer).catch(() => '');
    if (extracted) return extracted;
    return imageTextExtractor ? normalize(await imageTextExtractor({ buffer, mimeType: 'application/pdf', fileName: file.name })) : '';
  }
  if (type.includes('wordprocessingml') || ext === 'docx') return docxText(buffer);
  if (type.includes('spreadsheetml') || ext === 'xlsx') return xlsxText(buffer);
  if (type.includes('presentationml') || ext === 'pptx') return officeXmlText(buffer, 'ppt/slides/slide');
  if (ext === 'odt') return officeXmlText(buffer, 'content.xml');
  if (OCR_MIME_TYPES.has(type) && imageTextExtractor) return normalize(await imageTextExtractor({ buffer, mimeType: type, fileName: file.name }));
  return '';
}

function terms(question) {
  return [...new Set(normalize(question, 2000).toLocaleLowerCase('he-IL').split(/[^\p{L}\p{N}]+/gu).filter(word => word.length > 1))];
}

export function selectRelevantText(value, question, max = 5000) {
  const content = normalize(value);
  if (!content) return '';
  const chunks = [];
  for (let index = 0; index < content.length; index += 700) chunks.push({ index, text: content.slice(index, index + 850) });
  const queryTerms = terms(question);
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: queryTerms.reduce((total, term) => total + (chunk.text.toLocaleLowerCase('he-IL').includes(term) ? 1 : 0), 0),
  }));
  const matches = scored.filter(chunk => chunk.score > 0).sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 7);
  const selected = (matches.length ? matches : chunks.slice(0, 7)).sort((left, right) => left.index - right.index);
  return normalize(selected.map(chunk => chunk.text).join('\n…\n'), max);
}

export async function extractAuthorizedFileText({ file, schoolId, question, storage = adminStorage, imageTextExtractor }) {
  const inline = extractInlineFileText(file);
  if (inline) return selectRelevantText(inline, question);
  if (file.fileType !== 'upload' || !file.storagePath) return '';
  const cacheKey = `${file.storagePath}:${text(file.lastModified || file.updatedAt || file.size)}`;
  const cached = extractionCache.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return selectRelevantText(cached.text, question);
  try {
    const extracted = await storedFileText({ file, schoolId, storage, imageTextExtractor });
    // Do not cache a skipped OCR attempt (for example the fourth image in a
    // single request), so a later, more relevant question can still read it.
    if (extracted || imageTextExtractor || !mayNeedOcr(file)) {
      extractionCache.set(cacheKey, { text: extracted, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    if (extractionCache.size > 100) extractionCache.delete(extractionCache.keys().next().value);
    return selectRelevantText(extracted, question);
  } catch {
    return '';
  }
}
