# Lotus on-site time tracking: SharePoint lists and Power Automate flows

Prompt for the bot that builds the backend. Copy everything below the line into the bot as one message.

---

You are building the backend for **Lotus**, an on-site time-tracking web app used by Centific on the Google Lotus project. The app is a static React page (GitHub Pages). Everyone signs in with a **username and password that a Lotus admin hands out** (the same pattern as the Project Atlas app), through the **Lotus Auth** flow below. Sign-in returns a token, and every call to the other two HTTP flows carries it in the body. Build the SharePoint lists, the flows and the reminder email exactly as specified, because the app depends on these names and JSON shapes. When something here can't be done as written, stop and report what and why. Don't substitute something else.

## Ground rules

- **Site:** SharePoint site `DataCollectionUSHUB` (https://digitaltechedge.sharepoint.com/sites/DataCollectionUSHUB). Create every list there.
- **Identity comes from the sign-in token, never from anything else in the request body.** No Microsoft accounts are involved. All three HTTP triggers (Lotus Auth, Lotus Read, Lotus Write) are set to **Who can trigger: Anyone**, because the app is a public page and the token is the check.
    - Every Read and Write body has `"token": "<64 hex characters>"`. The app sends it as `Content-Type: text/plain` (to avoid a CORS preflight), so parse the body with `json(triggerBody())` and don't set a schema that requires `application/json`.
    - **Token check** (first step of Read and Write, and of the Auth ops that need it): get the `Lotus_Users` row where `Token` = the body's `token` (top 1). If there's no row, `Active` = No, or `TokenExpires` is before `utcNow()`, respond **401** `{"error":"Please sign in again."}`. If `MustChangePassword` = Yes, respond **403** `{"error":"Choose your own password first."}`.
    - Put the row's `Title` (the email, lower case) in one Compose named `callerEmail`. Everything below uses it.
- **Roles** come from that same row: `Roles`, split on `;`.
- **Passwords never reach the flows.** The app hashes them in the browser (PBKDF2-SHA256, 210,000 iterations, 16-byte salt, base64) and sends only the hash. The flow stores and compares hashes and salts; it never computes one.
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
| `Username` | text | `avery.lin` | What they type to sign in. Unique, compared lower-cased. Set by an admin |
| `Roles` | text | `operator` or `scheduler;approver` | Any of `operator`, `scheduler`, `approver`, `reporting`, `admin`, separated by `;`. Only set through the Auth flow's user ops |
| `HomeLocation` | text | `RED` | `RED` (Redmond Lab) or `MTV` (Mountain View Lab) |
| `Cohort` | text | `Cohort 3` | From Active Roster 2 |
| `CompletedSessions` | number | `4` | From Active Roster 2 |
| `CompletedAsOf` | text | `2026-11-05` | Date of the import that set `CompletedSessions` |
| `TrainingStatus` | text | `Trained` | From Active Roster 2 |
| `Experience` | choice | `experienced` | Set by an admin on Roster: `experienced`, `new`, or empty (then the app decides from `CompletedSessions`). Every pair needs at least one experienced operator |
| `Active` | yes/no | Yes | No = can't sign in |
| `PasswordSalt` | text | base64 | Empty = this person has no sign-in yet (e.g. just imported from the roster) |
| `PasswordHash` | text | base64 | |
| `MustChangePassword` | yes/no | Yes | Yes after an admin adds or resets them: they must pick their own password |
| `FailedCount` | number | `0` | Wrong passwords in a row |
| `LockedUntil` | text | ISO UTC | Set for 15 minutes after 5 wrong passwords |
| `Token` | text | 64 hex characters | Current sign-in. Empty = signed out |
| `TokenExpires` | text | ISO UTC | 12 hours after sign-in |
| `LastSignIn` | text | ISO UTC | |

**Permissions:** this list holds password hashes and sign-in tokens, so only the flows' connection account may read or edit it. Break inheritance and remove everyone else. The Read flow returns users without any of the last seven columns.

The first admin is created by the Auth flow's `bootstrap` op (below). After that, admins add everyone else from the app's Users page.

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
| `RecordedAt` | text | `utcNow()`; returned as `at` |

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
| `RecordedAt` | text | `utcNow()`; returned as `at` |

The latest row per `DayKey` is the current state.

### `Lotus_Audit` (append only)

| Column | Type | Example |
|---|---|---|
| `Title` | text | `guid()` |
| `RecordedAt` | text | `utcNow()`; returned as `at` |
| `By` | text | `callerEmail` |
| `Action` | text | `punch`, `shift_upsert`, `shift_delete`, `users_upsert`, `resolve_flag`, `approve_day`, `reopen_day`, `client`, `email_send`, `template_save` |
| `Target` | text | the row key it touched |
| `Before` | multi-line text | JSON of the row before, or empty |
| `After` | multi-line text | JSON of the row after |

### `Lotus_ClientHours`

| Column | Type | Example |
|---|---|---|
| `Title` | text | week's Monday `2026-11-02` |
| `SuccessfulHours` | number | `61.5` |
| `Updated` | text | ISO UTC |

### `Lotus_Notices`: every schedule email sent (append only)

One row per email the app sends from the Schedule tab. The app compares `Snapshot` with the current shifts to show who is "not sent", "changed since" or "up to date".

| Column | Type | Example |
|---|---|---|
| `Title` | text | `N-` + `guid()` |
| `Email` | text | recipient operator, lower case |
| `OperatorId` | text | `OP-0007` |
| `WeekStart` | text | the week's Monday, `2026-11-09` |
| `Kind` | text | `operator-schedule` or `operator-schedule-update` |
| `Subject` | text | the subject sent |
| `SentAt` | text | `utcNow()` |
| `By` | text | `callerEmail` |
| `Test` | yes/no | Yes when it went to the alias only (test mode) |
| `Snapshot` | multi-line text | JSON array of the shifts listed: `[{ "id", "date", "start", "end", "station", "location", "template" }]` |

### `Lotus_Templates`: the email templates

One row per template, edited on the app's Emails page. Missing rows mean the app's built-in default.

| Column | Type | Example |
|---|---|---|
| `Title` | text | `operator-schedule`, `operator-schedule-update`, `approver-weekly` |
| `Subject` | text | `Lotus timesheets for {reviewWeek} are ready to approve` |
| `Html` | multi-line text (plain, not rich) | the editable body, with field chips |
| `Ready` | multi-line text (plain, not rich) | the whole email (header, body, footer) with `{{field}}` tokens; the Monday flow uses this |
| `Original` | yes/no | Yes after "Reset to original" |
| `UpdatedAt` | text | `utcNow()` |
| `UpdatedBy` | text | `callerEmail` |

### `Lotus_Settings`

One row, `Title` = `main`, with `EmailTestMode` (yes/no, **default Yes**). While it is Yes, every email from every Lotus flow goes to `project_lotus@centific.com` only, with the intended recipient at the top of the body. The scheduling team switches it off once they have checked a few days of test emails and turned off their manual Outlook emails.

## 2. Flow: **Lotus Auth**

Trigger *When an HTTP request is received*, POST, **Anyone**. Body (parse with `json(triggerBody())`): `{ "schemaVersion": 1, "op": "...", ...fields }`. **Switch on `op`.** Replies are JSON; errors are `{"ok": false, "message": "<sentence a person can read>"}` with the status shown. This flow writes a `Lotus_Audit` row (`Action` = `auth_<op>`) for every op except `salt`, without hashes, salts or tokens.

Usernames: compare lower-cased and trimmed. `username` may also be an email, so "find the user" means the `Lotus_Users` row where `toLower(Username)` = it, **or** `Title` = it.

Make the token with `concat(replace(guid(),'-',''), replace(guid(),'-',''))` (64 hex characters).

| `op` | Body | Who | What it does |
|---|---|---|---|
| `salt` | `{ "username" }` | anyone | Find the user. If found, `Active` = Yes and `PasswordSalt` isn't empty, respond 200 `{ "salt": PasswordSalt }`. Otherwise respond 200 `{ "salt": "THf0dXNVbmtub3duU2FsdA==" }` (a fixed fake one), so the reply never shows who has an account |
| `signin` | `{ "username", "hash" }` | anyone | Find the user. If missing, `Active` = No, no `PasswordHash`, or `LockedUntil` is after now: 401 `Username or password is wrong, or the account is locked.` If `hash` ≠ `PasswordHash`: add 1 to `FailedCount`; at 5, set `LockedUntil` = now + 15 minutes and `FailedCount` = 0; respond the same 401. Otherwise set `Token`, `TokenExpires` = now + 12 hours, `FailedCount` = 0, `LockedUntil` empty, `LastSignIn` = now, and respond 200 `{ "ok": true, "token", "expiresAt", "user": USER }` |
| `change-password` | `{ "token", "currentHash", "newSalt", "newHash" }` | signed in (allowed while `MustChangePassword` = Yes) | Token check. If `currentHash` ≠ `PasswordHash`: 401 `Your current password is wrong.` Else set `PasswordSalt` = `newSalt`, `PasswordHash` = `newHash`, `MustChangePassword` = No. 200 `{ "ok": true, "user": USER }` |
| `signout` | `{ "token" }` | anyone | Clear `Token` and `TokenExpires` on the row with that token, if any. Always 200 `{ "ok": true }` |
| `user.list` | `{ "token" }` | `admin` | 200 `{ "ok": true, "users": [ USER + { "active", "lastSignIn", "lockedUntil" } ] }`, every row that has a `Username` |
| `user.create` | `{ "token", "user": { "username", "email", "name", "roles": [], "operatorId"? }, "salt", "hash" }` | `admin` | `username` not empty, no spaces; `email` valid; at least one known role, else 400. If another row already has that `Username`: 409 `That username is taken.` If a row with that email exists **and has a `PasswordHash`**: 409 `That person already has a sign-in.` If the row exists without one (e.g. imported from the roster), update it; otherwise create it (a new operator gets the next `OP-` number, as in `users_upsert`). Set `Username`, `Name`, `Roles` (joined with `;`), `PasswordSalt` = `salt`, `PasswordHash` = `hash`, `MustChangePassword` = Yes, `Active` = Yes, `FailedCount` = 0. 200 `{ "ok": true }` |
| `user.update` | `{ "token", "username", "changes": { "name"?, "username"?, "roles"?, "active"? } }` | `admin` | Find the user, else 404. An admin can't change their own `roles` or `active` (400 `You can’t change your own roles or turn off your own sign-in.`). A new `username` must be free (409). `roles` needs at least one known role. `active` = false also clears `Token`. 200 `{ "ok": true }` |
| `user.reset` | `{ "token", "username", "salt", "hash" }` | `admin` | Find the user, else 404. Set the new salt and hash, `MustChangePassword` = Yes, `FailedCount` = 0, clear `LockedUntil` and `Token`. 200 `{ "ok": true }` |
| `bootstrap` | `{ "user": { "username", "email", "name" }, "salt", "hash" }` | anyone, **only while no active row has `admin` in `Roles`** | Otherwise 403 `Lotus already has an admin.` Create the row with `Roles` = `admin;scheduler;approver;reporting`, `MustChangePassword` = No, `Active` = Yes. 200 `{ "ok": true }` |
| anything else | | | 400 `Unknown request.` |

USER is `{ "username", "email", "name", "roles": ["scheduler","approver"], "operatorId", "mustChangePassword": false }`. Never return `PasswordSalt` (except from `salt`), `PasswordHash` or another person's `Token`.

The app opens the first-run screen at `<app URL>?setup=1`. Once an admin exists, `bootstrap` always refuses.

## 3. Flow: **Lotus Read**

Trigger *When an HTTP request is received*, POST, **Anyone**. Body: `{ "action": "all", "from": "yyyy-MM-dd", "token": "…" }`. `from` defaults to 60 days ago.

1. The token check above gives `callerEmail` and the caller's row. Compose `roles` = `split(Roles, ';')`.
2. Get items from `Lotus_Shifts` with `Date ge '<from>'`, `Lotus_Punches` with `Date ge '<from>'`, `Lotus_FlagResolutions`, `Lotus_Approvals` with `Date ge '<from>'`, and `Lotus_ClientHours`. Get `Lotus_Users`, `Lotus_Notices` with `WeekStart ge '<from>'` and `Lotus_Templates` too, but only for staff. Read `EmailTestMode` from `Lotus_Settings`.
3. **If the caller has only the `operator` role**, keep only rows whose `Email` = `callerEmail` in shifts, punches, approvals and resolutions (resolution keys start with the email). Return `operators` as just their own user row, and `client`, `notices` and `templates` as `[]`. Operators must never receive anyone else's rows.
   - **The one exception is partners' names** (user decision, 2026-11-05). Before filtering, for each of the caller's shifts, find the other `Lotus_Shifts` rows with the same `Date`, `Location` and `Station`, a different `Email`, whose time overlaps at least half of the caller's shift (so the half-hour handover between Morning and Afternoon doesn't count; an end at or before the start runs past midnight). Return them as `partners`: `[{ "shiftId": "<the caller's shift id>", "name": "<the partner's Name>" }]`. Send only these two fields: never the partner's email, operator ID, times, punches or hours. Staff callers get `partners: []` (they already have the whole schedule).
