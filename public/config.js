// Site settings, read at page load. Edit this file on GitHub (or in dist/ after a
// build) to reconfigure the live site; no rebuild needed.
window.ONSITE_CONFIG = {
  // Keep these three empty in the repo. The GitHub Pages deploy fills them in from the
  // repo's Actions secrets (LOTUS_READ_URL, LOTUS_WRITE_URL, LOTUS_AUTH_URL).
  // Empty = demo mode: sample data, saved only in this browser.
  readUrl: '',
  writeUrl: '',
  // Lotus Corrections flow (missed clock-in requests, strikes). Empty: they go to writeUrl.
  correctionsUrl: '',

  // Lotus Auth (usernames and passwords that a Lotus admin hands out). Empty = sign-ins
  // kept in this browser only, with the demo accounts Lotus-admin and Lotus-operator.
  authUrl: '',

  project: 'Google Lotus on-site',

  // Each lab, its robots and its shift templates. Robot names must be unique across
  // labs, because hours worked merge everyone's time per robot per day. To add a
  // robot (say a second one in Mountain View), add its name to that lab's list.
  // Template times are the lab's local time; overlapping templates are expected
  // handovers, never a flag. `seats` is how many operators each shift needs per day,
  // across the lab's robots (operators work in pairs, so 4 = both robots).
  // `days` are the days the lab runs: 0 = Sunday … 6 = Saturday.
  // Robot names (their host names), shown next to the robot everywhere. The robot
  // keeps its id ("Robot 3") in every saved record. Admins can change these in
  // Settings → Robots; what they save there wins over this list.
  robotNames: {
    'Robot 1': 'Stationary',
    'Robot 2': 'Mobile',
    'Robot 3': 'franka-thor-02',
    'Robot 4': 'jetson-thor-004',
  },

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
      robots: ['Robot 3', 'Robot 4'],
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
