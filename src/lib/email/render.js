import { FIELD_LABEL, FONT, TAG_STYLE, isBlockField, isFieldId, isSecretField, fieldLinkText } from './blocks.js';
import { LIGHT, toDark } from './palette.js';

// Turning a template into an email, as in Project Atlas: clean what the editor
// or a paste produced, put the values in, and wrap it in the Centific header and
// footer. Lotus sends the result through the shared mailbox; it can also be
// copied as rich text for Outlook.

const DROP = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'meta', 'link', 'title', 'head', 'svg', 'math', 'form',
  'input', 'button', 'select', 'textarea', 'video', 'audio', 'canvas', 'template', 'noscript', 'base', 'xml',
]);
const KEEP = new Set([
  'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'a', 'h1', 'h2', 'h3',
  'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'img', 'hr', 'blockquote', 'sup', 'sub',
]);
const ATTRS = new Set([
  'style', 'href', 'src', 'alt', 'width', 'height', 'align', 'valign', 'colspan', 'rowspan', 'role', 'border',
  'cellpadding', 'cellspacing', 'data-field', 'data-block', 'target', 'rel', 'title',
]);
const SAFE_HREF = /^(https?:|mailto:|tel:)/i;
const SAFE_SRC = /^(https:|data:image\/(png|jpe?g|gif|webp);base64,)/i;
const UNSAFE_STYLE = /expression\s*\(|javascript:|url\s*\(|behavior\s*:|-moz-binding/i;
const HEADINGS = { h4: 'h3', h5: 'h3', h6: 'h3' };

function cleanNode(node, doc) {
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase();
    if (DROP.has(tag)) { child.remove(); continue; }
    let el = child;
    if (HEADINGS[tag] || tag === 'font') {
      // Old or deep tags: keep the text in the nearest tag we support.
      const next = doc.createElement(HEADINGS[tag] ?? 'span');
      const color = tag === 'font' ? child.getAttribute('color') : null;
      if (color && /^#?[0-9a-z]+$/i.test(color)) next.setAttribute('style', `color:${color};`);
      while (child.firstChild) next.appendChild(child.firstChild);
      child.replaceWith(next);
      el = next;
    } else if (!KEEP.has(tag)) {
      // Unknown wrapper (Word's o:p, section ...): keep its children.
      cleanNode(child, doc);
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      const ok = ATTRS.has(name)
        && !(name === 'href' && !SAFE_HREF.test(value))
        && !(name === 'src' && !SAFE_SRC.test(value))
        && !(name === 'style' && UNSAFE_STYLE.test(value))
        && !(name === 'data-field' && !isFieldId(value));
      if (!ok) el.removeAttribute(attr.name);
    }
    const field = el.getAttribute('data-field');
    if (isFieldId(field)) {
      // A field chip is one token: always its label, never edited inside.
      el.textContent = FIELD_LABEL[field];
      el.setAttribute('contenteditable', 'false');
      continue;
    }
    if (el.tagName.toLowerCase() === 'a') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    }
    const base = TAG_STYLE[el.tagName.toLowerCase()];
    if (base && !el.getAttribute('style')) el.setAttribute('style', base);
    cleanNode(el, doc);
  }
}

const parse = (html) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');

/** Keep only safe, email-friendly HTML; bare tags get the template's default styles. */
export function sanitize(html) {
  const doc = parse(html);
  // Comments (Word's <!--[if ...]> blocks, StartFragment markers) never belong in an email.
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
  cleanNode(doc.body, doc);
  return doc.body.innerHTML;
}

const missing = (doc, id) => {
  const mark = doc.createElement('span');
  mark.setAttribute('style', `background-color:${LIGHT.field}; border-radius:4px; padding:0 3px;`);
  mark.textContent = `[${FIELD_LABEL[id]}]`;
  return mark;
};

/** Put the values in. Text fields become text; block fields (tables, lists) become their HTML. Empty ones stay a visible [Label]. */
export function fillFields(html, values) {
  const doc = parse(html);
  for (const chip of Array.from(doc.body.querySelectorAll('[data-field]'))) {
    const id = chip.getAttribute('data-field');
    if (!isFieldId(id)) { chip.remove(); continue; }
    const value = values[id];
    if (isBlockField(id)) {
      const holder = chip.parentElement?.getAttribute('data-block') === 'field' ? chip.parentElement : chip;
      if (value) {
        const tmp = doc.createElement('div');
        tmp.innerHTML = value;
        holder.replaceWith(...Array.from(tmp.childNodes));
      } else holder.replaceWith(missing(doc, id));
      continue;
    }
    const text = String(value ?? '').trim();
    const words = fieldLinkText(id);
    if (words && /^https?:/i.test(text)) {
      // Emails never show a raw address: the link reads as words.
      const a = doc.createElement('a');
      a.setAttribute('href', text);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
      a.setAttribute('style', TAG_STYLE.a);
      a.textContent = words;
      chip.replaceWith(a);
      continue;
    }
    chip.replaceWith(text ? doc.createTextNode(text) : missing(doc, id));
  }
  return doc.body.innerHTML;
}

export function fillSubject(subject, values) {
  return subject.replace(/\{(\w+)\}/g, (whole, id) => {
    if (!isFieldId(id) || isBlockField(id)) return whole;
    if (isSecretField(id)) return ''; // a password never goes in a subject line
    return String(values[id] ?? '').trim() || `[${FIELD_LABEL[id]}]`;
  });
}

/** For an email a flow fills in: every field chip becomes a {{field}} token the flow replaces. */
export function toTokens(html) {
  const doc = parse(html);
  for (const chip of Array.from(doc.body.querySelectorAll('[data-field]'))) {
    const id = chip.getAttribute('data-field');
    chip.replaceWith(doc.createTextNode(isFieldId(id) ? `{{${id}}}` : ''));
  }
  return doc.body.innerHTML;
}

/** The whole email: Centific header with the project name, the framed body, and the footer. */
export function buildEmail(body, mode = 'light', logoSrc = null) {
  const logo = logoSrc
    ? `<td valign="middle" style="padding-right:12px; line-height:0;"><img src="${logoSrc}" alt="Centific" width="40" height="40" style="display:block; width:40px; height:40px; border:0;"></td>`
    : '';
  const html = `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%; background-color:${LIGHT.page}; border-collapse:collapse;"><tbody><tr><td align="center" style="padding:28px 12px;">`
    + `<table role="presentation" border="0" cellspacing="0" cellpadding="0" width="600" style="width:100%; max-width:600px; background-color:${LIGHT.card}; border-radius:14px; border-collapse:separate;"><tbody>`
    + `<tr><td align="center" style="padding:28px 24px 20px; border-bottom:1px solid ${LIGHT.frameLine};">`
    + `<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto;"><tbody><tr>${logo}`
    + `<td valign="middle" style="font-family:${FONT}; font-size:26px; font-weight:700; letter-spacing:-0.02em; line-height:1; color:${LIGHT.logo};">Centific</td></tr></tbody></table>`
    + `<p style="margin:10px 0 0; font-family:${FONT}; font-size:11px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:${LIGHT.accent};">Project Lotus</p>`
    + '</td></tr>'
    + `<tr><td style="padding:16px;"><table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%; background-color:${LIGHT.frame}; border:1px solid ${LIGHT.frameLine}; border-radius:10px; border-collapse:separate;"><tbody><tr><td style="padding:30px 36px 28px; font-family:${FONT}; font-size:15px; line-height:1.6; color:${LIGHT.body};">${body}</td></tr></tbody></table></td></tr>`
    + `<tr><td align="center" style="padding:6px 36px 28px;"><p style="margin:0; font-family:${FONT}; font-size:11px; line-height:1.5; letter-spacing:0.04em; color:${LIGHT.muted};">© Centific · Project Lotus</p></td></tr>`
    + '</tbody></table></td></tr></tbody></table>';
  return mode === 'dark' ? toDark(html) : html;
}

const logoCache = new Map();

/** The Centific mark as a PNG in one colour (dark grey for light mode, white for dark). */
export function tintedLogo(src, color) {
  const key = `${src}|${color}`;
  if (logoCache.has(key)) return logoCache.get(key);
  const made = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 96;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, size, size);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, size, size);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  logoCache.set(key, made);
  return made;
}

/** Plain-text version, for apps that don't take rich text. */
export function toPlainText(html) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed; left:-10000px; top:0; width:600px; white-space:normal;';
  host.innerHTML = html;
  document.body.appendChild(host);
  const text = host.innerText;
  host.remove();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** Copy as rich text (with a plain-text twin). Falls back to selecting and copying. */
export async function copyRich(html, text) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return;
    } catch {
      // Fall through to the selection copy below.
    }
  }
  const host = document.createElement('div');
  host.contentEditable = 'true';
  host.style.cssText = 'position:fixed; left:-10000px; top:0; width:600px;';
  host.innerHTML = html;
  document.body.appendChild(host);
  const range = document.createRange();
  range.selectNodeContents(host);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  const ok = document.execCommand('copy');
  sel?.removeAllRanges();
  host.remove();
  if (!ok) throw new Error('copy refused');
}
