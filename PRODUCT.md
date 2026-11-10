# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React + Vite, static build deployed to GitHub Pages. Sign-in: usernames and passwords that a Lotus admin hands out, as in the Project Atlas app (Lotus Auth flow; the browser sends only a PBKDF2 hash; temp passwords must be changed at first sign-in; 12-hour sign-in tokens). Data: SharePoint lists on the DataCollectionUSHUB site, read and written through the Power Automate HTTP flows Lotus Read and Lotus Write, which check the sign-in token on every call. With no flow URLs configured, the app runs in demo mode on sample data kept in the browser.

## Users

- **Operators** (on-site moderators, later contractors), staffed by Centific on the Google DeepMind on-site project. They work in pairs on a robot, typically on 6-hour shifts. They check in on arrival and check out on leaving, on their own phone, or on a shared tablet at the site entrance.
- **Leads (David Kang, Kate Young)**: during the day they watch who is on site and catch early departures. Weekly, they report totals per person and hours worked vs. successful hours. They reconcile the log against the client's badge in/out records.

## Product Purpose

Gives the team its own reliable record of who is at the client site and when. The trigger was an operator who left a shift early without telling anyone; the team heard about it from the client. Success means:

- the team knows about absences and early departures before the client does;
- backfills can be planned;
- weekly hours per person are known;
- hours worked can be compared with the client's successful hours and badge records. This matters more once contractors are involved.

## Positioning

The unit is the robot, not the person. Two people working the same robot at the same time count robot time once: hours worked merge everyone's overlapping time per robot per day. Operator hours are still tracked for each individual.

## Operating Context

- Check-ins happen at the door, standing up, often in a hurry. They have to work in one or two taps on a phone, or on a shared tablet where each person identifies themselves.
- Leads check the app on laptops and phones throughout the day.
- Weekly reporting and badge reconciliation work from CSV exports and the Excel sheet.

## Capabilities and Constraints

- Renamed Lotus (2026-11-05). Goal: the operational source for scheduled shifts, actual attendance and manager-approved hours. Recruiting reports approved hours to the agency; raw check-ins are never treated as payable.
- Roles: operator, scheduler (recruiting admin), approver (delivery manager), reporting, admin (manages sign-ins). Everyone has their own username; admins set it and a temp password when adding an operator on Roster, or from Settings → Users and sign-ins. Roles come from the `Lotus_Users` list and the flows enforce them. Operators only ever receive their own rows. No agency rates or markups anywhere.
- Locations: Redmond Lab (Robots 1–2; runs 7 days; Morning 7:00–12:30 needs 2 operators, Afternoon 12:00–17:30 needs 2, Night 17:00–23:00 needs 4, a pair on each robot) and Mountain View Lab (Robots 3–4, configurable). Each robot keeps its id in every record and can carry a name set by admins in Settings → Robots (2026-11-09: Robot 1 Stationary, Robot 2 Mobile, Robot 3 franka-thor-02, Robot 4 jetson-thor-004). Overlapping templates are expected handovers, never a flag. Location shows on every shift, clock-in, view and export.
- Clock-in is tied to the operator's assigned shift, uses server time only, opens a configurable grace window (10 min) before the start and records the grace used. Unscheduled clock-ins are allowed and flagged. Clock-out after the end is accepted; extra time over 5 min is flagged and only counts if an approver accepts it. A missing clock-out is never filled in silently: the approver sees a system-suggested end and accepts it or types the real time.
- Approved hours = time inside the scheduled shift + extra time an approver accepted, or an adjusted figure with a note. Weekly review queue (operators' weeks reviewed by Monday), reopenable until the month is final. The approved-hours export has fixed columns for Jaydeep's agency-reporting import (docs/lotus-flows.md, the data contract in the plan).
- Scheduling: open slots per template, pairing risk when everyone on a slot has under 2 completed sessions (confirm before booking), the 37 hrs weekly limit, conflicts. Recruiting's Excel tracker and Active Roster 2 stay the master for now, imported as CSV; the app can replace them later.
- Names are unique; a taken name gets the next number ("Jordan Pike 2"). Operator IDs (`OP-0001`) are permanent and are the key in exports.
- Undecided, needing the user's confirmation: phone location check (proposed: rotating QR site code on the lab laptop), automatic clock-out (built as suggest-only), full Excel replacement, optional episode counts (kept apart from attendance). Shift reminders send from project_lotus@centific.com through the Reminders flow, in test mode until the old Outlook reminders are off.
- Emails (2026-11-05): schedulers email each operator their own week from the Schedule tab ("not sent", "changed since" and "up to date" are tracked per operator and week), and approvers get a Monday 8:00 AM reminder for last week's timesheets. Templates follow the Project Atlas email format (Centific header, details card, note boxes, button) and are edited on the Emails page. One `EmailTestMode` switch keeps every Lotus email at the project alias until the team turns it off.
- Missed clock-ins and outs (project owner, 2026-11-10): only admins change hours away from what the clock recorded (approving different hours, typing a clock-in or clock-out time, crediting a missed shift); approvers approve as recorded, and the flows enforce it. An operator who forgot taps "Forgot to clock in or out?" on their timesheet; Lotus emails the admins and copies them (the paper trail). An admin checks with the scheduled partner, sets the real times with a note, or declines; the punches never change. Each counted miss (a missed clock-in, a missed clock-out, and a request more than 24 hours late) is a step: soft warning, Strike 1 (noted), Strike 2 (talk with the lead), Strike 3 (talk with the PM and a removal review). The count clears after 30 days with no new miss. Lotus never blocks anyone; an admin can cancel a step with a reason. Operators see their own step on their timesheet, never anyone else's. Requests wait in Review; each operator's profile shows their history.
- The approved-hours export carries `time_in` and `time_out` (first clock-in, last clock-out or the end time a manager accepted) next to `work_date`.

## Brand Commitments

Centific internal tool for a client engagement. Do not use client logos, wordmarks or other branding assets; the project name appears only as plain text.

User-pinned (2026-10-28):
- Apple-inspired: simple, uncluttered, one integrated system.
- A light mode and a dark mode, both with a color scheme lightly inspired by Google's four-color palette (blue, red, yellow, green), used for the colors' jobs rather than as branding.

## Evidence on Hand

No real check-in data yet. Demo data is synthetic and must stay labelled as demo. There are no client numbers to show beyond what leads enter.

## Product Principles

1. Checking in is the smallest possible action. Anything that slows it at the door is a cost paid every shift.
2. Show what needs a lead's attention first (who's missing, who left early), then totals.
3. Never double-count a pair. Hours worked (robot time, merged) and operator hours (each operator's own time) are always labelled distinctly; the UI never says "delivered".
4. The record has to be trustworthy enough to set beside the client's badge data: server time, nothing hidden or edited silently.

## Accessibility & Inclusion

Large touch targets for use at the door, and readable on a shared tablet at arm's length. UX and motion follow `ux-behavior-spec.md`, including reduced motion.