4. Response 200 (field names are lower camel case, exactly):

```json
{
  "me": { "email": "", "name": "", "operatorId": "", "roles": ["operator"], "location": "RED" },
  "operators": [{ "id": "OP-0007", "email": "", "name": "", "location": "RED", "roles": ["operator"], "cohort": "", "completedSessions": 4, "completedAsOf": "", "training": "", "active": true }],
  "schedule": [{ "id": "S-…", "date": "", "operatorId": "", "email": "", "name": "", "location": "RED", "station": "Robot 1", "template": "RED-AM", "start": "07:00", "end": "12:30", "note": "" }],
  "partners": [{ "shiftId": "S-…", "name": "Avery Lin" }],
  "punches": [{ "id": "", "ts": "", "operatorId": "", "email": "", "name": "", "type": "in", "location": "RED", "station": "Robot 1", "shiftId": "", "grace": 0, "source": "laptop", "flag": "", "note": "" }],
  "resolutions": [{ "key": "", "outcome": "accept", "reason": "", "endTime": "", "by": "", "at": "" }],
  "approvals": [{ "email": "", "operatorId": "", "date": "", "status": "approved", "hours": 5.5, "computed": 5.5, "note": "", "final": false, "by": "", "at": "" }],
  "client": [{ "week": "2026-11-02", "hours": 61.5 }],
  "notices": [{ "id": "N-…", "email": "", "operatorId": "", "weekStart": "2026-11-09", "kind": "operator-schedule", "subject": "", "sentAt": "", "by": "", "test": true, "snapshot": [] }],
  "templates": [{ "id": "operator-schedule", "subject": "", "html": "", "original": false, "updatedAt": "", "updatedBy": "" }],
  "emailTestMode": true
}
```

