// Password hashing in the browser, as in Project Atlas. Power Automate has no hash
// function, so the app sends PBKDF2-SHA256 of the password and the Lotus Auth flow
// only stores and compares it. The plain password, temp ones included, never
// leaves this browser.

const ITERATIONS = 210000;
const HASH_BYTES = 32;
const SALT_BYTES = 16;

export const MIN_PASSWORD = 10;

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
// A salt that isn't base64 is used as raw text, so sign-in still asks and fails normally.
function fromBase64(b64) {
  try { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return new TextEncoder().encode(b64); }
}

export const newSalt = () => toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));

export async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations: ITERATIONS }, key, HASH_BYTES * 8);
  return toBase64(new Uint8Array(bits));
}

// No look-alike characters (0/O, 1/l/I), so a temp password read aloud or retyped works first time.
const TEMP_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** A random temp password in three groups, e.g. "hT4k-9wQe-Rm2x". */
export function tempPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => TEMP_CHARS[b % TEMP_CHARS.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
}

/** Why a new password can't be used, or null when it is fine. */
export function passwordProblem(password, username) {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  const name = String(username || '').split('@')[0].toLowerCase();
  if (name.length >= 4 && password.toLowerCase().includes(name)) return 'Don’t use your username in the password.';
  return null;
}

export async function saltedHash(password) {
  const salt = newSalt();
  return { salt, hash: await hashPassword(password, salt) };
}

// Password reset links. The link carries a random code; the Auth flow keeps only
// its SHA-256 (Power Automate can't hash, so the browser does it on both ends,
// the same way passwords work). A code works once, for RESET_HOURS.
export const RESET_HOURS = 24;

const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A random code for a reset link: 32 bytes, URL-safe. */
export const resetCode = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));

/** SHA-256 of a reset code, as 64 hex characters. */
export async function codeHash(code) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(code))));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
