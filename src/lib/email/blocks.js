import { LIGHT } from './palette.js';

// Building blocks for template bodies, in the Project Atlas email format. Every
// style is inline so the email keeps its look in Outlook; layout uses tables for
// the same reason.

export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
export const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif";

// Values a template can pull in. `block` fields are whole sections (a table or a
// list), filled as HTML; the rest are plain text.
export const FIELDS = {
  operatorName: { label: 'Operator name' },
  operatorFirstName: { label: 'Operator first name' },
  approverFirstName: { label: 'Approver first name' },
  weekRange: { label: 'Week' },
  labName: { label: 'Lab' },
  shiftCount: { label: 'Number of shifts' },
  scheduledHours: { label: 'Scheduled hours' },
  shiftTable: { label: 'Shift table', block: true },
  changeList: { label: 'What changed', block: true },
  reviewWeek: { label: 'Review week' },
  openDays: { label: 'Operator-days to approve' },
  // The onboarding email. `secret` fields only ever go in the body of the one
  // email being sent: never in a subject, a saved notice or the audit.
  signInUsername: { label: 'Username' },
  tempPassword: { label: 'Temp password', secret: true },
  tempExpires: { label: 'Temp password expires' },
  // The password reset email: the link works once, so it is secret like a password.
  // Shown as the words "Choose a new password", never as the raw address.
  resetLink: { label: 'Reset link', secret: true, linkText: 'Choose a new password' },
  resetExpires: { label: 'Reset link expires' },
};
export const FIELD_IDS = Object.keys(FIELDS);
export const FIELD_LABEL = Object.fromEntries(FIELD_IDS.map((id) => [id, FIELDS[id].label]));
export const isFieldId = (v) => typeof v === 'string' && Object.hasOwn(FIELDS, v);
export const isBlockField = (id) => Boolean(FIELDS[id]?.block);
export const isSecretField = (id) => Boolean(FIELDS[id]?.secret);
/** Fields that hold a web address: they fill in as a link with words, never the bare URL. */
export const fieldLinkText = (id) => FIELDS[id]?.linkText || '';

/** Default styles for bare tags (from the editor's block menu or a paste). */
export const TAG_STYLE = {
  h1: `margin:0 0 16px; font-family:${SERIF}; font-size:30px; line-height:1.2; font-weight:700; color:${LIGHT.ink};`,
  h2: `margin:20px 0 10px; font-family:${FONT}; font-size:13px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${LIGHT.ink};`,
  h3: `margin:16px 0 8px; font-family:${FONT}; font-size:16px; font-weight:700; color:${LIGHT.ink};`,
  p: `margin:0 0 14px; font-family:${FONT}; font-size:15px; line-height:1.6; color:${LIGHT.body};`,
  ul: `margin:0 0 14px; padding-left:22px; font-family:${FONT}; font-size:15px; line-height:1.6; color:${LIGHT.body};`,
  ol: `margin:0 0 14px; padding-left:22px; font-family:${FONT}; font-size:15px; line-height:1.6; color:${LIGHT.body};`,
  li: 'margin:0 0 6px;',
  a: `color:${LIGHT.accent}; font-weight:600; text-decoration:underline;`,
  blockquote: `margin:0 0 14px; padding:4px 0 4px 16px; border-left:3px solid ${LIGHT.accentBar}; font-family:${FONT}; font-size:15px; line-height:1.6; color:${LIGHT.body};`,
  td: `padding:8px 10px; border:1px solid ${LIGHT.frameLine}; font-family:${FONT}; font-size:14px; line-height:1.5; color:${LIGHT.body}; vertical-align:top;`,
  th: `padding:8px 10px; border:1px solid ${LIGHT.frameLine}; background-color:${LIGHT.detail}; font-family:${FONT}; font-size:12px; font-weight:700; text-align:left; color:${LIGHT.ink};`,
  table: 'border-collapse:collapse; width:100%; margin:0 0 14px;',
  hr: `border:0; border-top:1px solid ${LIGHT.frameLine}; margin:20px 0;`,
};

/** A field chip. In the editor it reads as one token; when the email is made it becomes the value. */
export const fieldChip = (id) => `<span data-field="${id}" contenteditable="false">${FIELD_LABEL[id]}</span>`;

/** A whole-section field (shift table, change list) sits in its own block. */
export const fieldBlock = (id) => `<div data-block="field">${fieldChip(id)}</div>`;

export const strongField = (id) => `<strong style="color:${LIGHT.ink};">${fieldChip(id)}</strong>`;

const LABEL_CELL = `width:120px; padding:7px 14px 7px 0; vertical-align:top; font-family:${FONT}; font-size:11px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:${LIGHT.accent}; white-space:nowrap;`;
const VALUE_CELL = `padding:7px 0; vertical-align:top; font-family:${FONT}; font-size:15px; font-weight:600; line-height:1.4; color:${LIGHT.ink};`;

/** The rounded details card (Week / Lab / Shifts ...). Each row: label + HTML value. */
export function detailsCard(rows) {
  const body = rows
    .map(([label, value], i) => {
      const line = i < rows.length - 1 ? ` border-bottom:1px solid ${LIGHT.detailLine};` : '';
      return `<tr><td style="${LABEL_CELL}${line}">${label}</td><td style="${VALUE_CELL}${line}">${value}</td></tr>`;
    })
    .join('');
  return `<table data-block="details" role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%; margin:4px 0 20px; background-color:${LIGHT.detail}; border:1px solid ${LIGHT.detailLine}; border-radius:10px; border-collapse:separate;"><tbody><tr><td style="padding:12px 20px;"><table role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%; border-collapse:collapse;"><tbody>${body}</tbody></table></td></tr></tbody></table>`;
}

