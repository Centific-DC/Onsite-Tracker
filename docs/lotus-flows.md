# Lotus on-site time tracking: SharePoint lists and Power Automate flows

Prompt for the bot that builds the backend. Copy everything below the line into the bot as one message.

---

You are building the backend for **Lotus**, an on-site time-tracking web app used by Centific on the Google Lotus project. The app is a static React page (GitHub Pages). It signs each person in with their Microsoft (Entra ID) work account and talks only to the two HTTP flows below, sending the person's access token. Build the SharePoint lists, the flows and the reminder email exactly as specified, because the app depends on these names and JSON shapes. When something here can't be done as written, stop and report what and why. Don't substitute something else.

## Ground rules

- **Site:** SharePoint site `DataCollectionUSHUB` (https://digitaltechedge.sharepoint.com/sites/DataCollectionUSHUB). Create every list there.
- **Identity comes from the token, never from the request body.** The HTTP triggers must be set to **Who can trigger: Any user in my tenant**. In each flow, get the caller's email from the validated token. Power Automate has already validated it before the flow runs.
    - Decode the bearer token's payload from the `Authorization` header and read `upn`, falling back to `preferred_username`, lower-cased.
    - Put this in one Compose named `callerEmail`.
    - Do a test run, and confirm the value appears in the run history before building further.
- **Roles** come from the `Lotus_Users` list (below), looked up by `callerEmail`. Someone not in the list, or with `Active` = No, gets **403** `{"error":"Not set up for Lotus. Ask your lead to add you."}`.
- **Time:**
    - Every timestamp the server records is `utcNow()` in ISO 8601 UTC.
    - Site-local date and time use `convertFromUtc(..., 'Pacific Standard Time', ...)`. Both labs (Redmond and Mountain View) are on Pacific time.
    - Never accept a client-supplied time for a clock-in or clock-out.
- **Append only:** `Lotus_Punches`, `Lotus_Approvals` and `Lotus_Audit` are only ever added to. Nobody edits or deletes their rows. Set list permissions so only the flow's connection account can edit them, and staff can read.
- **Every write action adds one `Lotus_Audit` row** (below), in the same run.
- **No money:** no rates, pay, markups or agency fields anywhere.
- **Responses:**
    - Always `Content-Type: application/json`.
    - Errors are `{"error":"<message a person can read>"}` with status 400, 403, 404 or 409.
    - Success is status 200.
- **Pagination:** turn on pagination (threshold 5000) on every *Get items*, so lists over 100 rows aren't cut off.
- **Columns:** text is *Single line of text* unless marked otherwise. The list's built-in `Title` column holds the key shown in each table. Don't rename internal column names after creating them.

## 1. SharePoint lists

### `Lotus_Users`: everyone who can sign in, operators and staff

| Column | Type | Example | Notes |
|---|---|---|---|
| `Title` | text | `avery.lin@centific.com` | Email, lower case. The key |
| `Name` | text | `Avery Lin` | Unique among active users. A duplicate gets ` 2`, ` 3` added |
| `OperatorID` | text | `OP-0007` | Operators only. `OP-` + 4 digits, never reused |
| `Roles` | text | `operator` or `scheduler;approver` | Any of `operator`, `scheduler`, `approver`, `reporting`, separated by `;` |
| `HomeLocation` | text | `RED` | `RED` (Redmond Lab) or `MTV` (Mountain View Lab) |
| `Cohort` | text | `Cohort 3` | From Active Roster 2 |
| `CompletedSessions` | number | `4` | From Active Roster 2 |
| `CompletedAsOf` | text | `2026-11-05` | Date of the import that set `CompletedSessions` |
| `TrainingStatus` | text | `Trained` | From Active Roster 2 |
| `Active` | yes/no | Yes | |

Seed it with the staff who need access: schedulers (recruiting), approvers (delivery managers) and reporting (agency reporting). I will send their emails and roles separately.

### `Lotus_Shifts`: the schedule

| Column | Type | Example |
|---|---|---|
| `Title` | text | `S-` + `guid()`. The ShiftID |
| `Date` | text | `2026-11-06` (`yyyy-MM-dd`, site-local) |
| `OperatorID` | text | `OP-0007` |
| `Email` | text | `avery.lin@centific.com` |
| `Name` | text | `Avery Lin` |
| `Location` | text | `RED` |
| `Robot` | text | `Robot 1` |
| `Template` | text | `RED-AM` (empty for a custom time) |
| `Start` | text | `07:00` (24h, site-local) |
| `End` | text | `12:30` |
| `Note` | text | `Backfill for Jordan` |
| `Source` | text | `app` or `import` |
| `ReminderSentAt` | text | ISO UTC, set by the reminder flow |
| `UpdatedBy` | text | caller email |
| `Updated` | text | ISO UTC |

### `Lotus_Punches`: every clock-in and clock-out (append only)

| Column | Type | Example |
|---|---|---|
| `Title` | text | `guid()`. The PunchID |
| `Timestamp` | text | `utcNow()`, ISO |
| `Date` | text | site-local `yyyy-MM-dd` |
| `Time` | text | site-local `HH:mm` |
| `OperatorID` | text | from `Lotus_Users` |
| `Email` | text | `callerEmail` |
| `Name` | text | from `Lotus_Users` |
| `InOut` | text | `IN` or `OUT` |
| `Location` | text | `RED` |
| `Robot` | text | `Robot 2` |
| `ShiftID` | text | the shift it belongs to, or empty when unscheduled |
| `GraceMinutes` | number | minutes before the scheduled start, computed by the flow |
| `Device` | text | `laptop` or `phone`, as reported by the app |
| `Flag` | text | `Left early` or empty |
| `Note` | text | the operator's reason for leaving early |
| `DeviceTime` | text | the device clock, for audits only |

### `Lotus_FlagResolutions`: a manager's decision on each flag

| Column | Type | Example |
|---|---|---|
| `Title` | text | the flag key the app sends, e.g. `avery.lin@centific.com\|2026-11-03\|outside_shift\|1762189200000` |
| `Outcome` | text | `accept`, `decline` or `noted` |
| `Reason` | multi-line text | required, never empty |
| `EndTime` | text | ISO UTC. Only for a missing clock-out, when the manager enters the real end |
| `By` | text | `callerEmail` |
| `At` | text | `utcNow()` |

If a flag is resolved again, update the existing row with the same `Title`. The audit row keeps the history.

### `Lotus_Approvals`: approvals for each operator and day (append only)

| Column | Type | Example |
|---|---|---|
| `Title` | text | `guid()` |
| `DayKey` | text | `avery.lin@centific.com\|2026-11-03` |
| `OperatorID` | text | `OP-0007` |
| `Email` | text | `avery.lin@centific.com` |
| `Date` | text | `2026-11-03` |
| `Status` | text | `approved` or `reopened` |
| `Hours` | number | approved hours, 2 decimals |
| `ComputedHours` | number | what the app suggested |
| `Note` | multi-line text | required when `Hours` differs from `ComputedHours`, or when reopening |
| `Final` | yes/no | set when monthly reporting locks the month |
| `By` | text | `callerEmail` |
| `At` | text | `utcNow()` |

The latest row per `DayKey` is the current state.

### `Lotus_Audit` (append only)

| Column | Type | Example |
|---|---|---|
| `Title` | text | `guid()` |
| `At` | text | `utcNow()` |
| `By` | text | `callerEmail` |
| `Action` | text | `punch`, `shift_upsert`, `shift_delete`, `users_upsert`, `resolve_flag`, `approve_day`, `reopen_day`, `client` |
| `Target` | text | the row key it touched |
| `Before` | multi-line text | JSON of the row before, or empty |
| `After` | multi-line text | JSON of the row after |

### `Lotus_ClientHours`

| Column | Type | Example |
|---|---|---|
| `Title` | text | week's Monday `2026-11-02` |
| `SuccessfulHours` | number | `61.5` |
| `Updated` | text | ISO UTC |

## 2. Flow: **Lotus Read**

Trigger *When an HTTP request is received*, POST, **Any user in my tenant**. Body: `{ "action": "all", "from": "yyyy-MM-dd" }`. `from` defaults to 60 days ago.

1. `callerEmail`, then look up `Lotus_Users`, using the 403 rule above. Compose `roles` = `split(Roles, ';')`.
2. Get items from `Lotus_Shifts` with `Date ge '<from>'`, `Lotus_Punches` with `Date ge '<from>'`, `Lotus_FlagResolutions`, `Lotus_Approvals` with `Date ge '<from>'`, and `Lotus_ClientHours`. Get `Lotus_Users` too, but only for staff.
3. **If the caller has only the `operator` role**, keep only rows whose `Email` = `callerEmail` in shifts, punches, approvals and resolutions (resolution keys start with the email). Return `operators` as just their own user row and `client` as `[]`. Operators must never receive anyone else's rows.
4. Response 200 (field names are lower camel case, exactly):

```json
{
  "me": { "email": "", "name": "", "operatorId": "", "roles": ["operator"], "location": "RED" },
  "operators": [{ "id": "OP-0007", "email": "", "name": "", "location": "RED", "roles": ["operator"], "cohort": "", "completedSessions": 4, "completedAsOf": "", "training": "", "active": true }],
  "schedule": [{ "id": "S-…", "date": "", "operatorId": "", "email": "", "name": "", "location": "RED", "station": "Robot 1", "template": "RED-AM", "start": "07:00", "end": "12:30", "note": "" }],
  "punches": [{ "id": "", "ts": "", "operatorId": "", "email": "", "name": "", "type": "in", "location": "RED", "station": "Robot 1", "shiftId": "", "grace": 0, "source": "laptop", "flag": "", "note": "" }],
  "resolutions": [{ "key": "", "outcome": "accept", "reason": "", "endTime": "", "by": "", "at": "" }],
  "approvals": [{ "email": "", "operatorId": "", "date": "", "status": "approved", "hours": 5.5, "computed": 5.5, "note": "", "final": false, "by": "", "at": "" }],
  "client": [{ "week": "2026-11-02", "hours": 61.5 }]
}
```

`type` is `toLower(InOut)`, and `flag` is `early` when `Flag` is not empty.

## 3. Flow: **Lotus Write**

Trigger as above. Body: `{ "action": "...", ...fields }`. Look up the caller first, then **Switch on `action`**. Each case checks its role: the wrong role gets **403** `{"error":"Your role can't do that"}`. Each case writes its `Lotus_Audit` row before responding.

### `punch`: role `operator`

Body: `{ "type": "in" | "out", "shiftId": "", "location": "", "station": "", "device": "laptop" | "phone", "flag": "", "note": "", "deviceTs": "" }`

**Clock-in (`type` = `in`):**
1. With a `shiftId`, get that shift. It must exist, and its `Email` must equal `callerEmail`, else 404.
2. Compute the shift's start and end as site-local times on `Date`. An end at or before the start runs past midnight.
3. Get the grace window: 10 minutes. Keep it in one Compose named `graceMinutes` so it can be changed.
4. If now is earlier than start minus grace, return **409** `{"error":"Clock-in opens at <h:mm AM/PM>", "code":"early", "opensAt":"<ISO>"}`. If now is after the end, return **409** `{"error":"That shift has ended", "code":"over"}`.
5. `GraceMinutes` = whole minutes from now to the start when now is before the start, else 0.
6. Without a `shiftId`, it is an unscheduled clock-in. Allow it, with `ShiftID` empty. `location` and `station` must be set.
7. If the caller already has an `IN` today with no `OUT` after it, return **409** `{"error":"You're already clocked in", "code":"open"}`.

**Clock-out (`type` = `out`):** must follow an open `IN` from the caller, else 409 `{"error":"You're not clocked in","code":"not_in"}`. Copy that IN's `ShiftID`, `Location` and `Robot`. A clock-out after the scheduled end is accepted. The app flags the extra time for review, so the flow doesn't. If `flag` = `early`, set `Flag` = `Left early` and `note` must not be empty.

Then add the `Lotus_Punches` row. Respond `{ "ok": true, "punch": { …same shape as in Read… } }`.

If `Flag` = `Left early`, send an email from the shared mailbox (the email step below) to the approvers. These are the `Lotus_Users` rows with `approver` in `Roles`. Subject `Early clock-out: <Name>`. Body: name, location, robot, site-local time, scheduled end, and the reason.

### `shift_upsert`: role `scheduler`

Body: `{ "shifts": [ { "id"?: "", "date", "operatorId", "email", "name", "location", "station", "template", "start", "end", "note", "source" } ] }`. Up to 200 per call.

For each shift: check that `date` is `yyyy-MM-dd`, `start` and `end` are `HH:mm`, and `email` is in `Lotus_Users`. With an `id`, update that row. Without one, create it with `Title` = `S-` + `guid()`. Respond `{ "ok": true, "shifts": [ …saved shifts, same shape as Read… ] }`. The app has already shown the scheduler any warnings (37 hrs, conflicts, pairing), so don't block on those.

### `shift_delete`: role `scheduler`

Body `{ "id": "S-…" }`. Delete it, and return `{ "ok": true }` even if it was already gone.

### `users_upsert`: role `scheduler`

Body `{ "users": [ { "id"?: "OP-…", "email", "name", "location", "cohort", "completedSessions", "completedAsOf", "training", "roles"?: ["operator"], "active"?: true } ] }`. Up to 500 per call, used by the Active Roster 2 import.

- Match users by email.
- A new operator without an `id` gets the next free `OP-0000` number. Find the highest existing number and add one, so numbers are never reused.
- Only staff with the `approver` role may grant roles other than `operator`. Ignore `roles` from a scheduler.

Respond `{ "ok": true, "users": [ … ] }`.

### `resolve_flag`: role `approver`

Body `{ "key", "outcome": "accept" | "decline" | "noted", "reason", "endTime"? }`. `reason` must not be empty (400). Upsert the `Lotus_FlagResolutions` row by `Title` = `key`. Respond `{ "ok": true, "resolution": { … } }`.

### `approve_day` and `reopen_day`: role `approver`

Body `{ "email", "operatorId", "date", "hours", "computed", "note" }`.
- `approve_day`: `note` is required when `hours` ≠ `computed`.
- `reopen_day`: `note` is required.
- If the latest row for that `DayKey` has `Final` = Yes, refuse with 409 `{"error":"That month is final","code":"final"}`.

Add a `Lotus_Approvals` row with `Status` `approved` or `reopened`. Respond `{ "ok": true, "approval": { … } }`.

### `client`: role `approver` or `scheduler`

Body `{ "week", "hours" }`. Upsert `Lotus_ClientHours` by `Title` = week, or delete the row when `hours` is null. Respond `{ "ok": true }`.

### Default

400 `{"error":"Unknown action"}`.

## 4. Flow: **Lotus Shift Reminders** (scheduled)

- **Trigger:** recurrence, daily at 3:00 PM Pacific.
- **Sender:** send every email with **Office 365 Outlook → Send an email from a shared mailbox (V2)**, mailbox `project_lotus@centific.com`. The flow's connection account needs *Send As* on that mailbox.

1. Get `Lotus_Shifts` where `Date` = tomorrow (site-local) and `ReminderSentAt` is empty.
2. Group the shifts by `Email`. Send each operator one email:
    - Subject `Your Lotus shift tomorrow: <Day, Mon d>`.
    - Body: each shift's lab name (RED = Redmond Lab, MTV = Mountain View Lab), robot, and start and end in 12-hour time.
    - Body: who they're paired with (the other operators on the same robot whose times overlap).
    - Body: the line "Clock in on the Lotus page when you arrive. Clock-in opens 10 minutes before your start."
3. Set `ReminderSentAt` = `utcNow()` on each shift you emailed, so nobody gets a second reminder if the flow re-runs.
4. **Dry-run switch:** a Compose named `dryRun`, default `true`. While it is true, send everything to `project_lotus@centific.com` only, with the intended recipient at the top of the body, and leave `ReminderSentAt` unset. The scheduling team checks a few days of dry runs before it is turned off.
5. **Avoiding duplicates:** before `dryRun` goes false, the scheduling team turns off their existing Outlook reminder process. Note this in the flow's description.

## 5. Tests to run before handing over

1. Call **Lotus Read** with no token. It must fail with 401, from Power Automate itself.
2. Call **Lotus Read** with a token for an operator. You get only that operator's rows, and `operators` holds only them.
3. Call **Lotus Write** `punch` `in` 20 minutes before a shift. You get 409 `early`. At 6 minutes before, it saves with `GraceMinutes` = 6.
4. Send a body `email` that is someone else's. The punch is still saved under `callerEmail`.
5. As an operator, call `approve_day`. You get 403.
6. As an approver, call `approve_day` with `hours` ≠ `computed` and no note. You get 400. With a note it saves, and a `Lotus_Audit` row appears.
7. Four different operators clock in within one minute. You get four rows with the right names.
8. Run the reminder flow with `dryRun` = true. One email per operator arrives at the alias, and `ReminderSentAt` stays empty.

When done, reply with:
- the two HTTP trigger URLs
- the exact expression you used for `callerEmail`
- anything you couldn't build as specified