`snapshot` is `json(Snapshot)`. Leave `Ready` out of `templates`; the app doesn't need it.

`type` is `toLower(InOut)`, and `flag` is `early` when `Flag` is not empty.

## 4. Flow: **Lotus Write**

Trigger as above (**Anyone**). Body: `{ "action": "...", "token": "…", ...fields }`. Run the token check first, then **Switch on `action`**. Each case checks its role: the wrong role gets **403** `{"error":"Your role can't do that"}`. Each case writes its `Lotus_Audit` row before responding.

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

Body `{ "users": [ { "id"?: "OP-…", "email", "name", "location", "cohort", "completedSessions", "completedAsOf", "training", "experience"?: "experienced" | "new" | "", "roles"?: ["operator"], "active"?: true } ] }`. Up to 500 per call, used by the Active Roster 2 import and when an admin marks an operator Experienced or New.

- Match users by email.
- Change only the fields present in the body. The roster import never sends `experience`, so an admin's mark survives re-imports.
- A new operator without an `id` gets the next free `OP-0000` number. Find the highest existing number and add one, so numbers are never reused.
- Ignore `roles`, `username` and every password and token column: roles and sign-ins are changed only through the Auth flow's `user.*` ops, by an admin. A new row gets `Roles` = `operator` and no password (so it can't sign in until an admin gives it one).

