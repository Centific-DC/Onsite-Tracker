# Lotus on-site time tracking

Scheduling, attendance and approved hours for the Google Lotus on-site project (Redmond Lab and Mountain View Lab). React + Vite, built to static files for GitHub Pages. Each person signs in with their Microsoft work account; the data lives in SharePoint lists, read and written through two Power Automate flows ([docs/lotus-flows.md](docs/lotus-flows.md)).

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

With the flow URLs or the `auth` block empty in [public/config.js](public/config.js), the app runs in **demo mode**: you pick who you are, and sample data is saved in the browser (reset it in Settings).

## Go live

1. Build the lists and flows with [docs/lotus-flows.md](docs/lotus-flows.md).
2. Register a single-page app in Entra ID (redirect URI = the site URL, delegated permission for Power Automate) and put its `clientId` and `tenantId` into `public/config.js`.
3. Put the Read and Write trigger URLs into `public/config.js`. Adjust `locations` (robots, shift templates, grace) as labs change.
4. Push to `main`; GitHub Pages redeploys. `config.js` is copied as is, so settings can change without a rebuild.

## Design

- [PRODUCT.md](PRODUCT.md): who it's for and the product rules.
- [ux-behavior-spec.md](ux-behavior-spec.md): motion and interaction rules.
- `DESIGN.md`: the visual system.
