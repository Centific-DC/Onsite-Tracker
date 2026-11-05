> **Superseded** by [lotus-flows.md](lotus-flows.md) (SharePoint lists, Microsoft sign-in, roles and approvals). Kept for reference; don't build these.

# On-site Check-in · Power Automate flows

Brief for building the two flows the On-site Check-in page needs. The page is static (GitHub Pages) and talks only to these two HTTP-triggered flows. They read and write one Excel workbook on SharePoint.

**Workbook:** DataCollectionUSHUB site, file id `{46dc5a82-6ec1-4580-a29d-6823656fe9d4}`
`https://digitaltechedge.sharepoint.com/sites/DataCollectionUSHUB/_layouts/15/doc.aspx?sourcedoc={46dc5a82-6ec1-4580-a29d-6823656fe9d4}&action=edit`

When both flows are built, paste their trigger URLs into `public/config.js` → `readUrl` and `writeUrl`. The page leaves demo mode once both are set.

---

## 1. Excel tables

Create two **Excel tables** (Insert → Table, with headers). Power Automate's Excel connector can only see data inside a named table. Format every column as **Text** so Excel doesn't convert timestamps or IDs.

### Table `Punches` (sheet "Punches")

One row per tap. Rows are only ever added, never edited.

| Column | Example | Filled by |
|---|---|---|
| `ID` | `3f2c…` (GUID) | flow: `guid()` |
| `Timestamp` | `2026-10-28T15:02:11.512Z` | flow: `utcNow()`. **Use server time, not the device's** |
| `Date` | `2026-10-28` | flow: site-local date |
| `Time` | `08:02` | flow: site-local 24h time |
| `Name` | `Avery Lin` | request `name` |
| `Email` | `avery.lin@centific.com` | request `email`, lower-cased |
| `InOut` | `IN` or `OUT` | request `type` (`in`/`out`), upper-cased |
| `Station` | `Robot 2` | request `station` |
| `Note` | `Felt unwell, told Kate` | request `note` (only sent on early check-out) |
| `DeviceTime` | `2026-10-28T15:02:10.900Z` | request `deviceTs` (for audits only) |
| `Flag` | `Left early` or empty | `Left early` when request `flag` = `early` |

`Date` and `Time` make the sheet easy to compare by eye with the client's badge in/out export. Convert them from `utcNow()` to the **client site's time zone**, e.g. `convertFromUtc(utcNow(), 'Pacific Standard Time', 'yyyy-MM-dd')` and `'HH:mm'`. Change the zone if the site is somewhere else.

### Table `ClientHours` (sheet "ClientHours")

One row per week: the client's "successful hours" figure, entered by a lead on the Hours view.

| Column | Example |
|---|---|
| `Week` | `2026-10-26` (the Monday, `yyyy-MM-dd`) |
| `SuccessfulHours` | `61.5` |
| `Updated` | ISO timestamp, `utcNow()` |

### Table `Schedule` (sheet "Schedule")

One row per person per shift: who is expected, on which robot, and when. Leads add rows on the **Schedule** tab in admin (backfills too), or type them straight into the sheet. The app compares this plan with the check-ins to show who's missing and which robots need a backfill.

| Column | Example | Notes |
|---|---|---|
| `ID` | `9b1e…` (GUID) | From the flow (`guid()`). If you add rows by hand in Excel, put anything unique here, for example `manual-1` |
| `Date` | `2026-10-29` | `yyyy-MM-dd`, site-local |
| `Name` | `Casey Novak` | |
| `Email` | `casey.novak@centific.com` | Lower-case; must match the email they check in with |
| `Station` | `Robot 3` | Must match a name in `stations` in `public/config.js` |
| `Start` | `08:00` | 24h `HH:mm`, site-local |
| `End` | `14:00` | 24h `HH:mm`, site-local |
| `Note` | `Backfill for Jordan` | Optional |
| `Updated` | ISO timestamp | `utcNow()` |

Keep every column as **Text**, as with the other tables, so Excel doesn't turn `08:00` into a time fraction or `2026-10-29` into a date serial.

