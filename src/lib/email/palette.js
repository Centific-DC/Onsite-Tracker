// Email colours: the Lotus theme carried into an inbox, in the same layout as
// the Project Atlas emails (Centific header, framed body, details card, note
// boxes, button). Templates are written in the light palette, which almost every
// inbox shows. The dark preview swaps each light colour for its partner below.
// Colours picked by hand outside the palette stay as they are in both modes.

export const LIGHT = {
  page: '#F1F3F1',
  card: '#FFFFFF',
  frame: '#F8F9F8',
  frameLine: '#E4E7E4',
  ink: '#1A1C1A',
  body: '#3D423D',
  muted: '#6B716B',
  accent: '#B5532F',
  accentBar: '#E57E5D',
  detail: '#FDF3EE',
  detailLine: '#F5DACD',
  danger: '#C43D3D',
  dangerTint: '#FDF0F0',
  amber: '#A96A0C',
  amberTint: '#FFF4DE',
  green: '#2F8F5B',
  logo: '#3A3D3A',
  field: '#FFF4CC',
  buttonText: '#FFFFFF',
};

export const DARK = {
  page: '#161816',
  card: '#1C1E1C',
  frame: '#222523',
  frameLine: '#2E322F',
  ink: '#ECEFEC',
  body: '#C4C9C4',
  muted: '#8A918A',
  accent: '#F0A184',
  accentBar: '#F0906F',
  detail: '#2E2420',
  detailLine: '#4A352C',
  danger: '#F28B8B',
  dangerTint: '#2E1F1F',
  amber: '#F6C470',
  amberTint: '#33291A',
  green: '#7FE0AB',
  logo: '#FFFFFF',
  field: '#4A3F14',
  buttonText: '#1A1C1A',
};

export const paletteFor = (mode) => (mode === 'dark' ? DARK : LIGHT);

const KEYS = Object.keys(LIGHT);
const SWAP = new Map(KEYS.map((k) => [LIGHT[k].toLowerCase(), DARK[k]]));
// execCommand writes colours as rgb(); match those too.
const rgbOf = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};
const SWAP_RGB = new Map(KEYS.map((k) => [rgbOf(LIGHT[k]), DARK[k]]));

/** The dark-mode version of light-palette HTML. */
export function toDark(html) {
  return html
    .replace(/#[0-9a-f]{6}\b/gi, (hex) => SWAP.get(hex.toLowerCase()) ?? hex)
    .replace(/rgb\(\s*\d+,\s*\d+,\s*\d+\s*\)/g, (rgb) => SWAP_RGB.get(rgb.replace(/\s+/g, '').replace(/,/g, ', ')) ?? rgb);
}

/** Text colours offered in the editor, in the order shown. */
export const TEXT_SWATCHES = [
  { key: 'ink', label: 'Ink' },
  { key: 'body', label: 'Body' },
  { key: 'muted', label: 'Muted' },
  { key: 'accent', label: 'Lotus coral' },
  { key: 'danger', label: 'Red' },
  { key: 'amber', label: 'Amber' },
  { key: 'green', label: 'Green' },
];

/** Highlight colours (text background). */
export const HIGHLIGHT_SWATCHES = [
  { key: 'detail', label: 'Coral tint' },
  { key: 'field', label: 'Yellow' },
  { key: 'dangerTint', label: 'Red tint' },
];
