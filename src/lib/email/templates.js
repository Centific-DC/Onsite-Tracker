import { LIGHT } from './palette.js';
import { FONT, TAG_STYLE, button, callout, detailsCard, fieldBlock, fieldChip, paragraph, strongField } from './blocks.js';
import { APP_URL } from '../config.js';

// The starting templates, in the Project Atlas email format and restyled to
// Lotus. "Reset to original" in the editor comes back to these. Operators get
// the schedule emails; approvers get the Monday reminder, which the scheduled
// flow fills in from the {{field}} tokens.

export const TEMPLATES = [
  { id: 'operator-schedule', audience: 'operator', name: 'Weekly schedule', when: 'Sent from Schedule before the week starts', sentBy: 'app' },
  { id: 'operator-schedule-update', audience: 'operator', name: 'Schedule change', when: 'Sent from Schedule when shifts change after the first email', sentBy: 'app' },
  { id: 'operator-welcome', audience: 'operator', name: 'Welcome and sign-in', when: 'Sent when an admin adds an operator or sets up their sign-in', sentBy: 'app' },
  { id: 'operator-reset', audience: 'operator', name: 'Password reset', when: 'Sent when an admin presses Send reset link', sentBy: 'app' },
  { id: 'approver-weekly', audience: 'approver', name: 'Approvals due Monday', when: 'Sent automatically every Monday at 8:00 AM', sentBy: 'flow' },
];

export const AUDIENCE_LABEL = { operator: 'To operators', approver: 'To approvers' };

export const templateMeta = (id) => TEMPLATES.find((t) => t.id === id);

const h1 = (html) => `<h1 style="${TAG_STYLE.h1}">${html}</h1>`;
const h2 = (text) => `<h2 style="${TAG_STYLE.h2}">${text}</h2>`;
const strong = (t) => `<strong style="color:${LIGHT.ink};">${t}</strong>`;
const sign = (closing) =>
  `<p style="margin:0 0 4px; font-family:${FONT}; font-size:15px; line-height:1.5; color:${LIGHT.body};">${closing}</p>`
  + `<p style="margin:0; font-family:${FONT}; font-size:15px; font-weight:700; line-height:1.5; color:${LIGHT.ink};">Project Lotus Team</p>`;

const schedule = [
  h1(`Your schedule for ${fieldChip('weekRange')}`),
  paragraph(`Hi ${strongField('operatorFirstName')},`),
  paragraph(`Here are your shifts at ${strongField('labName')} for the week of ${strongField('weekRange')}. Please look them over and reply to this email if anything doesn’t work for you.`),
  detailsCard([
    ['Week', fieldChip('weekRange')],
    ['Lab', fieldChip('labName')],
    ['Shifts', fieldChip('shiftCount')],
    ['Scheduled', fieldChip('scheduledHours')],
  ]),
  h2('Your shifts'),
  fieldBlock('shiftTable'),
  callout('Before your shift', [
    `${strong('Clock in on the Lotus page when you arrive.')} It opens a few minutes before your shift starts, and your time is taken from the server, not your device.`,
    `${strong('Can’t make a shift?')} Reply to this email at least ${strong('24 hours ahead')} so we can find cover for your robot.`,
  ]),
  button('Open Lotus clock-in', APP_URL),
  sign('Best regards,'),
].join('');

const update = [
  h1('Your schedule has changed'),
  paragraph(`Hi ${strongField('operatorFirstName')},`),
  paragraph(`Your shifts for the week of ${strongField('weekRange')} have changed since our last email. Here is what changed:`),
  callout('What changed', [fieldBlock('changeList')], 'danger'),
  h2('Your updated week'),
  fieldBlock('shiftTable'),
  paragraph(`If the new times don’t work for you, reply to this email ${strong('as soon as you can')} so we can find cover.`),
  button('Open Lotus clock-in', APP_URL),
  sign('Thank you,'),
].join('');

