import { locationName } from '../config.js';
import { firstName } from '../time.js';
import { buildEmail, fillFields, fillSubject } from './render.js';
import { LOGO_URL } from './useTemplates.js';

// The onboarding email an admin sends when they add an operator or set up their
// sign-in: username, temp password and a button to open Lotus. The temp password
// only ever goes in this one email's body (the flow keeps neither the body nor a
// copy of it), and it stops working after TEMP_DAYS.
export const TEMP_DAYS = 7;

export const tempExpiry = (now = new Date()) => new Date(now.getTime() + TEMP_DAYS * 864e5);
const expiresLabel = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

export function welcomeValues({ name, location, username, temp, expires = tempExpiry() }) {
  return {
    operatorName: name,
    operatorFirstName: firstName(name),
    labName: locationName(location) || 'your lab',
    signInUsername: username,
    tempPassword: temp,
    tempExpires: expiresLabel(expires),
  };
}

/** One email_send message for a new operator. */
export function welcomeMessage({ op, username, temp, templates, expires, mode = 'light', logo = LOGO_URL }) {
  const content = templates.get('operator-welcome');
  const values = welcomeValues({ name: op.name, location: op.location, username, temp, expires });
  return {
    to: op.email,
    operatorId: op.id,
    name: op.name,
    kind: 'operator-welcome',
    subject: fillSubject(content.subject, values),
    html: buildEmail(fillFields(content.html, values), mode, logo),
  };
}
