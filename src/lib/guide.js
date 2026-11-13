// The Lotus guide (#/guide for operators, #/admin/guide for staff): every feature
// and how to use it, in plain words. Generic on purpose: no people's names, only
// roles ("your lead", "an admin"). Keep it in step with the tours (src/tour/steps.js)
// and PRODUCT.md when a feature changes.
//
// A section: { id, icon, title, summary, steps?: [], tips?: [], table?: { head, rows } }
// `icon` is a lucide-react icon name, looked up in Guide.jsx.

export const OPERATOR_GUIDE = [
  {
    id: 'start',
    icon: 'LogIn',
    title: 'Getting started',
    summary: 'Sign in once on your phone, or on the lab laptop each time.',
    steps: [
      'Open Lotus and sign in with the username and temporary password an admin gave you.',
      'Choose your own password. You only do this once.',
      'On your phone you stay signed in. On the lab laptop, pick Lab laptop in Settings: it signs you out after each clock-in or out, ready for the next person.',
    ],
    tips: ['Forgot your password? Ask an admin to email you a reset link.'],
  },
  {
    id: 'clock-in',
    icon: 'Clock',
    title: 'Clock in',
    summary: 'Press the big button when you arrive. The time comes from our server, not your phone.',
    steps: [
      'Check the card at the top: it shows your shift, the lab and the robot.',
      'Clock-in opens 10 minutes before your shift starts. Press Clock in.',
      'If your shift has no robot set, pick the robot you’re working on.',
    ],
    tips: [
      'Minutes before your start are logged and reviewed by your manager. They aren’t counted unless your manager adds them.',
      'Clocking in 5 or more minutes after the start is flagged as a late arrival.',
      'You can only clock in to a shift that’s booked for you. No shift today? Ask your scheduler.',
    ],
  },
  {
    id: 'on-clock',
    icon: 'Timer',
    title: 'While you’re on the clock',
    summary: 'The ring fills as your shift goes. You can see the time left and who you’re paired with.',
    steps: [
      'The ring shows how long you’ve been on the clock, against your shift’s length.',
      'Time left and Shift ends sit right below it.',
      'Your partners’ names show at the top. You only ever see their names, never their times or hours.',
    ],
  },
  {
    id: 'clock-out',
    icon: 'LogOut',
    title: 'Clock out',
    summary: 'Press the ring again when you leave.',
    steps: [
      'Press Clock out when your shift ends.',
      'Leaving more than 15 minutes early? Lotus asks why, and your manager is told.',
      'Staying past the end? The ring turns red. Extra time only counts if your manager approves it.',
    ],
    tips: ['Forgot to clock out? Lotus clocks you out automatically 15 minutes after your shift ends, and marks the day "Auto clock-out" for your manager to review.'],
  },
  {
    id: 'double',
    icon: 'Repeat',
    title: 'Two shifts in a row',
    summary: 'Booked back to back? Switch from one shift to the next with one tap.',
    steps: [
      'Stay clocked in at the end of your first shift.',
      'When your next shift opens, a Switch to your next shift button appears under the ring.',
      'Press it. Lotus clocks you out of the first shift and into the next one.',
    ],
    tips: [
      'Each shift is recorded on its own, so your hours are counted shift by shift.',
      'Switching at the handover is never flagged as late or leaving early.',
      'Only shifts your scheduler has booked for you count. Ask before you stay on for a second shift.',
    ],
  },
  {
    id: 'open-spot',
    icon: 'UserPlus',
    title: 'Covering an open spot',
    summary: 'When someone in your lab doesn’t show up, you may be able to take their place.',
    steps: [
      'If you’re not on the clock and someone booked in your lab hasn’t arrived, a Partner needed card shows up on your page.',
      'If your lead asked you to cover, press Take this spot and clock in, and pick the robot if Lotus asks.',
      'You’re booked on that shift and clocked in at the same time. You’ll then see your partner’s name.',
    ],
  },
  {
    id: 'forgot',
    icon: 'MessageSquareWarning',
    title: 'Forgot to clock in or out?',
    summary: 'Send a request from your page. Only an admin can fix the times.',
    steps: [
      'Press Forgot to clock in or out? under your timesheet.',
      'Pick the shift and what you missed (clock-in, clock-out or both), and say what happened.',
      'Lotus emails the admins and sends you a copy. An admin checks with your partner and sets the real times.',
      'Your request shows under Your requests: Sent to admins, then Corrected or Declined.',
    ],
    tips: ['Send it the same day. A request sent more than 24 hours after the shift ended also counts as a late report.'],
  },
  {
    id: 'standing',
    icon: 'ShieldAlert',
    title: 'Missed clock-ins and strikes',
    summary: 'Each counted miss moves you one step. Your page shows where you stand.',
    table: {
      head: ['Step', 'What happens'],
      rows: [
        ['Soft warning', 'Logged, and you get an email'],
        ['Strike 1', 'Noted on your record'],
        ['Strike 2', 'A talk with your lead'],
        ['Strike 3', 'A talk with your PM and a review of your place on the project'],
      ],
    },
    tips: [
      'Missed clock-ins and clock-outs (including auto clock-outs) count. No-shows, outages and scheduling mistakes don’t.',
      'After 30 days with no new miss, your count goes back to zero. Your page shows the date it clears.',
      'Only you see your own standing, never anyone else’s.',
    ],
  },
  {
    id: 'timesheet',
    icon: 'CalendarCheck',
    title: 'Your timesheet and hours',
    summary: 'See each day you worked, what’s approved, and what’s coming up.',
    steps: [
      'Timesheet lists this week’s days, with your hours and whether they’re approved or under review.',
      'Your hours this week shows your own time against the 37-hour weekly limit.',
      'Coming up lists your next shifts, with the lab, robot and partner.',
    ],
    tips: ['Your clock-ins aren’t your approved hours. Your manager reviews each day, and approved hours replace what you clocked once they’re confirmed.'],
  },
];