const welcome = [
  h1('Welcome to Project Lotus'),
  paragraph(`Hi ${strongField('operatorFirstName')},`),
  paragraph(`Your Lotus sign-in is ready. You'll use Lotus to clock in and out of your shifts at ${strongField('labName')} and to see your schedule and hours.`),
  detailsCard([
    ['Username', fieldChip('signInUsername')],
    ['Temp password', fieldChip('tempPassword')],
    ['Use it by', fieldChip('tempExpires')],
  ]),
  callout('Your first sign-in', [
    `${strong('Choose your own password')} when Lotus asks. The temp password above works once and stops working after ${strong('7 days')}.`,
    `${strong('Keep it to yourself.')} Nobody from the team will ever ask you for your password. If it has expired, reply to this email for a new one.`,
  ]),
  button('Open Lotus', APP_URL),
  sign('Welcome aboard,'),
].join('');

// The reset button's link is put in when the email is made (see email/reset.js):
// the `#/reset` here is only a stand-in, so keep the button if you edit this one.
const reset = [
  h1('Reset your Lotus password'),
  paragraph(`Hi ${strongField('operatorFirstName')},`),
  paragraph(`Your Lotus admin sent you this link to choose a new password. Your username is ${strongField('signInUsername')}.`),
  button('Choose a new password', `${APP_URL}#/reset`),
  callout('About this link', [
    `${strong('It works once')} and stops working on ${strongField('resetExpires')}. Your current password keeps working until you choose a new one.`,
    `${strong('Didn’t expect this?')} You can ignore it, or reply to this email. Nobody from the team will ever ask you for your password.`,
  ]),
  paragraph(`If the button doesn’t work, copy this link into your browser: ${fieldChip('resetLink')}`),
  sign('Thank you,'),
].join('');

const approver = [
  h1('Timesheets are ready to approve'),
  paragraph(`Hi ${strongField('approverFirstName')},`),
  paragraph(`Operator time for ${strongField('reviewWeek')} is ready for review. Please approve it ${strong('by end of day today')}, so the approved hours can go to agency reporting.`),
  detailsCard([
    ['Week', fieldChip('reviewWeek')],
    ['To approve', fieldChip('openDays')],
  ]),
  callout('Only approved hours are reported', [
    'Raw clock-ins never reach the agency file. Days with a flag (a missed clock-out, an early leave, time outside the shift) need a decision before they can be approved.',
  ]),
  button('Open Review', `${APP_URL}#/admin/review`),
  sign('Thank you,'),
].join('');

export const DEFAULT_CONTENT = {
  'operator-schedule': { subject: 'Your Lotus schedule for {weekRange}', html: schedule, updatedAt: null, updatedBy: null },
  'operator-schedule-update': { subject: 'Updated: your Lotus schedule for {weekRange}', html: update, updatedAt: null, updatedBy: null },
  'operator-welcome': { subject: 'Welcome to Lotus: your sign-in', html: welcome, updatedAt: null, updatedBy: null },
  'operator-reset': { subject: 'Reset your Lotus password', html: reset, updatedAt: null, updatedBy: null },
  'approver-weekly': { subject: 'Lotus timesheets for {reviewWeek} are ready to approve', html: approver, updatedAt: null, updatedBy: null },
};

/** Fields offered in each template's editor. */
export const TEMPLATE_FIELDS = {
  'operator-schedule': ['operatorName', 'operatorFirstName', 'weekRange', 'labName', 'shiftCount', 'scheduledHours', 'shiftTable'],
  'operator-schedule-update': ['operatorName', 'operatorFirstName', 'weekRange', 'labName', 'shiftCount', 'scheduledHours', 'shiftTable', 'changeList'],
  'operator-welcome': ['operatorName', 'operatorFirstName', 'labName', 'signInUsername', 'tempPassword', 'tempExpires'],
  'operator-reset': ['operatorName', 'operatorFirstName', 'signInUsername', 'resetLink', 'resetExpires'],
  'approver-weekly': ['approverFirstName', 'reviewWeek', 'openDays'],
};
