const CV_SECTION_LABELS = Object.freeze({
  summary: 'קצת עליי', experiences: 'ניסיון תעסוקתי',
  practicalExperience: 'ניסיון מעשי', projects: 'פרויקטים',
  recommendations: 'המלצות', skills: 'מיומנויות', credentials: 'הסמכות',
  education: 'השכלה', languages: 'שפות',
});

const FONT_PATHS = Object.freeze({
  normal: '/fonts/NotoSansHebrew-Regular.ttf',
  bold: '/fonts/NotoSansHebrew-Bold.ttf',
});
const PAGE = Object.freeze({ width: 210, height: 297, margin: 13, sidebarWidth: 70, bottom: 14 });

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  if (!globalThis.btoa) throw new Error('Base64 encoding is unavailable.');
  return globalThis.btoa(binary);
}

async function loadFont(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Unable to load the embedded Hebrew font.');
  return new Uint8Array(await response.arrayBuffer());
}

function safeColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(value || '') ? value : '#607D8B';
}

function hexToRgb(value) {
  const hex = safeColor(value).slice(1);
  return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
}

function lighten(value, ratio = 0.82) {
  return hexToRgb(value).map(channel => Math.round(channel + (255 - channel) * ratio));
}

function safeUrl(value, email = false) {
  const text = String(value || '').trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${text}`;
  if (/^https?:\/\//i.test(text)) return text;
  return '';
}

export function safeCvFilename(fullName, date = new Date()) {
  const name = String(fullName || 'תלמיד')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'תלמיד';
  const day = date.toISOString().slice(0, 10);
  return `קורות-חיים_${name}_${day}.pdf`;
}

function entries(snapshot, sectionId) {
  return Array.isArray(snapshot[sectionId]) ? snapshot[sectionId] : [];
}

export async function createCvPdf(snapshot, { fontBytes, generatedAt = new Date() } = {}) {
  const { jsPDF } = await import('jspdf');
  const [normal, bold] = fontBytes
    ? [fontBytes.normal, fontBytes.bold]
    : await Promise.all([loadFont(FONT_PATHS.normal), loadFont(FONT_PATHS.bold)]);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true });
  doc.addFileToVFS('NotoSansHebrew-Regular.ttf', bytesToBase64(normal));
  doc.addFileToVFS('NotoSansHebrew-Bold.ttf', bytesToBase64(bold));
  doc.addFont('NotoSansHebrew-Regular.ttf', 'NotoSansHebrew', 'normal');
  doc.addFont('NotoSansHebrew-Bold.ttf', 'NotoSansHebrew', 'bold');
  doc.setFont('NotoSansHebrew', 'normal');
  doc.setR2L(true);
  doc.setDocumentProperties({
    title: `קורות חיים — ${snapshot.personal.fullName || 'תלמיד'}`,
    subject: 'קורות חיים',
    creator: 'Zoko-Master',
  });

  const accent = safeColor(snapshot.design?.accentColor);
  const sidebarBg = lighten(accent);
  const pages = [{ sideY: PAGE.margin, mainY: PAGE.margin }];
  function paintPage(pageNumber) {
    doc.setPage(pageNumber);
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, PAGE.width, PAGE.height, 'F');
    doc.setFillColor(...sidebarBg);
    doc.rect(PAGE.width - PAGE.sidebarWidth, 0, PAGE.sidebarWidth, PAGE.height, 'F');
  }
  paintPage(1);
  function ensurePage(pageIndex) {
    while (doc.getNumberOfPages() <= pageIndex) {
      doc.addPage('a4', 'portrait');
      pages.push({ sideY: PAGE.margin, mainY: PAGE.margin });
      paintPage(doc.getNumberOfPages());
    }
  }
  function allocate(column, estimate, currentPage) {
    let pageIndex = currentPage;
    ensurePage(pageIndex);
    const key = column === 'side' ? 'sideY' : 'mainY';
    if (pages[pageIndex][key] + estimate > PAGE.height - PAGE.bottom) {
      pageIndex += 1;
      ensurePage(pageIndex);
    }
    return pageIndex;
  }
  function columnMetrics(column) {
    return column === 'side'
      ? { right: PAGE.width - 8, left: PAGE.width - PAGE.sidebarWidth + 8, width: PAGE.sidebarWidth - 16 }
      : { right: PAGE.width - PAGE.sidebarWidth - 9, left: PAGE.margin, width: PAGE.width - PAGE.sidebarWidth - PAGE.margin - 9 };
  }
  function writeLines(text, column, pageIndex, options = {}) {
    const key = column === 'side' ? 'sideY' : 'mainY';
    const metrics = columnMetrics(column);
    const fontSize = options.fontSize || 9;
    const lineHeight = options.lineHeight || fontSize * 0.42;
    doc.setPage(pageIndex + 1);
    doc.setFont('NotoSansHebrew', options.bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(...(options.color || [38, 50, 56]));
    const lines = doc.splitTextToSize(String(text || ''), metrics.width);
    lines.forEach(line => {
      pageIndex = allocate(column, lineHeight + 1, pageIndex);
      doc.setPage(pageIndex + 1);
      doc.text(line, metrics.right, pages[pageIndex][key], { align: 'right', baseline: 'top' });
      pages[pageIndex][key] += lineHeight;
    });
    pages[pageIndex][key] += options.after ?? 1.2;
    return pageIndex;
  }
  function heading(label, column, pageIndex) {
    pageIndex = allocate(column, 10, pageIndex);
    const key = column === 'side' ? 'sideY' : 'mainY';
    const metrics = columnMetrics(column);
    doc.setPage(pageIndex + 1);
    doc.setFont('NotoSansHebrew', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(38, 50, 56);
    doc.text(label, metrics.right, pages[pageIndex][key], { align: 'right', baseline: 'top' });
    pages[pageIndex][key] += 5.5;
    doc.setDrawColor(...hexToRgb(accent));
    doc.setLineWidth(0.35);
    doc.line(metrics.left, pages[pageIndex][key], metrics.right, pages[pageIndex][key]);
    pages[pageIndex][key] += 3.5;
    return pageIndex;
  }
  function renderEntry(entry, column, pageIndex) {
    if (entry.title) pageIndex = writeLines(entry.title, column, pageIndex, { bold: true, fontSize: 9.3, after: 0.3 });
    const subline = [entry.subtitle, entry.organization, entry.period].filter(Boolean).join(' · ');
    if (subline) pageIndex = writeLines(subline, column, pageIndex, { fontSize: 7.8, color: [84, 110, 122], after: 0.7 });
    if (entry.description) pageIndex = writeLines(entry.description, column, pageIndex, { fontSize: 8.2, after: 0.8 });
    if (entry.quote) pageIndex = writeLines(`“${entry.quote}”`, column, pageIndex, { fontSize: 8.2, color: [69, 90, 100], after: 0.8 });
    for (const bullet of entry.bullets || []) pageIndex = writeLines(`• ${bullet}`, column, pageIndex, { fontSize: 8, after: 0.25 });
    const link = safeUrl(entry.link);
    if (link) {
      const key = column === 'side' ? 'sideY' : 'mainY';
      const metrics = columnMetrics(column);
      doc.setPage(pageIndex + 1);
      doc.setR2L(false);
      doc.setFontSize(7.5);
      doc.setTextColor(21, 101, 192);
      doc.textWithLink(entry.link, metrics.left, pages[pageIndex][key], { url: link });
      doc.setR2L(true);
      pages[pageIndex][key] += 4;
    }
    return pageIndex;
  }
  function renderSection(sectionId, column, pageIndex) {
    if (sectionId === 'summary') {
      if (!snapshot.summary) return pageIndex;
      pageIndex = heading(CV_SECTION_LABELS[sectionId], column, pageIndex);
      return writeLines(snapshot.summary, column, pageIndex, { fontSize: 9, lineHeight: 4.2, after: 2 });
    }
    const values = entries(snapshot, sectionId);
    if (values.length === 0) return pageIndex;
    pageIndex = heading(CV_SECTION_LABELS[sectionId], column, pageIndex);
    for (const entry of values) pageIndex = renderEntry(entry, column, pageIndex);
    return pageIndex;
  }

  let sidePage = 0;
  sidePage = writeLines(snapshot.personal.fullName || 'שם התלמיד', 'side', sidePage, { bold: true, fontSize: 20, lineHeight: 7.8, after: 1 });
  if (snapshot.personal.professionalTitle) sidePage = writeLines(snapshot.personal.professionalTitle, 'side', sidePage, { bold: true, fontSize: 10, color: hexToRgb(accent), after: 3 });
  const contacts = [
    ['phone', snapshot.personal.phone, ''],
    ['email', snapshot.personal.email, safeUrl(snapshot.personal.email, true)],
    ['city', snapshot.personal.city, ''],
    ['link', snapshot.personal.professionalLink, safeUrl(snapshot.personal.professionalLink)],
  ].filter(([, value]) => value);
  for (const [kind, value, link] of contacts) {
    if (kind === 'city') sidePage = writeLines(value, 'side', sidePage, { fontSize: 7.6, after: 0.6 });
    else {
      sidePage = allocate('side', 4.2, sidePage);
      const metrics = columnMetrics('side');
      const y = pages[sidePage].sideY;
      doc.setPage(sidePage + 1);
      doc.setR2L(false);
      doc.setFont('NotoSansHebrew', 'normal');
      doc.setFontSize(7.2);
      doc.setTextColor(kind === 'link' || kind === 'email' ? 21 : 69, kind === 'link' || kind === 'email' ? 101 : 90, kind === 'link' || kind === 'email' ? 192 : 100);
      const display = String(value).length > 42 ? `${String(value).slice(0, 39)}…` : String(value);
      doc.text(display, metrics.right, y, { align: 'right', baseline: 'top' });
      if (link) doc.link(metrics.left, y, metrics.width, 4, { url: link });
      doc.setR2L(true);
      pages[sidePage].sideY += 4.2;
    }
  }
  pages[sidePage].sideY += 2;
  const hidden = new Set(snapshot.hiddenSections || []);
  const sidebarSections = new Set(snapshot.design?.sidebarSections || []);
  const sectionOrder = (snapshot.sectionOrder || []).filter(sectionId => !hidden.has(sectionId));
  for (const sectionId of sectionOrder.filter(sectionId => sidebarSections.has(sectionId))) sidePage = renderSection(sectionId, 'side', sidePage);
  let mainPage = 0;
  for (const sectionId of sectionOrder.filter(sectionId => !sidebarSections.has(sectionId))) mainPage = renderSection(sectionId, 'main', mainPage);
  for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
    doc.setPage(page);
    doc.setFont('NotoSansHebrew', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(130, 145, 155);
    doc.setR2L(false);
    doc.text(`${page}/${doc.getNumberOfPages()}`, PAGE.margin, PAGE.height - 6);
    doc.setR2L(true);
  }
  const arrayBuffer = doc.output('arraybuffer');
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  return {
    blob,
    arrayBuffer,
    pageCount: doc.getNumberOfPages(),
    filename: safeCvFilename(snapshot.personal.fullName, generatedAt),
  };
}

export function downloadPdfBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
