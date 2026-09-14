import { createRequire } from 'node:module';
import { PilotError } from './client.mjs';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
export const FILE_LIMITS = Object.freeze({ bytes: 20 * 1024 * 1024, pages: 100, rows: 10000, extractedBytes: 8 * 1024 * 1024 });
const fail = code => { throw new PilotError(code); };
export function parseCsv(input) {
  const lines = []; let row = [], value = '', quoted = false;
  const first = input.split(/\r?\n/)[0];
  const delimiter = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === delimiter || c === '\n' || c === '\r')) {
      row.push(value); value = '';
      if (c !== delimiter) { lines.push(row); row = []; if (c === '\r' && input[i + 1] === '\n') i++; }
    } else value += c;
  }
  if (quoted) fail('invalid-csv');
  if (value || row.length) { row.push(value); lines.push(row); }
  if (lines.length > FILE_LIMITS.rows) fail('too-many-rows');
  return lines;
}
export async function extractPilotFile(file, recognize) {
  try { return await extractFile(file, recognize); }
  catch (error) { if (error instanceof PilotError) throw error; throw new PilotError('file-read-failed'); }
}
async function extractFile({ name, base64 }, recognize) {
  if (typeof name !== 'string' || name.length > 250 || typeof base64 !== 'string' || base64.length > Math.ceil(FILE_LIMITS.bytes * 4 / 3) + 4) fail('invalid-file');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail('invalid-file');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > FILE_LIMITS.bytes) fail('file-too-large');
  const ext = name.split('.').pop().toLowerCase();
  let pages;
  if (ext === 'csv') pages = [{ sheet: name, rows: parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')).map((values, index) => ({ row: index + 1, values })) }];
  else if (ext === 'xlsx') {
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    if (entries.length > 3000 || entries.reduce((sum, file) => sum + (file._data?.uncompressedSize || 0), 0) > 100 * 1024 * 1024) fail('expanded-file-too-large');
    const ExcelJS = require('exceljs'); const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes); let count = 0; pages = [];
    for (const sheet of book.worksheets) {
      const rows = [];
      sheet.eachRow((row, number) => {
        if (++count > FILE_LIMITS.rows) fail('too-many-rows');
        const cells = [];
        row.eachCell((cell, column) => {
          let value = cell.value; let warning;
          if (value instanceof Date) value = value.toISOString().slice(0, 10);
          else if (value && typeof value === 'object') {
            if ('formula' in value || 'sharedFormula' in value) { warning = value.result == null ? 'formula-without-cached-value' : undefined; value = value.result ?? null; }
            else if (value.richText) value = value.richText.map(part => part.text).join('');
            else value = value.text ?? cell.text;
          }
          // Cached formulas may themselves return Date objects. Normalize them
          // after unwrapping, just like literal Excel dates.
          if (value instanceof Date) value = value.toISOString().slice(0, 10);
          cells.push({ column, cell: cell.address, value, ...(warning ? { warning } : {}), ...(cell.isMerged ? { mergedFrom: cell.master.address } : {}) });
        });
        rows.push({ row: number, cells });
      });
      pages.push({ sheet: sheet.name, rows });
    }
  } else if (ext === 'pdf') {
    if (!bytes.subarray(0,1024).includes('%PDF-')) fail('invalid-file');
    const { PDFParse } = require('pdf-parse'); const parser = new PDFParse({ data: new Uint8Array(bytes) });
    try {
      const info = await parser.getInfo(); if (info.total > FILE_LIMITS.pages) fail('too-many-pages');
      const text = await parser.getText(); pages = [];
      for (const page of text.pages) {
        if (page.text.trim().length > 60) pages.push({ page: page.num, text: page.text });
        else {
          const image = await parser.getScreenshot({ partial: [page.num], scale: 1.5 });
          const data = image.pages[0];
          if (!data) fail('pdf-page-unreadable');
          pages.push({ page: page.num, text: await recognize(data.dataUrl || `data:image/png;base64,${Buffer.from(data.data).toString('base64')}`), visual: true });
        }
      }
    } finally { await parser.destroy(); }
  } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
    if ((ext === 'png' && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (['jpg','jpeg'].includes(ext) && !(bytes[0] === 255 && bytes[1] === 216)) || (ext === 'webp' && !(bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP'))) fail('invalid-file');
    pages = [{ page: 1, text: await recognize(`data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`), visual: true }];
  } else fail('unsupported-file');
  if (Buffer.byteLength(JSON.stringify(pages)) > FILE_LIMITS.extractedBytes) fail('extracted-file-too-large');
  return { name, pages };
}
