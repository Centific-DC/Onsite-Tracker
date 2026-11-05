// Site settings, read at page load. Edit this file on GitHub (or in dist/ after a
// build) to reconfigure the live site; no rebuild needed.
window.ONSITE_CONFIG = {
  // Power Automate HTTP trigger URLs for Lotus Read and Lotus Write (docs/lotus-flows.md).
  // Leave either empty and the app runs in demo mode: sample data, saved only in this browser.
  readUrl: '',
  writeUrl: '',

  // Microsoft sign-in (Entra ID single-page app registration). With both set, everyone
  // signs in with their own work account and the flows check their role. Empty =
  // demo sign-in, where you pick who you are.
  auth: { clientId: '', tenantId: '' },

  project: 'Google Lotus on-site',

  // Each lab, its robots and its shift templates. Robot names must be unique across
  // labs, because hours worked merge everyone's time per robot per day. To add a
  // robot (say a second one in Mountain View), add its name to that lab's list.
  // Template times are the lab's local time; overlapping templates are expected
  // handovers, never a flag. `seats` is how many operators each shift needs per day,
  // across the lab's robots (operators work in pairs, so 4 = both robots).
  // `days` are the days the lab runs: 0 = Sunday … 6 = Saturday.
  locations: [
    {
      id: 'RED',
      name: 'Redmond Lab',
      robots: ['Robot 1', 'Robot 2'],
      templates: [
        { id: 'RED-AM', label: 'Morning', start: '07:00', end: '12:30', seats: 2 },
        { id: 'RED-MID', label: 'Afternoon', start: '12:00', end: '17:30', seats: 2 },
        { id: 'RED-PM', label: 'Night', start: '17:00', end: '23:00', seats: 4 },
      ],
      days: [0, 1, 2, 3, 4, 5, 6],
      // Minutes before a shift's start when clock-in opens, with a warning.
      graceMinutes: 10,
    },
    {
      id: 'MTV',
      name: 'Mountain View Lab',
      robots: ['Robot 3'],
      // Placeholder until the Bay Area shift times are confirmed.
      templates: [
        { id: 'MTV-AM', label: 'Morning', start: '07:00', end: '12:30', seats: 2 },
        { id: 'MTV-MID', label: 'Afternoon', start: '12:00', end: '17:30', seats: 2 },
      ],
      days: [1, 2, 3, 4, 5],
      graceMinutes: 10,
    },
  ],

  // Scheduling guardrails.
  weeklyHourCap: 37,
  // A slot where every operator has fewer completed sessions than this is a pairing risk.
  pairingMinSessions: 2,

  // Clocking out up to this many minutes after the scheduled end isn't flagged.
  // Those minutes still aren't counted as approved time.
  outsideToleranceMinutes: 5,

  // Fallback for a check-out with no shift to compare against: sooner than this after
  // check-in asks for a reason and is flagged "Left early".
  shiftHours: 6,
  earlyGraceMinutes: 15,
};