Respond `{ "ok": true, "users": [ … ] }`.

### `resolve_flag`: role `approver`

Body `{ "key", "outcome": "accept" | "decline" | "noted", "reason", "endTime"? }`. `reason` must not be empty (400). Upsert the `Lotus_FlagResolutions` row by `Title` = `key`. Respond `{ "ok": true, "resolution": { … } }`.

### `approve_day` and `reopen_day`: role `approver`

Body `{ "email", "operatorId", "date", "hours", "computed", "note" }`.
- `approve_day`: `note` is required when `hours` ≠ `computed`.
- `reopen_day`: `note` is required.
- If the latest row for that `DayKey` has `Final` = Yes, refuse with 409 `{"error":"That month is final","code":"final"}`.

Add a `Lotus_Approvals` row with `Status` `approved` or `reopened`. Respond `{ "ok": true, "approval": { … } }`.

### `email_send`: role `scheduler`

The app fills in each email from the templates and sends them ready to go. Body:

```json
{ "kind": "schedule", "weekStart": "2026-11-09",
  "messages": [ { "to": "avery.lin@centific.com", "operatorId": "OP-0001", "name": "Avery Lin", "kind": "operator-schedule", "subject": "", "html": "", "snapshot": [] } ] }
```

Up to 25 messages per call. For each message:

