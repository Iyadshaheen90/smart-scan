// A small PDF maker (text and lines on US Letter pages), with no library so it works offline.
// The Theft Report's Print / Save PDF uses it: the iPhone home-screen app ignores window.print()
// (owner 2026-10-23), but it can share a PDF file, and the share sheet has Print and Save to Files.
// Positions are in points from the top-left corner (612 × 792 a page).
//   const pdf = new SimplePdf(); pdf.text(40, 50, 'Hi', { size: 18, bold: true }); pdf.line(40, 60, 572, 60);
//   pdf.addPage(); … pdf.blob()

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;

class SimplePdf {
  constructor() {
    this.pages = [];
    this.addPage();
    // Arial has the same letter widths as Helvetica (the PDF's font), so it measures right-aligned text.
    this.measure = document.createElement('canvas').getContext('2d');
  }

  addPage() {
    this.page = [];
    this.pages.push(this.page);
  }

  width(str, size = 10, bold = false) {
    this.measure.font = `${bold ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
    return (this.measure.measureText(str).width / 100) * size;
  }

  // align: 'left' (x is the start), 'right' (x is the end) or 'center'. gray: 0 black … 1 white.
  text(x, y, str, { size = 10, bold = false, align = 'left', gray = 0 } = {}) {
    const w = align === 'left' ? 0 : this.width(str, size, bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.page.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${gray} g ${num(left)} ${num(PDF_PAGE_HEIGHT - y)} Td (${pdfString(str)}) Tj ET`);
  }

  line(x1, y1, x2, y2, { width = 0.5, gray = 0.6 } = {}) {
    this.page.push(`${gray} G ${width} w ${num(x1)} ${num(PDF_PAGE_HEIGHT - y1)} m ${num(x2)} ${num(PDF_PAGE_HEIGHT - y2)} l S`);
  }

  // The finished file. Every character is one byte (WinAnsi), so string lengths are the byte offsets.
  blob() {
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };
    const catalog = add('');
    const pagesId = add('');
    const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = this.pages.map((ops) => {
      const content = ops.join('\n');
      const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] `
        + `/Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${stream} 0 R >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets = objects.map((body, i) => {
      const at = out.length;
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
      return at;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((at) => { out += `${String(at).padStart(10, '0')} 00000 n \n`; });
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i);
    return new Blob([bytes], { type: 'application/pdf' });
  }
}

function num(n) {
  return Number(n.toFixed(2)).toString();
}

// Text for a PDF string: ( ) \ escaped, and each character turned into its WinAnsi byte (– and — aren't
// in Latin-1 where they'd be expected; anything the font can't show becomes ?).
function pdfString(str) {
  const winAnsi = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85 };
  return [...String(str)].map((ch) => {
    const code = winAnsi[ch] || ch.charCodeAt(0);
    const c = String.fromCharCode(code > 255 ? 63 : code);
    return c === '(' || c === ')' || c === '\\' ? `\\${c}` : c;
  }).join('');
}