---

## 2. Flow: **Onsite Write**

**Trigger:** *When an HTTP request is received*, Method POST, **Who can trigger: Anyone** (same as the Twilight flows). Request body JSON schema:

```json
{
  "type": "object",
  "properties": {
    "action":   { "type": "string" },
    "type":     { "type": "string" },
    "name":     { "type": "string" },
    "email":    { "type": "string" },
    "station":  { "type": "string" },
    "note":     { "type": "string" },
    "flag":     { "type": "string" },
    "deviceTs": { "type": "string" },
    "week":     { "type": "string" },
    "hours":    { "type": "number" },
    "id":       { "type": "string" },
    "date":     { "type": "string" },
    "start":    { "type": "string" },
    "end":      { "type": "string" }
  }
}
```

**Switch on `action`:**

### Case `punch`

1. **Compose `id`:** `guid()`. **Compose `now`:** `utcNow()`.
2. **Condition (validation):** `name` is not empty AND `email` contains `@`. If it fails, **Response** 400 with body `{"error":"Name and a valid email are required"}` and stop.
3. **Excel Online (Business) → Add a row into a table**, table `Punches`, mapped as in the table above:
   - `ID` = id, `Timestamp` = now
   - `Date` = `convertFromUtc(outputs('now'),'Pacific Standard Time','yyyy-MM-dd')`
   - `Time` = `convertFromUtc(outputs('now'),'Pacific Standard Time','HH:mm')`
   - `Name` = `trim(name)`, `Email` = `toLower(trim(email))`
   - `InOut` = `toUpper(type)`
   - `Station`, `Note`, `DeviceTime` = `deviceTs`
   - `Flag` = `if(equals(triggerBody()?['flag'],'early'),'Left early','')`
4. **Condition:** `flag` equals `early` → **Office 365 Outlook → Send an email (V2)** to the leads (David, Kate, plus anyone they add). Subject `Early check-out: <name>`, body: name, email, station, site-local time, and the `note` (the reason they gave). This step covers the original incident: the team hears about it right away instead of from the client.
5. **Response** 200, `Content-Type: application/json`, body:

```json
{
  "ok": true,
  "punch": {
    "id": "<id>",
    "ts": "<now>",
    "name": "<name>",
    "email": "<email lower-cased>",
    "type": "<in|out>",
    "station": "<station>",
    "note": "<note>",
    "flag": "<early or empty>"
  }
}
```

The page uses `punch.ts` as the official check-in time on the receipt it shows the person, so return the server time, not `deviceTs`.

### Case `client`

1. **List rows present in a table**, `ClientHours`, Filter Query `Week eq '<week>'`.
2. If a row exists → **Update a row** (key column `Week`) with `SuccessfulHours` = `hours`, `Updated` = `utcNow()`. Otherwise → **Add a row into a table**.
3. **Response** 200 `{"ok": true}`.

### Case `schedule_add`

1. **Condition (validation):** `date` matches `yyyy-MM-dd`, `email` contains `@`, `station`, `start` and `end` are not empty. If it fails, **Response** 400 `{"error":"Date, person, robot, start and end are required"}`.
2. **Compose `id`:** `guid()`.
3. **Add a row into a table**, `Schedule`: `ID` = id, `Date` = `date`, `Name` = `trim(name)`, `Email` = `toLower(trim(email))`, `Station` = `station`, `Start` = `start`, `End` = `end`, `Note` = `note`, `Updated` = `utcNow()`.
4. **Response** 200:

```json
{ "ok": true, "shift": { "id": "<id>", "date": "<date>", "name": "<name>", "email": "<email>", "station": "<station>", "start": "<start>", "end": "<end>", "note": "<note>" } }
```

### Case `schedule_delete`

1. **Delete a row**, table `Schedule`, Key Column `ID`, Key Value `id`.
2. **Response** 200 `{"ok": true}`. If the row is already gone, also return `{"ok": true}`, because the page has already removed it.

### Default case

**Response** 400 `{"error":"unknown action"}`.