export const STAFF_GUIDE = [
  {
    id: 'today',
    icon: 'Users',
    title: 'Today',
    summary: 'Who’s on site right now, and which robots need cover.',
    steps: [
      'Each robot shows who’s booked and their status: Due, On site, Not here yet, Worked or No-show.',
      'Needs a replacement lists robots where someone hasn’t arrived and the pair isn’t full.',
      'Press Replace to book another operator on that robot, starting at the next quarter hour.',
    ],
    tips: ['Every shift has its own status. An operator on two shifts in a row who skips the second shows as missing for that one.'],
  },
  {
    id: 'schedule',
    icon: 'CalendarDays',
    title: 'Schedule',
    summary: 'Plan the week by lab, day and robot.',
    steps: [
      'Move between weeks with the arrows. This week jumps back to now.',
      'Press Add shift: pick the operator, the day, the shift and (if you want) the robot and partner.',
      'Tap a shift to change it, move it or delete it.',
    ],
    tips: [
      'Lotus warns you before you save: over 37 hours in a week, an operator booked twice at once or at two labs, or two new operators paired together.',
      'Two shifts in a row for one operator are fine, even on different robots. The operator switches from one to the next on their page.',
      'Needs a look lists empty seats and pairs with no experienced operator.',
    ],
  },
  {
    id: 'sync',
    icon: 'RefreshCw',
    title: 'Schedule from the Master List',
    summary: 'The scheduling team’s workbook is copied into Lotus every morning.',
    steps: [
      'Every day at 5:30 AM, Lotus reads the Master List workbook and books, changes or removes shifts from today on.',
      'Changed the workbook during the day? Press Sync now. It runs at the next check (every 30 minutes, 6 AM to 7 PM) and covers tomorrow on.',
      'The line under the Schedule header shows the last sync and anything it skipped, with the reason.',
    ],
    tips: [
      'Same-day changes after the workday starts are made by hand in Lotus.',
      'A synced shift you delete in Lotus stays deleted. A shift you change in Lotus is never overwritten.',
      'People must be on Roster first. The sync never adds people.',
    ],
  },
  {
    id: 'import',
    icon: 'Upload',
    title: 'Import a schedule',
    summary: 'Upload the Lotus schedule template (Excel) instead of booking one by one.',
    steps: [
      'Press Import on Schedule and choose the filled-in template.',
      'Check the preview: new shifts, changes and anything skipped, with the reason.',
      'Press Import to save. Nothing saves before you confirm.',
    ],
    tips: ['Rows with the same Pair letter on the same lab, day and shift are partners.'],
  },
  {
    id: 'emails',
    icon: 'Mail',
    title: 'Email schedules',
    summary: 'Send each operator only their own shifts for the week.',
    steps: [
      'Press Email schedules on Schedule. The number shows who hasn’t had this week’s email, or whose shifts changed since.',
      'Pick who to send to, check the preview, and send.',
      'After a change, send again: they get a Schedule change email listing what moved.',
    ],
    tips: ['Edit the wording for the whole team on the Emails page. Reset to original undoes your changes.'],
  },
  {
    id: 'roster',
    icon: 'IdCard',
    title: 'Roster',
    summary: 'Everyone who can be scheduled, their home lab and experience.',
    steps: [
      'Press Add operator, or Import to bring in the recruiting roster. Check the changes before anything saves.',
      'Set each operator’s home lab. Operators only work at their home lab.',
      'Experience: Auto counts completed sessions. Pick Experienced or New to override it.',
      'Admins: press Set up sign-in to give an operator a username and temporary password.',
    ],
    tips: [
      'Every pair needs at least one experienced operator.',
      'Added someone by mistake, like a typo in the email? Admins can delete them from Edit, as long as they have no clock-ins or other records. Anyone who has worked is set Inactive instead, which keeps their history.',
    ],
  },
  {
    id: 'review',
    icon: 'ClipboardCheck',
    title: 'Review and approve hours',
    summary: 'Check each operator’s day, decide on flags, then approve.',
    steps: [
      'Review opens on last week. Hours are due by Monday.',
      'Open a day to see the shift, the clock-ins and any flags.',
      'Decide each flag with a reason: accept the time, decline it, or note it.',
      'Approve the suggested hours. Admins can change them, with a note.',
      'Approve ready approves every day with no open flags, at the suggested hours.',
    ],
    tips: ['Reopen to correct takes a day out of the export until it’s approved again. The history keeps every step.'],
  },
  {
    id: 'flags',
    icon: 'Flag',
    title: 'What the flags mean',
    summary: 'Flags point out anything worth a look before you approve.',
    table: {
      head: ['Flag', 'What it means'],
      rows: [
        ['Late arrival', 'Clocked in 5 or more minutes after the start'],
        ['Left early', 'Clocked out before the end, usually with a reason'],
        ['Grace used', 'Clocked in before the start. Logged only, not counted unless you add it'],
        ['Outside shift', 'Time after the scheduled end'],
        ['No clock-out', 'Clocked in, never clocked out. Lotus suggests the scheduled end'],
        ['Auto clock-out', 'The operator forgot. Lotus closed the shift at its end'],
        ['No-show', 'Booked, never clocked in'],
        ['Not on the schedule', 'Clocked in with no shift booked'],
        ['Corrected', 'An admin set the times after a request'],
      ],
    },
    tips: ['Switching straight from one shift to the next is never flagged as late or leaving early.'],
  },
  {
    id: 'requests',
    icon: 'MessageSquareWarning',
    title: 'Missed clock-in requests',
    summary: 'Operators who forgot to clock send a request. Admins correct the times.',
    steps: [
      'Open requests sit at the top of Review, oldest first.',
      'Check with the scheduled partner, then set the real clock-in and clock-out times.',
      'Choose whether it counts as a miss. If it doesn’t, say why.',
      'The operator gets an email with the outcome.',
    ],
    tips: [
      'Got the request by email instead? Open the day and press Log an emailed request, so it’s on record.',
      'Only admins can change hours away from what the clock recorded.',
    ],
  },
  {
    id: 'strikes',
    icon: 'ShieldAlert',
    title: 'Strikes',
    summary: 'Each counted miss moves the operator one step. Lotus records it but never blocks anyone.',
    table: {
      head: ['Count', 'Step'],
      rows: [
        ['1st miss', 'Soft warning: logged and emailed'],
        ['2nd', 'Strike 1: noted'],
        ['3rd', 'Strike 2: a talk with the lead'],
        ['4th', 'Strike 3: a talk with the PM and a removal review'],
      ],
    },
    tips: [
      'The count clears after 30 clean days. A request more than 24 hours late adds a second step.',
      'See an operator’s history on their profile. An admin can cancel a step with a reason; it stays in the history as cancelled.',
      'The Strike 3 email always goes. Below that, the admin decides.',
    ],
  },
  {
    id: 'hours',
    icon: 'ChartColumn',
    title: 'Hours worked and operator hours',
    summary: 'Two different numbers, always labelled apart.',
    table: {
      head: ['Number', 'What it counts'],
      rows: [
        ['Hours worked', 'Robot time per robot per day. A pair working together counts once.'],
        ['Operator hours', 'Each operator’s own time, added up.'],
      ],
    },
  },
  {
    id: 'exports',
    icon: 'FileSpreadsheet',
    title: 'Records and Reports',
    summary: 'Raw clock-ins and approved hours are kept apart.',
    steps: [
      'Records: every clock-in and clock-out exactly as recorded. These are not approved hours.',
      'Reports: pick the dates, then download approved hours. Only approved days, one row per operator per day.',
    ],
  },
  {
    id: 'settings',
    icon: 'Settings',
    title: 'Settings, users and robots',
    summary: 'Appearance, sign-ins and robot names.',
    steps: [
      'Settings (the gear) switches light and dark mode and replays the tour.',
      'Admins: Users and sign-ins adds people, sets their roles, emails a reset link or turns off a sign-in.',
      'Admins: Robots names each robot. The robot’s number stays the same in every record.',
      'Search finds any operator or day from anywhere. Shortcut: Ctrl K (⌘K on a Mac).',
    ],
  },
];
