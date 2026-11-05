# Lotus on-site time tracking

Scheduling, attendance and approved hours for the Google Lotus on-site project (Redmond Lab and Mountain View Lab). React + Vite. The live app runs on Render, behind a small server that keeps the flow URLs secret; GitHub Pages hosts the demo. Each person signs in with a username and password that a Lotus admin gives them (the Project Atlas pattern); the data lives in SharePoint lists, read and written through Power Automate flows ([docs/lotus-flows.md](docs/lotus-flows.md)).

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

The flow trigger URLs are secrets: anyone holding one can call the flow. They never go in this repo or in the page. The live app runs on Render, where [server/index.mjs](server/index.mjs) serves the built app and forwards its calls to the flows, so the browser only ever sees `api/auth`, `api/read` and `api/write`.

1. Build the lists and flows with [docs/lotus-flows.md](docs/lotus-flows.md).
2. In Render: **New > Blueprint**, pick this repo ([render.yaml](render.yaml)), and paste the three URLs when asked: `LOTUS_AUTH_URL`, `LOTUS_READ_URL`, `LOTUS_WRITE_URL`. A flow left empty stays in demo mode. To change a URL later, edit it under the service's **Environment** and Render restarts it.
3. Open the Render site with `?setup=1` once to create the first admin. Admins then give people sign-ins from Roster (Add operator, Set up sign-in) or Settings → Users and sign-ins. Adjust `locations` in `public/config.js` (robots, shift templates and how many operators each needs, the days each lab runs, grace) as labs change.
4. Pushes to `main` redeploy Render (and the GitHub Pages demo, which never gets the URLs).

Leave `authUrl`, `readUrl` and `writeUrl` empty in `public/config.js`; the Render server fills them in with its own addresses. Run it locally with `npm run build && npm start`.

## Install as an app

Lotus is an installable web app (PWA). On a phone, open the site and choose **Add to Home Screen** (Safari) or **Install app** (Chrome). On a desktop, use the install icon in Chrome or Edge's address bar. It opens in its own window with the Centific icon.

`public/sw.js` caches only the app's own files, so the app opens without a connection. Live data (`api/*`, every POST) and `version.json` always come from the network. `config.js` is fetched fresh and kept only as an offline fallback. The worker runs only in the built site, not on the dev server.

## Design

- [PRODUCT.md](PRODUCT.md): who it's for and the product rules.
- [ux-behavior-spec.md](ux-behavior-spec.md): motion and interaction rules.
- `DESIGN.md`: the visual system.
