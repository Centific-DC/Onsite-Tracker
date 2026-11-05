import { APP_URL } from '../config.js';
import { firstName } from '../time.js';
import { buildEmail, fillFields, fillSubject } from './render.js';
import { LOGO_URL } from './useTemplates.js';

// The password reset email an admin sends from Users or Roster. The link holds a
// one-time code, so like a temp password it only ever goes in this one email's
// body: the flow keeps neither the body nor a copy of it.

/** Where the reset page lives: this app's own address. */
const appBase = () => APP_URL || `${location.origin}${location.pathname}`;

export const resetLinkFor = (username, code, base = appBase()) =>
  `${base.replace(/#.*$/, '')}#/reset?u=${encodeURIComponent(username)}&c=${encodeURIComponent(code)}`;

const expiresLabel = (d) => d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function resetValues({ name, username, link, expires }) {
  return {
    operatorName: name,
    operatorFirstName: firstName(name),
    signInUsername: username,
    resetLink: link,
    resetExpires: expiresLabel(expires),
  };
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The template's button points at the bare reset page; give it this person's link.
 * An edited template that lost its button still gets one.
 */
export function withLink(html, link) {
  const button = /href="[^"]*#\/reset"/;
  return button.test(html) ? html.replace(button, `href="${escAttr(link)}"`) : `${html}<p><a href="${escAttr(link)}">Choose a new password</a></p>`;
}

/** One email_send message with the reset link. */
export function resetMessage({ user, op, code, expiresAt, templates, mode = 'light', logo = LOGO_URL }) {
  const content = templates.get('operator-reset');
  const link = resetLinkFor(user.username, code);
  const values = resetValues({ name: user.name || op?.name || user.username, username: user.username, link, expires: new Date(expiresAt) });
  const html = withLink(fillFields(content.html, values), link);
  return {
    to: user.email,
    operatorId: op?.id || user.operatorId || '',
    name: user.name || op?.name || '',
    kind: 'operator-reset',
    subject: fillSubject(content.subject, values),
    html: buildEmail(html, mode, logo),
  };
}
