// A small .xlsx reader, so Schedulers' Excel files import as they are, without a
// spreadsheet library. An .xlsx is a zip of XML files: this unzips the entries it
// needs with the browser's own DecompressionStream and reads each sheet's cells as
// text. Dates and times come back as Excel serial numbers; the importer reads those.

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

async function inflate(bytes) {
  const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** The zip's files as { path: () => Promise<string> }. */
function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This isn’t an Excel (.xlsx) file.');
  const files = {};
  let p = u32(b, eocd + 16);
  const count = u16(b, eocd + 10);
  const text = new TextDecoder();
  for (let n = 0; n < count && u32(b, p) === 0x02014b50; n++) {
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const skip = nameLen + u16(b, p + 30) + u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = text.decode(b.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    files[name] = async () => text.decode(method === 0 ? raw : await inflate(raw));
    p += 46 + skip;
  }
  return files;
}

const unescape = (s) => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : Number(k.slice(1)));
  return { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }[k];
});
// All the <t> text inside one shared or inline string (rich text has several runs).
const texts = (xml) => unescape([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '';
const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;

function readSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(rm[1], 'r')) - 1;
    const row = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const type = attr(cm[1], 't');
      const body = cm[2] || '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = '';
      if (type === 's') val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = texts(body);
      else if (type === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v != null) val = unescape(v);
      row[ref ? colIndex(ref) : row.length] = val;
    }
    rows[r >= 0 ? r : rows.length] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x || []);
}

/** Every sheet in the workbook, in order: [{ name, rows: string[][] }]. */
export async function readXlsx(buf) {
  const files = unzip(buf);
  if (!files['xl/workbook.xml']) throw new Error('This isn’t an Excel (.xlsx) file.');
  const book = await files['xl/workbook.xml']();
  const rels = files['xl/_rels/workbook.xml.rels'] ? await files['xl/_rels/workbook.xml.rels']() : '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const shared = files['xl/sharedStrings.xml'] ? [...(await files['xl/sharedStrings.xml']()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  const out = [];
  for (const m of book.matchAll(/<sheet\b[^>]*>/g)) {
    const t = target.get(attr(m[0], 'r:id')) || '';
    const path = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
    if (!files[path]) continue;
    out.push({ name: unescape(attr(m[0], 'name')), rows: readSheet(await files[path](), shared) });
  }
  return out;
}

/** The sheet named `prefer` (any case), or else the first one. */
export const pickSheet = (sheets, prefer) => sheets.find((s) => s.name.trim().toLowerCase() === String(prefer).toLowerCase()) || sheets[0] || { name: '', rows: [] };
