/** @fileoverview Build a short, paginated PDF for a human-reviewed tutor cover handover. */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const BODY_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = rgb(0.09, 0.15, 0.23);
const MUTED = rgb(0.35, 0.42, 0.5);
const ACCENT = rgb(0.13, 0.37, 0.4);

function safeText(value, font) {
  return [...`${value || ''}`].map((character) => {
    try { font.encodeText(character); return character; } catch { return '?'; }
  }).join('').replace(/\s+/gu, ' ').trim();
}

function wrap(text, font, size, width) {
  const words = safeText(text, font).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const proposal = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(proposal, size) <= width) {
      line = proposal;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (font.widthOfTextAtSize(line, size) > width) {
      let cut = line.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export async function createCoverHandoverPdf(handover = {}) {
  const doc = await PDFDocument.create();
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Cover handover ${handover.coverDate || ''}`);
  doc.setSubject('Reviewed teaching handover for a substitute tutor');
  const pages = [];
  let page;
  let y;

  function addPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - MARGIN;
    page.drawText('FIRST CHORD  /  COVER HANDOVER', { x: MARGIN, y, font: boldFont, size: 9, color: ACCENT });
    y -= 27;
    page.drawText(safeText(`${handover.coverDate || ''}  |  For ${handover.coverTutorName || 'cover tutor'}`, boldFont), {
      x: MARGIN, y, font: boldFont, size: 16, color: INK,
    });
    y -= 18;
    page.drawText('Teaching context from the six weeks before this lesson. Check the source notes if anything is unclear.', {
      x: MARGIN, y, font: bodyFont, size: 8.5, color: MUTED,
    });
    y -= 15;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: ACCENT });
    y -= 25;
  }

  addPage();
  for (const student of handover.students || []) {
    const heading = safeText(`${student.lessonTime || ''}  ${student.studentName || ''}${student.instrument ? `  |  ${student.instrument}` : ''}`, boldFont);
    const lines = wrap(`${student.summary || ''}`.slice(0, 700), bodyFont, 9.5, BODY_WIDTH);
    const evidence = student.evidence?.length
      ? `Source notes: ${student.evidence.map((item) => `${item.date} (${item.source})`).join(', ')}`
      : 'No recent source notes found';
    const evidenceLines = wrap(evidence, bodyFont, 7.5, BODY_WIDTH);
    const blockHeight = 17 + lines.length * 13 + 7 + evidenceLines.length * 10 + 17;
    if (y - blockHeight < MARGIN + 25) addPage();
    page.drawText(heading, { x: MARGIN, y, font: boldFont, size: 11, color: INK });
    y -= 18;
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, font: bodyFont, size: 9.5, color: INK });
      y -= 13;
    }
    y -= 5;
    for (const line of evidenceLines) {
      page.drawText(line, { x: MARGIN, y, font: bodyFont, size: 7.5, color: MUTED });
      y -= 10;
    }
    y -= 16;
  }
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({ start: { x: MARGIN, y: 43 }, end: { x: PAGE_WIDTH - MARGIN, y: 43 }, thickness: 0.5, color: MUTED });
    currentPage.drawText('Private teaching handover. Review before sharing with the named cover tutor.', {
      x: MARGIN, y: 29, font: bodyFont, size: 7.5, color: MUTED,
    });
    currentPage.drawText(`${index + 1} / ${pages.length}`, { x: PAGE_WIDTH - MARGIN - 24, y: 29, font: bodyFont, size: 7.5, color: MUTED });
  });
  return doc.save();
}
