# Lotus on-site time tracking

Scheduling, attendance and approved hours for the Google Lotus on-site project (Redmond Lab and Mountain View Lab). React + Vite. The live app runs on GitHub Pages; the flow URLs come from the repo's Actions secrets at deploy time, never from the repo. Each person signs in with a username and password that a Lotus admin gives them (the Project Atlas pattern); the data lives in SharePoint lists, read and written through Power Automate flows ([docs/lotus-flows.md](docs/lotus-flows.md)).

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

The live app is the GitHub Pages site. The flow trigger URLs never go in this repo: the deploy workflow reads them from the repo's Actions secrets and writes them only into the built `config.js` ([scripts/pages-config.mjs](scripts/pages-config.mjs)).

1. Build the lists and flows with [docs/lotus-flows.md](docs/lotus-flows.md).
2. On GitHub: **Settings > Secrets and variables > Actions > New repository secret**, for each flow: `LOTUS_AUTH_URL`, `LOTUS_READ_URL`, `LOTUS_WRITE_URL` and `LOTUS_CORRECTIONS_URL` (missed clock-in requests and strikes; unset, those go to Write). A secret left unset keeps that flow in demo mode.
3. **Actions > Deploy to GitHub Pages > Run workflow** (or push to `main`). The build log says which flows were set, never the URLs.
4. Open the site with `?setup=1` once to create the first admin. Admins then give people sign-ins from Roster (Add operator, Set up sign-in) or Settings → Users and sign-ins. Adjust `locations` in `public/config.js` (robots, shift templates and how many operators each needs, the days each lab runs, grace) as labs change.

Leave `authUrl`, `readUrl` and `writeUrl` empty in `public/config.js`. Note that the built site's `config.js` is public, so anyone who opens the site can read the URLs there; what protects the data is the sign-in token every Read and Write call needs, and the flows' role checks. To change a URL, update its secret and re-run the workflow. To block an exposed URL, regenerate the flow's trigger.

[server/index.mjs](server/index.mjs) and [render.yaml](render.yaml) remain as an option for hosting on Render, where the server keeps the URLs out of the page.

## Install as an app

Lotus is an installable web app (PWA). On a phone, open the site and choose **Add to Home Screen** (Safari) or **Install app** (Chrome). On a desktop, use the install icon in Chrome or Edge's address bar. It opens in its own window with the Centific icon.

`public/sw.js` caches only the app's own files, so the app opens without a connection. Live data (`api/*`, every POST) and `version.json` always come from the network. `config.js` is fetched fresh and kept only as an offline fallback. The worker runs only in the built site, not on the dev server.

## Design

- [PRODUCT.md](PRODUCT.md): who it's for and the product rules.
- [ux-behavior-spec.md](ux-behavior-spec.md): motion and interaction rules.
- `DESIGN.md`: the visual system.
