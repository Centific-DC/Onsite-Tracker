// The current sign-in, readable outside React so every Read and Write call can
// carry its token. Kept in this browser until sign-out or expiry (12 hours).

const KEY = 'lotus-auth-v1';

const read = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s?.token && Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch { return null; }
};

let current = read();

export function getAuth() {
  if (current && Date.parse(current.expiresAt) <= Date.now()) current = null;
  return current;
}

export const getToken = () => getAuth()?.token || null;

export function setAuth(next) {
  current = next;
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch { /* storage off: the sign-in lasts for this tab */ }
}
