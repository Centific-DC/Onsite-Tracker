import { useCallback, useMemo } from 'react';
import { useStore } from '../store.js';
import { APP_URL } from '../config.js';
import { DEFAULT_CONTENT } from './templates.js';
import { buildEmail, sanitize, toTokens } from './render.js';
import { currentAppLinks, hasOldAppLinks } from './links.js';

// The email templates everyone shares: the Lotus_Templates list (through the
// Read flow), falling back to the defaults. Saving also stores `ready`, the
// whole email with {{field}} tokens, which the scheduled Monday flow fills in.

export const LOGO_URL = `${APP_URL}email-logo.png`;

export function useTemplates() {
  const saved = useStore((s) => s.data?.templates);
  const saveTemplate = useStore((s) => s.saveTemplate);
  const byId = useMemo(() => new Map((saved || []).map((t) => [t.id, t])), [saved]);

  const get = useCallback((id) => {
    const s = byId.get(id);
    return s && typeof s.html === 'string' && typeof s.subject === 'string' ? { ...s, html: sanitize(currentAppLinks(s.html)) } : DEFAULT_CONTENT[id];
  }, [byId]);
  // Saved templates (or their ready-to-send copy for the Monday flow) that still
  // link to Lotus's old address.
  const stale = useMemo(() => (saved || []).filter((t) => hasOldAppLinks(t.html) || hasOldAppLinks(t.ready)).map((t) => t.id), [saved]);
  const isEdited = useCallback((id) => byId.has(id) && !byId.get(id).original, [byId]);

  const save = useCallback((id, next) => {
    const html = sanitize(currentAppLinks(next.html));
    return saveTemplate({ id, subject: next.subject.trim(), html, ready: buildEmail(toTokens(html), 'light', LOGO_URL) });
  }, [saveTemplate]);

  const reset = useCallback((id) => {
    const d = DEFAULT_CONTENT[id];
    return saveTemplate({ id, subject: d.subject, html: d.html, ready: buildEmail(toTokens(d.html), 'light', LOGO_URL), original: true });
  }, [saveTemplate]);

  // Re-saves the stale templates as they read now, so the flows send the new links too.
  const refreshLinks = useCallback(() => Promise.all(stale.map((id) => {
    const t = get(id);
    return byId.get(id)?.original ? reset(id) : save(id, t);
  })), [stale, get, byId, reset, save]);

  return { get, isEdited, save, reset, stale, refreshLinks };
}
