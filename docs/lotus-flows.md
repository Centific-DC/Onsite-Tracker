# Lotus on-site time tracking: SharePoint lists and Power Automate flows

Prompt for the bot that builds the backend. Copy everything below the line into the bot as one message.

---

You are building the backend for **Lotus**, an on-site time-tracking web app used by Centific on the Google Lotus project. The app is a static React page (GitHub Pages). Everyone signs in with a **username and password that a Lotus admin hands out** (the same pattern as the Project Atlas app), through the **Lotus Auth** flow below. Sign-in returns a token, and every call to the other two HTTP flows carries it in the body. Build the SharePoint lists, the flows and the reminder email exactly as specified, because the app depends on these names and JSON shapes. When something here can't be done as written, stop and report what and why. Don't substitute something else.

## Ground rules

- **Site:** SharePoint site `DataCollectionUSHUB` (https://digitaltechedge.sharepoint.com/sites/DataCollectionUSHUB). Create every list there.
- **Identity comes from the sign-in token, never from anything else in the request body.** No Microsoft accounts are involved. All three HTTP triggers (Lotus Auth, Lotus Read, Lotus Write) are set to **Who can trigger: Anyone**, because the app is a public page and the token is the check.
    - Every Read and Write body has `"token": "<64 hex characters>"`. The app sends it as `Content-Type: text/plain` (to avoid a CORS preflight), so parse the body with `json(triggerBody())` and don't set a schema that requires `application/json`.
    - **Token check** (first step of Read and Write, and of the Auth ops that need it): get the `Lotus_Users` row where `Token` = the body's `token` (top 1). If there's no row, `Active` = No, or `TokenExpires` is before `utcNow()`, respond **401** `{"error":"Please sign in again."}`. Respond 401 **only** when the lookup succeeded: if the lookup itself fails, is throttled (429) or times out, respond **503** `{"error":"Lotus is busy. Try again in a moment."}` (the token-check condition must never run on a failed or empty lookup body). A 401 makes the app sign the person out. If `MustChangePassword` = Yes, respond **403** `{"error":"Choose your own password first."}`.
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
- **Speed** (user ask, 2026-11-05: adding an operator and sending emails took far too long). The app waits up to 110 s, then gives up. Targets:
    - Under 3 s: `signin`, `salt`, a one-user `users_upsert`, `user.create`, `user.reset_link`, `reset`, one welcome or reset `email_send`, `punch`, `fill_in`.
    - Under 5 s: Read for an operator; under 10 s: Read `all` for staff; under 15 s: a 20-row `users_upsert` or a 10-message `email_send`.
    - **The app never waits on Write for everyday edits** (the Atlas pattern, 2026-11-05). Shift adds and changes, shift deletes, edits to people already on the roster, flag decisions and the client's successful hours show at once and go through a save queue in the browser, up to 3 calls at a time, retried after 5, 15, 30, 60 and 120 s on no answer, 429, 5xx or 503. So each of these must be safe to receive twice: `shift_delete` of a missing id is 200, `users_upsert` matches by email, `resolve_flag` replaces by key, `client` replaces by week. For new shifts (no `id`) the app checks a fresh Read before resending after a timeout or 502/504, so it doesn't book a shift twice. A 4xx other than 401/408/429 is final, and the app undoes the change on screen. Approvals, clock-ins, fill-ins, new users, imports and emails are not queued: those still wait for the flow's answer.
    - The app sends a roster import as `users_upsert` calls of at most 5 users, and a schedule import as `shift_upsert` calls of at most 25 shifts, one call after another, so no single call nears the flow's 2-minute limit. Each call must still be idempotent by email (users) or id (shifts).
    - How:
        - *Get items* with a `$filter` and `Top Count` (1 when looking up one row), never a whole list just to find one row.
        - Read a list once and use *Filter array* inside loops, not a *Get items* per item.
        - Give *Apply to each* concurrency (10 to 20) wherever the items don't depend on each other.
        - Independent steps go in parallel branches.
        - Respond as soon as the result is known, and put audit rows and notification emails that the answer doesn't depend on after the Response.
        - Look rows up with `$top=1` on indexed columns (`Title`, `Token`, `Email`, `Username`).
        - Use *Compose* instead of variables wherever a value is set once.
        - Hot-path actions (the token check, lookups, the write itself): retry policy *Fixed interval*, count 1, interval `PT5S`, so a throttled call doesn't sit in exponential back-off.
- **Secrets:** never put trigger URLs, tokens, salts or passwords in chat, flow names, flow descriptions or run logs. Turn on **Secure inputs/outputs** for any action that sees one.
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
| `HomeLocation` | text | `RED` | `RED` (Redmond Lab) or `MTV` (Mountain View Lab). Operators work at their home lab only: Write refuses shifts and clock-ins anywhere else |
| `Cohort` | text | `Cohort 3` | From Active Roster 2 |
| `CompletedSessions` | number | `4` | From Active Roster 2 |
| `CompletedAsOf` | text | `2026-11-05` | Date of the import that set `CompletedSessions` |
| `TrainingStatus` | text | `Trained` | From Active Roster 2 |
| `Experience` | choice | `experienced` | Set by an admin on Roster: `experienced`, `new`, or empty (then the app decides from `CompletedSessions`). Every pair needs at least one experienced operator |
| `Active` | yes/no | Yes | No = can't sign in |
| `PasswordSalt` | text | base64 | Empty = this person has no sign-in yet (e.g. just imported from the roster) |
| `PasswordHash` | text | base64 | |
| `MustChangePassword` | yes/no | Yes | Yes after an admin adds or resets them: they must pick their own password |
| `TempExpires` | text | ISO UTC | Set to now + 7 days by `user.create` and `user.reset`; cleared by `change-password`. A temp password past this time no longer signs in |
| `FailedCount` | number | `0` | Wrong passwords in a row |
| `LockedUntil` | text | ISO UTC | Set for 15 minutes after 5 wrong passwords |
| `Token` | text | 64 hex characters | Current sign-in. Empty = signed out |
| `TokenExpires` | text | ISO UTC | 12 hours after sign-in |
| `LastSignIn` | text | ISO UTC | |
| `ResetHash` | text | 64 hex characters | SHA-256 of the one-time code in a password reset link (the app hashes it; Power Automate can't). Set by `user.reset_link`; cleared when the link is used, and by `change-password` and `user.reset` |
| `ResetExpires` | text | ISO UTC | `user.reset_link` sets it to now + 24 hours. After that the link no longer works |

**Permissions:** this list holds password hashes and sign-in tokens, so only the flows' connection account may read or edit it. Break inheritance and remove everyone else. The Read flow returns users without any of the last nine columns.

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
| `Robot` | text | `Robot 1`, or empty = any robot (user rule, 2026-11-05: the robot is optional as long as operators know who they're paired with) |
| `Pair` | text | `P-3k9x2a1b`. Shifts with the same `Pair` on the same `Date` are partners, whatever their robot. Empty = pair the old way (same `Date`, `Location` and `Robot`, overlapping more than 60 minutes) |
| `Replaces` | text | `S-…` of a no-show this shift replaces. That shift drops out of its pair; it stays on the schedule as the record of the no-show |
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

### `Lotus_Corrections`: missed clock-in or out requests

The project owner's rule (2026-11-10): only admins change hours away from what the clock recorded. An operator who forgot to clock in or out sends a request from Lotus; the flow emails the admins and copies the operator, which is the formal paper trail. An admin checks with the scheduled partner, then sets the real times or declines. The punches themselves are never changed.

| Column | Type | Example |
|---|---|---|
| `Title` | text | `C-` + 8 characters of `guid()`; returned as `id` |
| `Email` | text | the operator's email |
| `Name` | text | the operator's name, from `Lotus_Users` |
| `OperatorID` | text | `OP-0007` |
| `Date` | text | the shift's `Date` |
| `ShiftID` | text | the `Lotus_Shifts` row it's about |
| `Missed` | text | `in`, `out` or `both` |
| `Message` | multi-line text | the operator's words, or a summary of their email |
| `Source` | text | `app` (sent from Lotus) or `email` (logged by an admin) |
| `RequestedAt` | text | `utcNow()` for `app`; for `email`, when the email arrived (ISO UTC, from the admin) |
| `Status` | text | `open`, `approved` or `declined` |
| `PartnerConfirmed` | yes/no | the admin ticked that the partner confirmed |
| `TimeIn`, `TimeOut` | text | ISO UTC, set by the admin on approval. These replace the clock record for this shift's hours |
| `Note` | multi-line text | the admin's note, required |
| `Counts` | yes/no | whether it counted toward a warning |
| `NoCountReason` | text | required when an approved request doesn't count (an app or flow problem, a scheduling mistake) |
| `ResolvedBy` | text | `callerEmail` |
| `ResolvedAt` | text | `utcNow()` |

Status changes update the row; the `Lotus_Audit` rows keep the history.

### `Lotus_Strikes`: soft warnings and strikes

Each counted miss is one row. The app works out the step from the rows: the 1st counted miss is a **soft warning**, then **Strike 1** (noted), **Strike 2** (a talk with the lead) and **Strike 3** (a talk with the PM and a removal review). After **30 days with no new counted miss** the count goes back to zero. Lotus records and emails each step but never blocks anyone.

| Column | Type | Example |
|---|---|---|
| `Title` | text | `K-` + 8 characters of `guid()`; returned as `id` |
| `Email`, `Name`, `OperatorID` | text | the operator |
| `Date` | text | the day of the miss |
| `Reason` | text | `missed_in`, `missed_out`, `missed_both` or `late_report` |
| `Ref` | text | the correction `Title`, or the flag key for a missed clock-out found in review |
| `At` | text | `utcNow()` |
| `By` | text | `callerEmail` |
| `Emailed` | yes/no | the strike email was sent |
| `Voided` | yes/no | an admin cancelled it |
| `VoidReason`, `VoidedBy`, `VoidedAt` | text | required when cancelling |

Never delete a row: a cancelled one stays, with `Voided` = Yes. **At most one row per `Email`, `Date` and `Reason`** that isn't voided: skip the add if one exists.

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
| `Action` | text | `punch`, `shift_upsert`, `shift_delete`, `users_upsert`, `resolve_flag`, `approve_day`, `reopen_day`, `client`, `email_send`, `template_save`, `correction_request`, `correction_resolve`, `strike_add`, `strike_void` |
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
| `Kind` | text | `operator-schedule`, `operator-schedule-update` or `operator-welcome` |
| `Subject` | text | the subject sent |
| `SentAt` | text | `utcNow()` |
| `By` | text | `callerEmail` |
| `Test` | yes/no | Yes when it went to the alias only (test mode) |
| `Snapshot` | multi-line text | JSON array of the shifts listed: `[{ "id", "date", "start", "end", "station", "location", "template" }]` |

### `Lotus_Templates`: the email templates

One row per template, edited on the app's Emails page. Missing rows mean the app's built-in default.

| Column | Type | Example |
|---|---|---|
| `Title` | text | `operator-schedule`, `operator-schedule-update`, `operator-welcome`, `operator-reset`, `approver-weekly` |
| `Subject` | text | `Lotus timesheets for {reviewWeek} are ready to approve` |
| `Html` | multi-line text (plain, not rich) | the editable body, with field chips |
| `Ready` | multi-line text (plain, not rich) | the whole email (header, body, footer) with `{{field}}` tokens; the Monday flow uses this |
| `Original` | yes/no | Yes after "Reset to original" |
| `UpdatedAt` | text | `utcNow()` |
| `UpdatedBy` | text | `callerEmail` |

### `Lotus_Settings`

One row, `Title` = `main`, with `EmailTestMode` (yes/no, **default Yes**), `SendFrom` (text: the mailbox every Lotus email is sent from, below) and `RobotNames` (multiple lines of text: a JSON object of robot names, like `{"Robot 3":"franka-thor-02"}`, set by admins in Settings → Robots; empty = `{}`). While it is Yes, every email from every Lotus flow goes to `project_lotus@centific.com` only, with the intended recipient at the top of the body. The scheduling team switches it off once they have checked a few days of test emails and turned off their manual Outlook emails.

## 2. Flow: **Lotus Auth**

Trigger *When an HTTP request is received*, POST, **Anyone**. Body (parse with `json(triggerBody())`): `{ "schemaVersion": 1, "op": "...", ...fields }`. **Switch on `op`.** Replies are JSON; errors are `{"ok": false, "message": "<sentence a person can read>"}` with the status shown. This flow writes a `Lotus_Audit` row (`Action` = `auth_<op>`) for every op except `salt`, without hashes, salts or tokens.

Usernames: compare lower-cased and trimmed. `username` may also be an email, so "find the user" means the `Lotus_Users` row where `toLower(Username)` = it, **or** `Title` = it.

Make the token with `concat(replace(guid(),'-',''), replace(guid(),'-',''))` (64 hex characters).

| `op` | Body | Who | What it does |
|---|---|---|---|
| `salt` | `{ "username" }` | anyone | Find the user. If found, `Active` = Yes and `PasswordSalt` isn't empty, respond 200 `{ "salt": PasswordSalt }`. Otherwise respond 200 `{ "salt": "THf0dXNVbmtub3duU2FsdA==" }` (a fixed fake one), so the reply never shows who has an account |
| `signin` | `{ "username", "hash" }` | anyone | Find the user. If missing, `Active` = No, no `PasswordHash`, or `LockedUntil` is after now: 401 `Username or password is wrong, or the account is locked.` If `hash` ≠ `PasswordHash`: add 1 to `FailedCount`; at 5, set `LockedUntil` = now + 15 minutes and `FailedCount` = 0; respond the same 401. If `MustChangePassword` = Yes and `TempExpires` is before now, respond 401 `This temp password has expired. Ask your admin for a new one.` (only after the hash matched, so it never tells a stranger anything). Otherwise, if the row's `Token` is set and `TokenExpires` is still after now, **keep that `Token`** (so signing in on a second device or browser doesn't sign out the first); if not, make a new one. Set `TokenExpires` = now + 12 hours, `FailedCount` = 0, `LockedUntil` empty, `LastSignIn` = now, and respond 200 `{ "ok": true, "token", "expiresAt", "user": USER }` |
| `change-password` | `{ "token", "currentHash", "newSalt", "newHash" }` | signed in (allowed while `MustChangePassword` = Yes) | Token check. If `currentHash` ≠ `PasswordHash`: 401 `Your current password is wrong.` Else set `PasswordSalt` = `newSalt`, `PasswordHash` = `newHash`, `MustChangePassword` = No, `TempExpires`, `ResetHash` and `ResetExpires` empty. 200 `{ "ok": true, "user": USER }` |
| `signout` | `{ "token" }` | anyone | Clear `Token` and `TokenExpires` on the row with that token, if any (this signs that person out on every device). Always 200 `{ "ok": true }`. The lab laptop's automatic sign-out after each clock-in doesn't call it |
| `user.list` | `{ "token" }` | `admin` | 200 `{ "ok": true, "users": [ USER + { "active", "lastSignIn", "lockedUntil" } ] }`, every row that has a `Username` |
| `user.create` | `{ "token", "user": { "username", "email", "name", "roles": [], "operatorId"? }, "salt", "hash" }` | `admin` | `username` not empty, no spaces; `email` valid; at least one known role, else 400. If another row already has that `Username`: 409 `That username is taken.` If a row with that email exists **and has a `PasswordHash`**: 409 `That person already has a sign-in.` If the row exists without one (e.g. imported from the roster), update it; otherwise create it (a new operator gets the next `OP-` number, as in `users_upsert`). Set `Username`, `Name`, `Roles` (joined with `;`), `PasswordSalt` = `salt`, `PasswordHash` = `hash`, `MustChangePassword` = Yes, `TempExpires` = now + 7 days, `Active` = Yes, `FailedCount` = 0. 200 `{ "ok": true }` |
| `user.update` | `{ "token", "username", "changes": { "name"?, "username"?, "roles"?, "active"? } }` | `admin` | Find the user, else 404. An admin can't change their own `roles` or `active` (400 `You can’t change your own roles or turn off your own sign-in.`). A new `username` must be free (409). `roles` needs at least one known role. `active` = false also clears `Token`. 200 `{ "ok": true }` |
| `user.reset` | `{ "token", "username", "salt", "hash" }` | `admin` | Find the user, else 404. Set the new salt and hash, `MustChangePassword` = Yes, `TempExpires` = now + 7 days, `FailedCount` = 0, clear `LockedUntil`, `Token`, `ResetHash` and `ResetExpires`. 200 `{ "ok": true }` |
| `user.reset_link` | `{ "token", "username", "codeHash" }` | `admin` | Starts a password reset by email. Find the user; if missing or `Active` = No: 404 `No active sign-in with that username.` `codeHash` must be 64 lower-case hex characters, else 400. Set `ResetHash` = `codeHash`, `ResetExpires` = now + 24 hours. **Don't** touch the password, `MustChangePassword` or `Token`: their current password keeps working until they use the link. 200 `{ "ok": true, "expiresAt": ResetExpires }`. The app then sends the email itself with `email_send` (kind `password-reset`, below) |
| `reset` | `{ "username", "codeHash", "newSalt", "newHash" }` | anyone with the link | Find the user. If missing, `Active` = No, `ResetHash` empty, `ResetExpires` before now, or `LockedUntil` after now: 400 `This reset link has expired or was already used. Ask your Lotus admin for a new one.` If `codeHash` ≠ `ResetHash`: count it like a wrong password (`FailedCount` + 1; at 5, `LockedUntil` = now + 15 minutes, `FailedCount` = 0) and respond the same 400. Else set `PasswordSalt` = `newSalt`, `PasswordHash` = `newHash`, `MustChangePassword` = No, and clear `TempExpires`, `ResetHash`, `ResetExpires`, `FailedCount` (0), `LockedUntil`, `Token` and `TokenExpires` (signs them out everywhere). 200 `{ "ok": true }`. The app then signs them in with `salt` + `signin` as usual. Turn on **Secure inputs** for the trigger if not already on |
| `bootstrap` | `{ "user": { "username", "email", "name" }, "salt", "hash" }` | anyone, **only while no active row has `admin` in `Roles`** | Otherwise 403 `Lotus already has an admin.` Create the row with `Roles` = `admin;scheduler;approver;reporting`, `MustChangePassword` = No, `Active` = Yes. 200 `{ "ok": true }` |
| anything else | | | 400 `Unknown request.` |

USER is `{ "username", "email", "name", "roles": ["scheduler","approver"], "operatorId", "mustChangePassword": false }`. Never return `PasswordSalt` (except from `salt`), `PasswordHash`, `ResetHash` or another person's `Token`.

The app opens the first-run screen at `<app URL>?setup=1`. Once an admin exists, `bootstrap` always refuses.

## 3. Flow: **Lotus Read**

Trigger *When an HTTP request is received*, POST, **Anyone**. Body: `{ "action": "all", "from": "yyyy-MM-dd", "token": "…" }`. `from` defaults to 60 days ago.

1. The token check above gives `callerEmail` and the caller's row. Compose `roles` = `split(Roles, ';')`.
2. Get items from `Lotus_Shifts` with `Date ge '<from>'`, `Lotus_Punches` with `Date ge '<from>'`, `Lotus_FlagResolutions`, `Lotus_Approvals` with `Date ge '<from>'`, `Lotus_Corrections` with `Date ge '<from>'`, all of `Lotus_Strikes` (the history is short and the 30-day count needs older rows), and `Lotus_ClientHours`. Get `Lotus_Users`, `Lotus_Notices` with `WeekStart ge '<from>'` and `Lotus_Templates` too, but only for staff. Read `EmailTestMode` and `RobotNames` from `Lotus_Settings`, and return `robotNames` = `json(coalesce(RobotNames, '{}'))` to everyone, operators included (names aren't private).
3. **If the caller has only the `operator` role**, keep only rows whose `Email` = `callerEmail` in shifts, punches, approvals, corrections, strikes and resolutions (resolution keys start with the email). Return `operators` as just their own user row, and `client`, `notices` and `templates` as `[]`. Operators must never receive anyone else's rows.
   - **The one exception is partners' names** (user decision, 2026-11-05). Before filtering, for each of the caller's shifts, find its partners among the other `Lotus_Shifts` rows of the same `Date` with a different `Email`, leaving out any row that another row's `Replaces` points to:
     - if either shift has a `Pair`, partners are the rows with the **same non-empty `Pair`** (robot and times don't matter);
     - if neither has one, partners are rows with the same `Location` and the same non-empty `Robot` whose time overlaps the caller's by **more than 60 minutes** (so the half-hour handover between shifts doesn't count; an end at or before the start runs past midnight).

     Return them as `partners`: `[{ "shiftId": "<the caller's shift id>", "name": "<the partner's Name>" }]`. Send only these two fields: never the partner's email, operator ID, times, punches or hours. Staff callers get `partners: []` (they already have the whole schedule).
   - **Open spots, for operators only** (user rule, 2026-11-05: if A doesn't show, C can pair with B). List today's shifts (site-local) at the caller's `HomeLocation` where: the booked operator has no `IN` punch today; now is past the shift's start plus the lab's grace (10 minutes) and more than 30 minutes before its end; no other row `Replaces` it; and it isn't the caller's. Skip the list entirely if the caller already clocked in today. Return `openSpots`: `[{ "shiftId", "location", "station", "start", "end", "template", "date" }]`. **No names, emails or operator IDs**: the caller only learns their partner's name after taking the spot. Staff get `openSpots: []`.
4. Response 200 (field names are lower camel case, exactly):

```json
{
  "me": { "email": "", "name": "", "operatorId": "", "roles": ["operator"], "location": "RED" },
  "operators": [{ "id": "OP-0007", "email": "", "name": "", "location": "RED", "roles": ["operator"], "cohort": "", "completedSessions": 4, "completedAsOf": "", "training": "", "active": true }],
  "schedule": [{ "id": "S-…", "date": "", "operatorId": "", "email": "", "name": "", "location": "RED", "station": "Robot 1", "template": "RED-AM", "start": "07:00", "end": "12:30", "note": "", "pair": "P-…", "replaces": "" }],
  "partners": [{ "shiftId": "S-…", "name": "Avery Lin" }],
  "openSpots": [{ "shiftId": "S-…", "location": "RED", "station": "", "start": "17:00", "end": "23:00", "template": "RED-NIGHT", "date": "2026-11-05" }],
  "punches": [{ "id": "", "ts": "", "operatorId": "", "email": "", "name": "", "type": "in", "location": "RED", "station": "Robot 1", "shiftId": "", "grace": 0, "source": "laptop", "flag": "", "note": "" }],
  "resolutions": [{ "key": "", "outcome": "accept", "reason": "", "endTime": "", "by": "", "at": "" }],
  "approvals": [{ "email": "", "operatorId": "", "date": "", "status": "approved", "hours": 5.5, "computed": 5.5, "note": "", "final": false, "by": "", "at": "" }],
  "corrections": [{ "id": "C-…", "email": "", "name": "", "operatorId": "", "date": "", "shiftId": "", "missed": "both", "message": "", "source": "app", "requestedAt": "", "status": "open", "partnerConfirmed": false, "timeIn": "", "timeOut": "", "note": "", "counts": true, "noCountReason": "", "resolvedBy": "", "resolvedAt": "" }],
  "strikes": [{ "id": "K-…", "email": "", "name": "", "operatorId": "", "date": "", "reason": "missed_in", "ref": "", "at": "", "by": "", "voided": false, "voidReason": "", "voidedBy": "", "voidedAt": "" }],
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
   - A shift with an empty `Robot`: the app asks the operator which robot at clock-in and sends it as `station`. Save it on the punch (`Robot`), so hours worked still merge per robot. `station` must be one of the lab's robots.
   - **Home lab only** (user rule, 2026-11-05: the labs are far apart, so nobody works at both). If the caller's `Lotus_Users` row has a `HomeLocation`, the punch's `location` must equal it, else **403** `{"error":"You can only clock in at <lab name>.","code":"lab"}`. This applies with or without a `shiftId`.
7. If the caller already has an `IN` today with no `OUT` after it, return **409** `{"error":"You're already clocked in", "code":"open"}`.

**Clock-out (`type` = `out`):** must follow an open `IN` from the caller, else 409 `{"error":"You're not clocked in","code":"not_in"}`. Copy that IN's `ShiftID`, `Location` and `Robot`. A clock-out after the scheduled end is accepted. The app flags the extra time for review, so the flow doesn't. If `flag` = `early`, set `Flag` = `Left early` and `note` must not be empty.

Then add the `Lotus_Punches` row. Respond `{ "ok": true, "punch": { …same shape as in Read… } }`.

If `Flag` = `Left early`, send an email from the shared mailbox (the email step below) to the approvers. These are the `Lotus_Users` rows with `approver` in `Roles`. Subject `Early clock-out: <Name>`. Body: name, location, robot, site-local time, scheduled end, and the reason.

### `shift_upsert`: role `scheduler`

Body: `{ "shifts": [ { "id"?: "", "date", "operatorId", "email", "name", "location", "station", "template", "start", "end", "note", "source", "pair", "replaces" } ] }`. Up to 200 per call. `station` may be empty (any robot). Save `pair` and `replaces` as sent. When the scheduler pairs someone with a shift that has no `Pair` yet, or replaces a no-show, the app sends the partners' rows again in the same call with the new `Pair`, so save them all.

For each shift: check that `date` is `yyyy-MM-dd`, `start` and `end` are `HH:mm`, and `email` is in `Lotus_Users`. **Home lab only:** if that user's row has a `HomeLocation`, the shift's `location` must equal it, else 400 `{"error":"<name> works at <lab name> only."}` and nothing in the call is saved. With an `id`, update that row. Without one, create it with `Title` = `S-` + `guid()`. Respond `{ "ok": true, "shifts": [ …saved shifts, same shape as Read… ] }`. The app has already shown the scheduler any warnings (37 hrs, conflicts, pairing), so don't block on those.

### `shift_delete`: role `scheduler`

Body `{ "id": "S-…" }`. Delete it, and return `{ "ok": true }` even if it was already gone.

### `fill_in`: role `operator`

An operator takes an open spot (someone didn't show). Body `{ "shiftId": "S-…" }`: the no-show's shift, from `openSpots`.

1. Get that shift. Check again everything that makes it an open spot (see Read): same lab as the caller's `HomeLocation`, no `IN` from its operator today, past start plus grace and more than 30 minutes before the end, not already replaced, not the caller's. The caller must not be clocked in, and must have no other shift overlapping the rest of this one. Else **409** `{"error":"That spot is already filled, or the shift is nearly over.","code":"taken"}`.
2. If the shift has no `Pair`, make one (`P-` + 8 characters of `guid()`), and set it on that shift **and on its current partners** (found as in Read's partners rule), so the pair survives the swap.
3. Create the caller's shift: same `Date`, `Location`, `Robot`, `Template` and `End`; `Start` = now, site-local, rounded down to 5 minutes; `Pair` = that pair; `Replaces` = the no-show's `Title`; `Note` = `Filled in for a no-show`; `Source` = `fill_in`.
4. Audit row, then respond `{ "ok": true, "shift": { …same shape as Read… } }`. The app then sends a normal `punch` `in` with the new `shiftId` (asking the operator for a robot if `station` is empty).
5. Optional but useful: email the approvers `Covered no-show: <caller> for <no-show> · <lab> <shift>` (test mode rules apply).

### `users_upsert`: role `scheduler`

Body `{ "users": [ { "id"?: "OP-…", "email", "name", "location", "cohort", "completedSessions", "completedAsOf", "training", "experience"?: "experienced" | "new" | "", "roles"?: ["operator"], "active"?: true } ] }`. Up to 500 per call, used by the Active Roster 2 import and when an admin marks an operator Experienced or New.

- Match users by email.
- **Names:** keep the name as sent (or, if no name is sent, the name on record). Add ` 2`, ` 3`… only when another **active** row with a **different** email already has that exact name (compared lower-cased and trimmed). Check before numbering, never after: Power Automate's *Do until* always runs its body once, so wrap it in a condition or it numbers every name. A user whose own name is unchanged is never renumbered.
- Change only the fields present in the body. The roster import never sends `experience`, so an admin's mark survives re-imports.
- A new operator without an `id` gets the next free `OP-0000` number. Find the highest existing number and add one, so numbers are never reused.
- Ignore `roles`, `username` and every password and token column: roles and sign-ins are changed only through the Auth flow's `user.*` ops, by an admin. A new row gets `Roles` = `operator` and no password (so it can't sign in until an admin gives it one).

Respond `{ "ok": true, "users": [ … ] }`.

### `resolve_flag`: role `approver` or `admin`

Body `{ "key", "outcome": "accept" | "decline" | "noted", "reason", "endTime"? }`. `reason` must not be empty (400). **A non-empty `endTime` needs `admin`** (403 `Only admins can change hours.`): approvers can accept the suggested end (the scheduled end) or decline. Upsert the `Lotus_FlagResolutions` row by `Title` = `key`.

If the key's third part is `no_clockout` and this is the first resolution for that key, add a `Lotus_Strikes` row (`Reason` = `missed_out`, `Ref` = `key`, `Email` and `Date` from the key, the one-per-day rule above) and a `strike_add` audit row, then send the strike email (below) only if the row takes the operator to Strike 3; set `Emailed` to match. Respond `{ "ok": true, "resolution": { … } }`.

### `approve_day` and `reopen_day`: role `approver` or `admin`

Body `{ "email", "operatorId", "date", "hours", "computed", "note" }`.
- `approve_day`: `note` is required when `hours` ≠ `computed`. **`hours` ≠ `computed` (more than 0.005 apart) needs `admin`**: anyone else gets 403 `Only admins can change hours.`
- `reopen_day`: `note` is required.
- If the latest row for that `DayKey` has `Final` = Yes, refuse with 409 `{"error":"That month is final","code":"final"}`.

Add a `Lotus_Approvals` row with `Status` `approved` or `reopened`. Respond `{ "ok": true, "approval": { … } }`.

### `correction_request`: role `operator`, or `admin` for an emailed request

Body `{ "shiftId", "missed": "in" | "out" | "both", "message", "source"?: "email", "email"?, "requestedAt"? }`.
- `message` must not be empty (400 `Say what happened.`), `missed` must be one of the three.
- Find the `Lotus_Shifts` row (404 if missing). **An operator** can only ask about their own shift (`Email` = `callerEmail`, else 403 `That shift isn’t yours.`), and only once it has started. `source`, `email` and `requestedAt` are ignored for them: `Source` = `app`, `RequestedAt` = `utcNow()`.
- **An admin** logging an email sends `source` = `email`, the operator's `email` (must match the shift) and `requestedAt` (when the email arrived; not after now).
- If a row for that `ShiftID` exists with `Status` ≠ `declined`: 409 `There’s already a request for that shift.`
- Add the `Lotus_Corrections` row (`Status` = `open`, names and IDs from the shift), then, for `app` requests, **send the request email** (respond first, send after): to every active `Lotus_Users` row with `admin` in `Roles`, CC the operator, subject `Missed clock-<in|out|in and out>: <Name>, <Date>`, body: name, operator ID, lab, robot, scheduled times, what they missed, their message, when it was sent, the partner names on that shift (as for Read's `partners`) and a link to `#/admin/review`. `EmailTestMode` sends it to the alias as usual. Add a `Lotus_Notices` row (`Kind` = `correction-request`).
- Respond `{ "ok": true, "correction": { … } }`.

### `correction_resolve`: role `admin`

Body `{ "id", "status": "approved" | "declined", "timeIn"?, "timeOut"?, "partnerConfirmed", "note", "counts", "noCountReason"?, "notify" }`.
- The row must exist (404) and be `open` (409 `That request was already handled.`). `note` must not be empty (400).
- `approved`: `timeIn` and `timeOut` are required ISO times with `timeOut` after `timeIn` (400). `counts` = false needs `noCountReason` (400).
- Update the row (`Status`, times, `PartnerConfirmed`, `Note`, `Counts` = `status = approved and counts`, `NoCountReason`, `ResolvedBy`, `ResolvedAt`).
- If it was approved and counts, add `Lotus_Strikes` rows: one with `Reason` = `missed_in`, `missed_out` or `missed_both` (from `Missed`), and **a second with `late_report` when `RequestedAt` is more than 24 hours after the shift's end** (site-local `Date` + `End`). `Ref` = the correction's `Title`. One audit row each (`strike_add`).
- Email the operator the outcome (respond first, send after): approved with the new times, or declined with the note. **The strike email** (user rule, 2026-11-10): send it for each new row when `notify` is true, and **always when the row takes the operator to Strike 3** (a count of 4 or more, as below), whatever `notify` says. Set `Emailed` on each row to whether it went.
- Respond `{ "ok": true, "correction": { … }, "strikes": [ … ] }`.

**The strike email** (to the operator, from the shared mailbox, `EmailTestMode` as usual; a `Lotus_Notices` row with `Kind` = `strike`): subject `Lotus: <step> for a missed clock-<in|out>`. Body: the day and shift, the reason, the step reached (work it out as the app does: count that operator's non-voided rows in order, starting again from 1 after a gap of more than 30 days; 1 = Soft warning, 2 = Strike 1, 3 = Strike 2, 4 or more = Strike 3), what that step means (logged / noted / a talk with your lead / a talk with your PM and a review of your place on the project), and the date it clears if there are no more misses. Never mention anyone else's count.

### `strike_void`: role `admin`

Body `{ "id", "reason" }`. `reason` must not be empty (400). Set `Voided` = Yes, `VoidReason`, `VoidedBy` = `callerEmail`, `VoidedAt` = `utcNow()`. Never delete the row. Respond `{ "ok": true, "strike": { … } }`.

### `email_send`: role `scheduler` (and `admin` for welcome and password reset emails)

The app fills in each email from the templates and sends them ready to go. Body:

```json
{ "kind": "schedule", "weekStart": "2026-11-09",
  "messages": [ { "to": "avery.lin@centific.com", "operatorId": "OP-0001", "name": "Avery Lin", "kind": "operator-schedule", "subject": "", "html": "", "snapshot": [] } ] }
```

Up to 25 messages per call. For each message:

1. `to` must be an active row in `Lotus_Users` with the `operator` role, else 400 `{"error":"<to> isn't a Lotus operator"}` and nothing is sent. This keeps the flow from emailing anyone outside the project.
2. `html` must be under 200 KB.
3. Send it, *Is HTML* = Yes, *Reply To* = `project_lotus@centific.com`. While `EmailTestMode` is Yes, send to `project_lotus@centific.com` instead, with a first line `Test mode · intended for <to>` above the HTML.
4. Add a `Lotus_Notices` row (`Test` = `EmailTestMode`, `Snapshot` = `string(snapshot)`).

**Sending mailbox** (decided 2026-11-05): `project_lotus@centific.com` is a mail group, not a mailbox, so nothing can be sent *from* it. For now every Lotus email goes out with **Send an email (V2)** from the flow connection owner's own mailbox (David's). `Lotus_Settings.SendFrom` holds which mailbox is used; when a shared mailbox with *Send As* rights exists, switch the action to **Send an email from a shared mailbox (V2)** with that address and update `SendFrom`. The app doesn't change.

**When to respond:**
- **Schedule emails** (`"kind": "schedule"`): validate every message (steps 1 and 2) first, then respond **202** `{ "ok": true }` with no `notices`, then send (*Apply to each* concurrency 20), then add the `Lotus_Notices` rows and one `Lotus_Audit` row per message (`After` without `Html`). The app shows the emails as sent at once and reloads a minute later to pick up the real notice rows.
- **Welcome and password reset emails** (below): validate, send, then respond 200 `{ "ok": true, "notices": [] }` right after the send, so the admin knows it went. Add the `Lotus_Notices` and `Lotus_Audit` rows after the Response.
- All email goes through the same Write URL (`action` = `email_send`), on a short path that branches off right after the token check. A separate Lotus Email flow (with its own trigger URL) is a later option, only once David approves it.

**Welcome emails** (`"kind": "welcome"`, each message `"kind": "operator-welcome"`): the onboarding email an admin sends right after `user.create`, with the operator's username, **temp password** and an Open Lotus button. The app fills it in from the `operator-welcome` template.
- Allowed for callers with `admin` (or `scheduler`). Exactly 1 message per call. `to` must be an active `Lotus_Users` operator whose `MustChangePassword` = Yes (a person who has already chosen their own password never gets a temp one by email), else 400.
- The body holds a password, so: turn on **Secure inputs** for the HTTP trigger and **Secure inputs/outputs** for the send action (Settings › Security), so run history never shows it. Never write `html` anywhere: the `Lotus_Notices` row gets `Kind` = `operator-welcome`, `WeekStart` = today, `Subject`, `Test`, and an empty `Snapshot`; the `Lotus_Audit` row has no `Html` (as for every email).
- `EmailTestMode` works as for every email: while Yes, it goes to the alias with the test line.

**Password reset emails** (`"kind": "password-reset"`, each message `"kind": "operator-reset"`): sent right after `user.reset_link`, with a **Choose a new password** button whose link holds the one-time code (`<app URL>#/reset?u=<username>&c=<code>`). The app fills it in from the `operator-reset` template.
- Allowed for callers with `admin` only. Exactly 1 message per call. `to` must be an active `Lotus_Users` row (any role: staff can be reset too) whose `ResetHash` is set and `ResetExpires` is after now, else 400 and nothing is sent.
- The body holds a working link, so treat it exactly like a welcome email: **Secure inputs/outputs**, never write `html` anywhere; the `Lotus_Notices` row gets `Kind` = `operator-reset`, `WeekStart` = today, `Subject`, `Test`, and an empty `Snapshot`.
- `EmailTestMode` works as for every email.

### `template_save`: role `scheduler`

Body `{ "id", "subject", "html", "ready", "original"? }`. `id` must be one of the five template ids. Upsert `Lotus_Templates` by `Title` = `id`, set `UpdatedAt` and `UpdatedBy`. Respond `{ "template": { "id", "subject", "html", "original", "updatedAt", "updatedBy" } }`.

### `robot_names`: role `admin`

Body `{ "names": { "Robot 1": "Stationary", "Robot 3": "franka-thor-02", "Robot 4": "" } }`: the whole map, from Settings → Robots. A robot keeps its id (`Robot 3`) in every list; the name is only shown next to it.
- Each key must be one of the robots the flow accepts (Robot 1 to Robot 10), and each value a string of at most 60 characters (empty clears it), else 400.
- Set `Lotus_Settings.RobotNames` = `string(names)` on the `main` row. Add a `Lotus_Audit` row (action `robot_names`, before and after).
- Respond `{ "ok": true, "robotNames": { …as saved… } }`.

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
16h. Sign in as the same user twice (two browsers): both tokens are the same, and Read works from both for the next 10 minutes. With a token check whose lookup fails (e.g. a test run with a bad list name), Read and Write answer 503, never 401.
16a. After `user.create`, set that row's `TempExpires` to yesterday by hand: `signin` with the right temp password gets 401 `This temp password has expired…`. `user.reset` makes it work again.
16b. As a scheduler, `shift_upsert` an operator whose `HomeLocation` = `MTV` with `location` = `RED`: 400 and nothing saved. As that operator, `punch` in with `location` = `RED`: 403 `code` = `lab`.
16c. As an admin, `email_send` a welcome to an operator who must change their password: it arrives (at the alias in test mode), the notice row has no HTML, and the run history shows the inputs as secured. For an operator who already changed their password: 400.
16e. Missed clock-ins: as an operator, `correction_request` someone else's shift: 403. Your own: it saves `open`, and the admins get the email with you in CC. A second request for the same shift: 409.
16f. As an approver (not admin), `approve_day` with `hours` ≠ `computed`, `resolve_flag` with an `endTime`, `correction_resolve` or `strike_void`: 403 each. As an admin they work and add audit rows.
16g. `correction_resolve` approved with `counts` = true on a request sent 2 days after the shift: two `Lotus_Strikes` rows (the miss and `late_report`), and the operator gets the emails. Read as that operator: they see their own `strikes` and `corrections` only.
16d. Pairs: book A and B on the same night with the same `Pair` and empty `Robot`. Read as A: `partners` names B. Book C with `Replaces` = A's shift and the same `Pair`: Read as B names only C.
16e. Open spots: A doesn't clock in. 15 minutes after the start, Read as C (same home lab, no shift now) lists A's shift in `openSpots` with no name. `fill_in` as C creates C's shift (`Replaces` = A, same `Pair`); a second `fill_in` by D gets 409 `taken`. Read as an operator at the other lab: no spot.
16f. Password reset: as an admin, `user.reset_link` for an operator, then `email_send` kind `password-reset`: it arrives (at the alias in test mode) and the notice row has no HTML. Their old password still signs in. `reset` with the right `codeHash` sets the new password, signs them out (old token gets 401) and the old password no longer works. The same link again: 400. A wrong `codeHash` five times locks the account for 15 minutes.
16g. Set `ResetExpires` to yesterday by hand: `reset` gets 400. `email_send` kind `password-reset` for someone with no `ResetHash`: 400, no email. `user.reset_link` as a scheduler without `admin`: 403.
16k. Robot names: `robot_names` as an admin with `{"Robot 4":"jetson-thor-004"}`, then Read as an operator: `robotNames` has it. As a scheduler without `admin`: 403. A key `Robot 99` or a 61-character name: 400.
17. Read `Lotus_Users` as a staff member through SharePoint itself: access is denied (only the flow account can).

When done, reply with:
- the three HTTP trigger URLs (Lotus Auth, Lotus Read, Lotus Write), in a private file only, never in chat or in the repo. David adds them as GitHub Actions secrets (`LOTUS_AUTH_URL`, `LOTUS_READ_URL`, `LOTUS_WRITE_URL`); the Pages deploy writes them into the built site, so the app calls the flows straight from people's browsers at https://dk-centific.github.io with the text/plain body. Every Response action must therefore send the header `Access-Control-Allow-Origin: https://dk-centific.github.io`, or the browser can't read the answer.
- the expression you used to parse the text/plain body
- anything you couldn't build as specified
