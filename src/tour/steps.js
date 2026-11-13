// Tour wording, in one place. Plain words, one idea per step, a few steps per
// page. The first sign-in shows the welcome tour, then each page shows its own
// tour the first time it's opened. The ? button in the top bar replays it.
//
// A step: { target, title, body, roles?, link? }
//   target: a CSS selector for what it points at. Leave it out for a centred card.
//           A step whose target isn't on screen for this person is skipped.
//   roles:  only people with one of these roles see it.
//   link:   { label, route } shows a button that ends the tour and opens that page
//           (used to open the guide, src/views/Guide.jsx).

const T = (name) => `[data-tour="${name}"]`;
const nav = (id) => T(`nav-${id}`);
const SCHED = ['scheduler'];
const APPR = ['approver'];
const GUIDE_OP = { label: 'Open the guide', route: 'guide' };
const GUIDE_STAFF = { label: 'Open the guide', route: 'admin/guide' };

export const TOURS = {
  // The operator page (#/), shown to operators the first time they sign in.
  checkin: [
    {
      title: 'Welcome to Lotus',
      body: 'This is where you clock in and out, and see your shifts and hours. Here’s a 30-second look around.',
    },
    {
      target: '.checkin-primary .op-shift',
      title: 'Your shift today',
      body: 'The time, the lab and the robot you’re on.',
    },
    {
      target: '.checkin-primary .op-big, .checkin-primary .op-dial',
      title: 'Clock in and out here',
      body: 'Press this when you arrive, and again when you leave. It opens a few minutes before your shift. The time comes from our server, not your phone.',
    },
    {
      target: '.checkin-primary .op-stats',
      title: 'While you’re on the clock',
      body: 'How long is left, and when your shift ends. Clock out when you leave; time after the end only counts if your manager approves it.',
    },
    {
      target: '.checkin-primary .op-switch',
      title: 'Two shifts in a row',
      body: 'Booked back to back? When your next shift opens, press Switch to move straight into it. Each shift is recorded on its own, and the handover is never flagged.',
    },
    {
      target: '.checkin-primary .op-spots',
      title: 'Cover an open spot',
      body: 'Someone in your lab didn’t show. If your lead asked you to cover, take the spot: you’re booked and clocked in at once.',
    },
    {
      target: '.checkin-primary .op-week',
      title: 'Your hours this week',
      body: 'Your own time so far, against the 37-hour weekly limit.',
    },
    {
      target: '.checkin-aside .op-head',
      title: 'Your timesheet',
      body: 'Each day you worked, and whether your manager has approved it yet.',
    },
    {
      target: '.checkin-aside .op-standing',
      title: 'Missed clock-ins',
      body: 'Where you stand after a missed clock-in or out, and the date it clears. Only you see this.',
    },
    {
      target: T('op-forgot'),
      title: 'Forgot to clock in or out?',
      body: 'Send a request here the same day. The admins get an email, you get a copy, and an admin sets the real times.',
    },
    {
      target: T('help'),
      title: 'See this again',
      body: 'Press the ? button any time to replay this tour.',
    },
    {
      title: 'The full guide',
      body: 'Every feature, step by step: clocking in and out, two shifts in a row, open spots, missed clock-ins and your hours. Open it any time from your page or Settings.',
      link: GUIDE_OP,
    },
  ],

  // The admin app, the first time someone opens it.
  welcome: [
    {
      title: 'Welcome to Lotus admin',
      body: 'Here you plan shifts, see who’s on site and approve hours. This quick tour shows where things are. It takes about a minute.',
    },
    { target: nav('admin/today'), title: 'Today', body: 'Who’s on site right now, and any shift that needs someone to cover it.' },
    { target: nav('admin/schedule'), title: 'Schedule', body: 'Plan the week, and email each operator their shifts.' },
    { target: nav('admin/roster'), title: 'Roster', body: 'Everyone who can be scheduled. Add operators and give them a sign-in here.', roles: SCHED },
    { target: nav('admin/review'), title: 'Review', body: 'Check each operator’s day and approve their hours. Last week’s hours are due every Monday.', roles: APPR },
    { target: nav('admin/hours'), title: 'Hours', body: 'Hours worked (robot time, a pair counts once) and each operator’s own hours, side by side.' },
    { target: nav('admin/records'), title: 'Records', body: 'Every raw clock-in and clock-out, exactly as recorded. Not approved hours.' },
    { target: nav('admin/reports'), title: 'Reports', body: 'Download the approved hours for agency reporting.' },
    { target: nav('admin/emails'), title: 'Emails', body: 'The emails Lotus sends: preview them, copy them, or change the wording.' },
    { target: T('search'), title: 'Search', body: 'Find any operator or day from anywhere. Shortcut: Ctrl K (⌘K on a Mac).' },
    { target: T('settings'), title: 'Settings', body: 'Light or dark mode, the tour and the guide, and (for admins) Users and sign-ins and robot names.' },
    { target: T('help'), title: 'Help on every page', body: 'Press ? any time for a short walk through the page you’re on.' },
    {
      title: 'The full guide',
      body: 'Every feature, step by step, for operators and staff: the Master List sync, imports, doubles, missed clock-in requests, strikes and approvals. It’s in the sidebar as Guide.',
      link: GUIDE_STAFF,
    },
  ],

  'admin/today': [
    { target: '.main .page-head', title: 'Pick a day', body: 'Today shows who’s on site now. Use the arrows to look at another day.' },
    { target: T('today-backfill'), title: 'Needs a replacement', body: 'Someone hasn’t clocked in. Press Replace to put another operator on that robot.' },
    { target: T('today-onsite'), title: 'On site now', body: 'Everyone clocked in, with their robot and how long they’ve been on.' },
  ],

  'admin/schedule': [
    { target: '.main .page-head', title: 'Pick a week', body: 'Move between weeks with the arrows. This week jumps back to now.' },
    { target: T('sched-sync'), title: 'Synced from the Master List', body: 'The scheduling team’s workbook is copied in every morning at 5:30. Changed it during the day? Press Sync now: it runs at the next half-hour check and covers tomorrow on.' },
    { target: T('sched-add'), title: 'Add a shift', body: 'Book an operator on a robot. Lotus warns you about the 37-hour limit, double bookings and two new operators paired together. Two shifts in a row are fine.' },
    { target: T('sched-import'), title: 'Import a schedule', body: 'Upload the Lotus schedule template (Excel). You see a preview of every change before anything saves.' },
    { target: T('sched-mail'), title: 'Email schedules', body: 'Sends each operator just their own shifts. The number shows who hasn’t had this week’s email yet, or whose shifts changed since.', roles: SCHED },
    { target: T('sched-attention'), title: 'Needs a look', body: 'Shifts with something to fix, like an empty seat or a pair with no experienced operator.' },
    { target: '.main .sched-group', title: 'The week', body: 'Each lab’s shifts by day and robot. Tap a shift to change it.' },
  ],

  'admin/roster': [
    { target: T('roster-import'), title: 'Import from recruiting', body: 'Bring in Active Roster 2 or the scheduling sheet as a CSV. You check the changes before anything saves.' },
    { target: T('roster-add'), title: 'Add an operator', body: 'Adds one person. Admins also set their username and temp password here.' },
    { target: '.main .sel-pill', title: 'Experienced or new', body: 'Every pair needs at least one experienced operator. Auto decides from completed sessions; pick Experienced or New to override.' },
    { target: '.main .group .row-btn', title: 'Operator profile', body: 'Tap an operator for their home lab, experience, sign-in and strike history. Admins can cancel a strike there, with a reason.' },
    { target: '.main .tag-btn', title: 'Set up sign-in', body: 'This operator can’t sign in yet. Press it to give them a username and a temp password.', roles: ['admin'] },
  ],

  'admin/review': [
    { target: '.main .page-head', title: 'Which week', body: 'Review opens on last week. Hours are due by Monday.' },
    { target: T('review-requests'), title: 'Missed clock-in requests', body: 'Operators who forgot to clock in or out ask here. Check with the partner, then set the real times. Each counted miss is a warning or a strike.' },
    { target: T('review-approve-all'), title: 'Approve in one go', body: 'Approves every day with no open flags, at the hours Lotus suggests.' },
    { target: '.main .group .row-btn', title: 'Check a day', body: 'Open an operator’s day to see their clock-ins, decide on any flags, then approve or change the hours.' },
    { title: 'What the flags mean', body: 'Late arrival, Left early, Auto clock-out, No-show and the rest are explained in the guide, with the strike steps.', link: GUIDE_STAFF },
  ],

  'admin/hours': [
    { target: T('hours-week'), title: 'Two kinds of hours', body: 'Hours worked is robot time: a pair working together counts once. Operator hours add up each person’s own time.' },
    { target: T('hours-ops'), title: 'Each operator', body: 'Tap an operator to see their shifts and hours.' },
  ],

  'admin/records': [
    { target: T('records-export'), title: 'Raw clock-ins', body: 'Every clock-in and clock-out exactly as recorded. These are not approved hours; for those, use Reports.' },
    { target: '.main .toolbar', title: 'Filter', body: 'Show everything or just the flags, and search by name.' },
  ],

  'admin/reports': [
    { target: '.main .toolbar', title: 'Pick the dates', body: 'Last week, this month, last month, or your own range.' },
    { target: T('reports-export'), title: 'Approved hours', body: 'Only days an approver has signed off, one row per operator per day. This is the file for the agency-reporting sheet.' },
  ],

  'admin/emails': [
    { target: '.main .em-list', title: 'The emails Lotus sends', body: 'Pick one to see it. Weekly schedule and Schedule change go out from the Schedule page.' },
    { target: '.main .em-bar', title: 'Preview and copy', body: 'See it filled in for a real operator, in light or dark mode. Copy email puts it on your clipboard for Outlook.' },
    { target: T('emails-edit'), title: 'Change the wording', body: 'Edit the template for the whole team. Reset to original undoes your changes.', roles: SCHED },
  ],

  'admin/users': [
    { target: T('users-add'), title: 'Add a person', body: 'Give someone a username, a temp password and their roles. Operators can also be added from Roster.' },
    { target: '.main .group', title: 'Everyone who can sign in', body: 'Tap a person to change their roles, reset their password or turn off their sign-in.' },
  ],
};

/** The steps of a tour this person may see. */
export const stepsFor = (id, roles = []) => (TOURS[id] || []).filter((s) => !s.roles || s.roles.some((r) => roles.includes(r)));