1. `to` must be an active row in `Lotus_Users` with the `operator` role, else 400 `{"error":"<to> isn't a Lotus operator"}` and nothing is sent. This keeps the flow from emailing anyone outside the project.
2. `html` must be under 200 KB.
3. Send with **Send an email from a shared mailbox (V2)**, mailbox `project_lotus@centific.com`, *Is HTML* = Yes, *Reply To* = `project_lotus@centific.com`. While `EmailTestMode` is Yes, send to `project_lotus@centific.com` instead, with a first line `Test mode · intended for <to>` above the HTML.
4. Add a `Lotus_Notices` row (`Test` = `EmailTestMode`, `Snapshot` = `string(snapshot)`).

Respond `{ "ok": true, "notices": [ …the new rows, same shape as Read… ] }`. One `Lotus_Audit` row per message (`After` without `Html`).

### `template_save`: role `scheduler`

Body `{ "id", "subject", "html", "ready", "original"? }`. `id` must be one of the three template ids. Upsert `Lotus_Templates` by `Title` = `id`, set `UpdatedAt` and `UpdatedBy`. Respond `{ "template": { "id", "subject", "html", "original", "updatedAt", "updatedBy" } }`.

### `client`: role `approver` or `scheduler`

Body `{ "week", "hours" }`. Upsert `Lotus_ClientHours` by `Title` = week, or delete the row when `hours` is null. Respond `{ "ok": true }`.

### Default

400 `{"error":"Unknown action"}`.

## 5. Flow: **Lotus Shift Reminders** (scheduled)

- **Trigger:** recurrence, daily at 3:00 PM Pacific.
- **Sender:** send every email with **Office 365 Outlook → Send an email from a shared mailbox (V2)**, mailbox `project_lotus@centific.com`. The flow's connection account needs *Send As* on that mailbox.

1. Get `Lotus_Shifts` where `Date` = tomorrow (site-local) and `ReminderSentAt` is empty.
2. Group the shifts by `Email`. Send each operator one email:
    - Subject `Your Lotus shift tomorrow: <Day, Mon d>`.
    - Body: each shift's lab name (RED = Redmond Lab, MTV = Mountain View Lab), robot, and start and end in 12-hour time.
    - Body: who they're paired with (the other operators on the same robot whose times overlap).
    - Body: the line "Clock in on the Lotus page when you arrive. Clock-in opens 10 minutes before your start."
3. Set `ReminderSentAt` = `utcNow()` on each shift you emailed, so nobody gets a second reminder if the flow re-runs.
4. **Test mode:** read `EmailTestMode` from `Lotus_Settings`. While it is Yes, send everything to `project_lotus@centific.com` only, with the intended recipient at the top of the body, and leave `ReminderSentAt` unset. The scheduling team checks a few days of test emails before it is switched off.
5. **Avoiding duplicates:** before `EmailTestMode` goes to No, the scheduling team turns off their existing Outlook reminder process. Note this in the flow's description.