---

## 3. Flow: **Onsite Read**

**Trigger:** *When an HTTP request is received*, POST, **Anyone**. Body schema:

```json
{ "type": "object", "properties": { "action": { "type": "string" }, "email": { "type": "string" } } }
```

1. **List rows present in a table**, `Punches`. Open **Settings → Pagination: On, Threshold 5000**. Without it the connector stops at 256 rows, the same problem the Twilight SessionState Read had.
   - If `action` = `status` and `email` is set, add Filter Query `Email eq '<toLower(email)>'` so the check-in page fetches only that person's rows. (Optional: the page filters by email on its side anyway.)
2. **Select** (from `value`) to shape each row:

```
id      : item()?['ID']
ts      : item()?['Timestamp']
name    : item()?['Name']
email   : item()?['Email']
type    : toLower(item()?['InOut'])
station : item()?['Station']
note    : item()?['Note']
flag    : if(empty(item()?['Flag']),'','early')
```

3. **List rows present in a table**, `ClientHours` (pagination on), then **Select**: `week : item()?['Week']`, `hours : float(item()?['SuccessfulHours'])`. If `SuccessfulHours` can be blank, use `float(coalesce(item()?['SuccessfulHours'],'0'))`.
4. **List rows present in a table**, `Schedule` (pagination on, threshold 5000). Optionally add Filter Query `Date ge '<14 days ago, yyyy-MM-dd>'` once the sheet gets long. Then **Select**:

```
id      : item()?['ID']
date    : item()?['Date']
name    : item()?['Name']
email   : item()?['Email']
station : item()?['Station']
start   : item()?['Start']
end     : item()?['End']
note    : item()?['Note']
```

5. **Response** 200, `Content-Type: application/json`:

```json
{ "punches": <Select punches output>, "client": <Select client output>, "schedule": <Select schedule output> }
```

For `action` = `status` you can skip steps 3 and 4 and return `"client": [], "schedule": []`.

---

## 4. What the page does with the data (so the flows don't need to)

- **Shifts:** pairs each person's `IN` with their next `OUT`. An `IN` with no `OUT` by the end of that day is flagged **No check-out** and counts no hours.
- **Operator hours:** each operator's own time added up, per day and per week.
- **Hours worked (robot time):** for each *day + robot*, the **overlap of everyone's time is merged**. Two people on Robot 2 from 8:00 to 14:00 count as 6 hours worked, not 12. If one leaves at 12:00 and the other stays, it's still 6.
- **Left early:** any `OUT` sooner than `shiftHours − earlyGraceMinutes` (config: 6 h − 15 min) after that person's `IN` must include a reason, and it's flagged.
- **Schedule vs check-ins:** for each scheduled shift, the page shows the person as *on site* once they check in that day, *not here yet* from 15 minutes after the start (a robot missing its person shows **Needs a backfill**), and *no-show* once the shift ends with no check-in. Check-ins with no scheduled shift show as *not on the schedule*. A robot that has some shifts on a day but fewer than two people scheduled shows as *understaffed* on the Schedule tab.
- **Exports:** **Records** downloads a check-in log CSV (same columns as `Punches`) and a shifts CSV (in, out, hours per person per day) to compare with the client's badge records.

## 5. Test after building

1. With both URLs in `public/config.js`, open the page, check in, and confirm a row appears in `Punches` with server `Timestamp` and site-local `Date`/`Time`.
2. Check out right away. The page should ask for a reason. Confirm `Flag` = `Left early` and that the alert email arrives.
3. Open **Today** (`#/admin/today`) and confirm the person shows under "On site" and in their robot's lane, and the early check-out under "Needs attention".
4. On **Schedule** (`#/admin/schedule`), add a shift for today that started over 15 minutes ago, for someone who isn't checked in. Confirm a `Schedule` row appears and that **Today** lists them under "Missing", with their robot under "Needs a backfill". Remove the shift and confirm the row is deleted.
5. On **Hours**, type a number in **Client successful hours** and confirm a `ClientHours` row for that Monday.