/** A callout with a coloured left edge: a small uppercase title, then paragraphs (or any HTML). */
export function callout(title, paragraphs, tone = 'accent') {
  const edge = tone === 'danger' ? LIGHT.danger : LIGHT.accentBar;
  const titleColor = tone === 'danger' ? LIGHT.danger : LIGHT.accent;
  const ps = paragraphs
    .map((p, i) => (p.startsWith('<div') ? p : `<p style="margin:0${i < paragraphs.length - 1 ? ' 0 10px' : ''}; font-family:${FONT}; font-size:14.5px; line-height:1.6; color:${LIGHT.ink};">${p}</p>`))
    .join('');
  return `<table data-block="callout" role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%; margin:8px 0 20px; background-color:${LIGHT.card}; border-left:3px solid ${edge}; border-radius:0 6px 6px 0; border-collapse:separate;"><tbody><tr><td style="padding:14px 18px;"><p style="margin:0 0 10px; font-family:${FONT}; font-size:11px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:${titleColor};">${title}</p>${ps}</td></tr></tbody></table>`;
}

/** A button-shaped link (a table so Outlook keeps its shape). */
export function button(label, href) {
  return `<table data-block="button" role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin:8px 0 20px; border-collapse:separate;"><tbody><tr><td style="background-color:${LIGHT.accentBar}; border-radius:10px;"><a href="${href}" target="_blank" rel="noopener" style="display:inline-block; padding:12px 26px; font-family:${FONT}; font-size:15px; font-weight:700; color:${LIGHT.buttonText}; text-decoration:none;">${label}</a></td></tr></tbody></table>`;
}

export const divider = () => `<hr style="${TAG_STYLE.hr}">`;

export const paragraph = (html) => `<p style="${TAG_STYLE.p}">${html}</p>`;

export function simpleTable(cols, rows) {
  const head = `<tr>${Array.from({ length: cols }, () => `<th style="${TAG_STYLE.th}">Heading</th>`).join('')}</tr>`;
  const row = `<tr>${Array.from({ length: cols }, () => `<td style="${TAG_STYLE.td}">&nbsp;</td>`).join('')}</tr>`;
  return `<table style="${TAG_STYLE.table}"><tbody>${head}${row.repeat(rows)}</tbody></table>`;
}

/** Image widths offered in the editor, in px (the email body is 520px wide). */
export const IMAGE_WIDTHS = { small: 160, medium: 300, large: 440, full: 520 };

export const imageTag = (src, alt, width) =>
  `<img src="${src}" alt="${alt.replace(/"/g, '&quot;')}" width="${width}" style="display:block; width:${width}px; max-width:100%; height:auto; border:0; border-radius:8px; margin:0 0 14px;">`;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The operator's shifts for the week as an email table. Rows: { day, shift,
 * time, robot, change?: 'added' | 'changed' | 'removed', was?: { day, time, robot } }.
 */
export function shiftTable(rows, total) {
  const th = (t, right) => `<th style="padding:8px 10px; border-bottom:1px solid ${LIGHT.frameLine}; font-family:${FONT}; font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; text-align:${right ? 'right' : 'left'}; color:${LIGHT.muted};">${t}</th>`;
  const TAG = { added: ['Added', LIGHT.green], changed: ['Changed', LIGHT.amber], removed: ['Removed', LIGHT.danger] };
  const body = rows.map((r) => {
    const bg = r.change === 'removed' ? LIGHT.dangerTint : r.change ? LIGHT.amberTint : '';
    const strike = r.change === 'removed' ? ' text-decoration:line-through;' : '';
    const td = (html, extra = '') => `<td style="padding:10px; border-bottom:1px solid ${LIGHT.frameLine}; font-family:${FONT}; font-size:14px; line-height:1.4; color:${LIGHT.ink};${bg ? ` background-color:${bg};` : ''}${extra}">${html}</td>`;
    const tag = r.change ? ` <span style="display:inline-block; margin-left:6px; padding:1px 7px; border-radius:99px; font-size:11px; font-weight:700; color:${TAG[r.change][1]}; background-color:${LIGHT.card};">${TAG[r.change][0]}</span>` : '';
    const was = (k) => (r.was?.[k] ? `<br><span style="font-size:12.5px; color:${LIGHT.muted}; text-decoration:line-through;">${esc(r.was[k])}</span>` : '');
    return `<tr>${td(`${esc(r.day)}${was('day')}`, strike)}${td(`${esc(r.shift)}${tag}`, strike)}${td(`${esc(r.time)}${was('time')}`, strike)}${td(`${esc(r.robot)}${was('robot')}`, strike)}</tr>`;
  }).join('');
  const foot = total
    ? `<tr><td colspan="3" style="padding:10px; font-family:${FONT}; font-size:14px; font-weight:700; color:${LIGHT.ink};">${esc(total.label)}</td><td style="padding:10px; font-family:${FONT}; font-size:14px; font-weight:700; color:${LIGHT.ink};">${esc(total.hours)}</td></tr>`
    : '';
  return `<table data-block="shifts" role="presentation" border="0" cellspacing="0" cellpadding="0" width="100%" style="width:100%; margin:4px 0 20px; border-collapse:collapse;"><tbody><tr>${th('Day')}${th('Shift')}${th('Time (PT)')}${th('Robot')}</tr>${body}${foot}</tbody></table>`;
}

/** A plain list for the change summary. */
export const bulletList = (items) =>
  `<ul style="${TAG_STYLE.ul} margin-bottom:0;">${items.map((t) => `<li style="${TAG_STYLE.li}">${esc(t)}</li>`).join('')}</ul>`;