## 6. Flow: **Lotus Approval Reminder** (scheduled)

The proposed weekly cycle: operators record time, approvers approve last week's timesheets by Monday, then reporting pulls the approved hours.

- **Trigger:** recurrence, every Monday at 8:00 AM Pacific.
- **Sender:** the shared mailbox, as above. Honour `EmailTestMode`.

1. Last week = the Monday 7 days ago to yesterday (Sunday), site-local. Compose `reviewWeek` as `Nov 2 – 8` (`MMM d – d`, or `MMM d – MMM d` across months).
2. `openDays` = the number of distinct `Email` + `Date` pairs in `Lotus_Punches` for last week that have no `Lotus_Approvals` row with `Status` = `approved` (the latest row per `DayKey`). Compose it as `<n> operator-days`. If it is 0, stop: there is nothing to approve.
3. Get the `approver-weekly` row from `Lotus_Templates`. If it is missing, send the alias a plain email "The Lotus approval reminder template is missing. Open the Emails page in Lotus once to create it." and stop.
4. For each active `Lotus_Users` row with `approver` in `Roles`: take `Ready` and `Subject`, replace `{{approverFirstName}}` / `{approverFirstName}` (first word of `Name`), `{{reviewWeek}}` / `{reviewWeek}` and `{{openDays}}` / `{openDays}`, and send it.

## 7. Tests to run before handing over

1. Call **Lotus Read** with no token, and with a made-up token. Both get 401 `Please sign in again.`
2. Call **Lotus Read** with an operator's token (from `signin`). You get only that operator's rows, and `operators` holds only them.
3. Call **Lotus Write** `punch` `in` 20 minutes before a shift. You get 409 `early`. At 6 minutes before, it saves with `GraceMinutes` = 6.
4. Send a body `email` that is someone else's. The punch is still saved under `callerEmail` (the token's owner).
5. As an operator, call `approve_day`. You get 403.
6. As an approver, call `approve_day` with `hours` ≠ `computed` and no note. You get 400. With a note it saves, and a `Lotus_Audit` row appears.
7. Four different operators clock in within one minute. You get four rows with the right names.
8. Run the reminder flow with `EmailTestMode` = Yes. One email per operator arrives at the alias, and `ReminderSentAt` stays empty.
9. As a scheduler, call `email_send` with a `to` that isn't in `Lotus_Users`. You get 400 and no email. With a real operator and `EmailTestMode` = Yes, the email arrives at the alias with the test line, and a `Lotus_Notices` row has `Test` = Yes.
10. As an operator, call `email_send` or `template_save`. You get 403. Call Read as an operator: `notices` and `templates` are empty.
11. Run the approval reminder with `EmailTestMode` = Yes. One email per approver arrives at the alias with the three fields filled in.
12. **Auth:** `salt` for an unknown username returns the fake salt with 200. `bootstrap` creates the first admin, then refuses a second time with 403.
13. Five wrong `signin` hashes in a row lock the account: the sixth, with the right hash, still gets 401 until 15 minutes pass. A right hash after the lock clears works and resets `FailedCount`.
14. As a non-admin, call `user.list` or `user.create`: 403. As an admin, `user.create` on an operator imported by `users_upsert` (no password yet) gives that same row a sign-in; a second `user.create` for them gets 409.
15. After `user.create` or `user.reset`, signing in works but Read answers 403 `Choose your own password first.` until `change-password` succeeds. `user.reset` and `user.update` with `active` = false sign the person out (their old token gets 401).
16. `signout` clears the token: the same token on Read gets 401. A token older than 12 hours gets 401.
17. Read `Lotus_Users` as a staff member through SharePoint itself: access is denied (only the flow account can).

When done, reply with:
- the three HTTP trigger URLs (Lotus Auth, Lotus Read, Lotus Write), in a private file only, never in chat or in the repo. David pastes them into the Lotus server's environment on Render, which forwards the app's calls, so the URLs never reach the browser. Calls arrive from Render's servers, not from people's browsers, with the same text/plain body.
- the expression you used to parse the text/plain body
- anything you couldn't build as specified
