# Lotus on-site time tracking

Scheduling, attendance and approved hours for the Google Lotus on-site project (Redmond Lab and Mountain View Lab). React + Vite, built to static files for GitHub Pages. Each person signs in with a username and password that a Lotus admin gives them (the Project Atlas pattern); the data lives in SharePoint lists, read and written through Power Automate flows ([docs/lotus-flows.md](docs/lotus-flows.md)).

Raw clock-ins are never payable hours. Each operator-day is reviewed and approved by a manager, and only approved hours reach the reporting export.

## Who sees what

| Role | Where | What they do |
|---|---|---|
| Operator | `/` (phone or lab laptop) | Clock in to today's assigned shift (opens 10 min before the start, never backdated), clock out, see their own week, flags and approval status. The lab laptop signs each operator out after their tap. |
| Scheduler | Today, Schedule, Roster | Book shifts from each lab's templates; see open slots, pairing risk (two operators under 2 completed sessions), the 37 hrs weekly limit and conflicts; import Active Roster 2 and recruiting's schedule from CSV. |
| Approver | Today, Review, Records, Reports | Resolve each flag with a reason, adjust or approve each operator-day, reopen before monthly reporting. Every decision keeps who and when. |
| Reporting | Reports | Download approved hours by operator and day, in the fixed columns the agency sheet imports. |

Flags: no-show, late arrival, grace used (information only), left early, outside shift (after the end), no clock-out (with a system-suggested end the approver must accept), no clock-in, not on the schedule.

## Develop

```bash
npm install
npm run dev
npm test
```

With the flow URLs empty in [public/config.js](public/config.js), the app runs in **demo mode** on sample data saved in the browser (reset it in Settings). With `authUrl` empty, sign-ins are kept in this browser too, with two demo accounts: **Lotus-admin** and **Lotus-operator**, both with the password `Testing12345` (Lotus-operator then picks which operator to be). These are demo-only; the live Lotus Auth flow has no such accounts.

Once the flows are connected, staff can still switch to sample data in **Settings > Data > Demo data**, as in Project Atlas. It applies to that browser only, shows a "Demo data" banner on every page, and nothing is saved to SharePoint or emailed. Sign-in stays real, and the sample operators never get real sign-ins.

## Go live

1. Build the lists and flows with [docs/lotus-flows.md](docs/lotus-flows.md).
2. Put the Auth, Read and Write trigger URLs into `public/config.js` (`authUrl`, `readUrl`, `writeUrl`).
3. Open the site with `?setup=1` once to create the first admin. Admins then give people sign-ins from Roster (Add operator, Set up sign-in) or Settings → Users and sign-ins. Adjust `locations` (robots, shift templates and how many operators each needs, the days each lab runs, grace) as labs change.
4. Push to `main`; GitHub Pages redeploys. `config.js` is copied as is, so settings can change without a rebuild.

## Design

- [PRODUCT.md](PRODUCT.md): who it's for and the product rules.
- [ux-behavior-spec.md](ux-behavior-spec.md): motion and interaction rules.
- `DESIGN.md`: the visual system.
