import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Toaster, toast } from 'sonner';
import { CalendarDays, ChevronRight, CircleHelp, KeyRound, ChartColumn, ClipboardCheck, Clock, Mail, ExternalLink, Eye, FileSpreadsheet, IdCard, Laptop, List, LogOut, Monitor, Moon, RefreshCw, Search, Settings, Smartphone, Sun, Users } from 'lucide-react';
import { useStore } from './lib/store.js';
import { CFG, DEMO, DEMO_CHOSEN, LIVE_READY, PREVIEW } from './lib/config.js';
import { useTimings } from './lib/timing.js';
import { ROLES, hasRole } from './lib/auth.js';
import { DEMO_PASSWORD, LOCAL_AUTH } from './lib/auth/api.js';
import { go, useMedia, useRoute } from './lib/hooks.js';
import { fmtTime } from './lib/time.js';
import { Group, Row, Segmented, Sheet, StatusLine, Tag } from './components/ui.jsx';
import { CheckIn } from './views/CheckIn.jsx';
import { Today } from './views/Today.jsx';
import { Hours } from './views/Hours.jsx';
import { Records } from './views/Records.jsx';
import { Schedule } from './views/Schedule.jsx';
import { Review } from './views/Review.jsx';
import { Roster } from './views/Roster.jsx';
import { Reports } from './views/Reports.jsx';
import { Emails } from './views/Emails.jsx';
import { Users as UsersView } from './views/Users.jsx';
import { ResetPassword } from './views/ResetPassword.jsx';
import { OperatorSheet, SearchSheet } from './components/Search.jsx';
import centificMark from './assets/centific-mark.png';
import { Tour } from './tour/Tour.jsx';
import { UpdateNotice, hardRefresh, useUpdate } from './components/UpdateNotice.jsx';
import { VERSION } from './version.js';
import { useTour } from './tour/tourStore.js';

// Centific mark, drawn as a mask so it takes the theme's logo color (dark grey / white).
const Logo = ({ size = 28 }) => (
  <span className="logo" role="img" aria-label="Centific" style={{ '--logo-src': `url(${centificMark})`, width: size, height: size }} />
);

// Two separate experiences: the operator page (#/), and the staff views
// (#/admin/...), each shown only to the roles that use it. The flows enforce the
// same roles on the data, so hiding a tab is never the only protection.
const ADMIN_NAV = [
  { id: 'admin/today', label: 'Today', icon: Users, view: Today, roles: ['scheduler', 'approver'] },
  { id: 'admin/schedule', label: 'Schedule', icon: CalendarDays, view: Schedule, roles: ['scheduler', 'approver'] },
  { id: 'admin/roster', label: 'Roster', icon: IdCard, view: Roster, roles: ['scheduler'] },
  { id: 'admin/review', label: 'Review', icon: ClipboardCheck, view: Review, roles: ['approver'] },
  { id: 'admin/hours', label: 'Hours', icon: ChartColumn, view: Hours, roles: ['scheduler', 'approver'] },
  { id: 'admin/records', label: 'Records', icon: List, view: Records, roles: ['scheduler', 'approver'] },
  { id: 'admin/reports', label: 'Reports', icon: FileSpreadsheet, view: Reports, roles: ['approver', 'reporting'] },
  // Editing templates is desk work, so it stays off the phone tab bar.
  { id: 'admin/emails', label: 'Emails', icon: Mail, view: Emails, roles: ['scheduler', 'approver'], phone: false },
  // Who can sign in, and with which roles: opened from Settings, not the sidebar.
  // The Lotus Auth flow checks the admin role too.
  { id: 'admin/users', label: 'Users', icon: KeyRound, view: UsersView, roles: ['admin'], phone: false, hidden: true },
];
const REFRESH_MS = 5 * 60 * 1000;
const CHECKIN = { id: 'checkin', label: 'Clock in', icon: Clock, view: CheckIn };
// A password reset link (#/reset?u=…&c=…) opens this, signed in or not.
const RESET = { id: 'reset', label: 'Reset password', icon: KeyRound, view: ResetPassword };
const NO_ACCESS = { id: 'admin/none', label: 'Admin', view: NoAccess };
const LEGACY = { today: 'admin/today', schedule: 'admin/schedule', hours: 'admin/hours', records: 'admin/records', admin: 'admin/today' };

export default function App() {
  const route = useRoute();
  const { sync, init, theme, data, syncing, error, loadedAt, session, authStage, signOut, setSearching, demo, jobs, tasks } = useStore();
  const [settings, setSettings] = useState(false);
  const systemDark = useMedia('(prefers-color-scheme: dark)');
  const phone = useMedia('(max-width: 767px)');
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#222523' : '#f1f3f1');
  }, [theme, resolved]);

  useEffect(() => { init(); }, [init]);
  // The operator preview tab signs itself in as the demo operator, who then picks
  // which sample operator to be.
  useEffect(() => {
    if (!PREVIEW || authStage !== 'signedOut') return;
    useStore.getState().signIn('Lotus-operator', DEMO_PASSWORD).catch((e) => toast.error('Preview didn’t start', { description: e.message }));
  }, [authStage]);
  // Closing the tab while something is saving in this tab would stop it: ask first.
  // (Queued edits survive a reload; approvals, emails and imports in flight don't.)
  useEffect(() => {
    const busy = tasks.length > 0 || jobs.some((j) => j.state === 'sending');
    if (!busy) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [tasks.length, jobs]);
  // A sign-in lasts 12 hours, then it's back to the sign-in screen without a reload.
  useEffect(() => {
    if (!session?.expiresAt) return undefined;
    const ms = Date.parse(session.expiresAt) - Date.now();
    const t = setTimeout(() => { signOut(); toast('Signed out', { description: 'Your sign-in ran out after 12 hours. Sign in again to carry on.' }); }, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(t);
  }, [session?.expiresAt, signOut]);
  // Load now, then refresh every minute while the page is visible.
  useEffect(() => {
    if (authStage !== 'signedIn' && authStage !== 'pick') return undefined;
    sync();
    // Every load runs the Read flow, and every flow run spends Power Automate's
    // shared request allowance (the same one Lotus saves and other teams' flows
    // use; when it runs short, every flow slows down). So refresh every 5 minutes
    // while the page is in view, and on coming back to it only if the data is
    // over a minute old. Saves update the screen themselves, and Refresh is there.
    const stale = (ms) => { const at = useStore.getState().loadedAt; return !at || Date.now() - at.getTime() > ms; };
    const id = setInterval(() => { if (!document.hidden) sync(); }, REFRESH_MS);
    const onVis = () => { if (!document.hidden && stale(60000)) sync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [sync, authStage, session?.email]);

  // Older links (#/today, #/hours, #/records) and a bare #/admin land on the admin views.
  useEffect(() => {
    const to = LEGACY[route];
    if (to) location.replace(`${location.pathname}${location.search}#/${to}${location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''}`);
  }, [route]);
  const isAdmin = route.startsWith('admin') || route in LEGACY;
  const nav = ADMIN_NAV.filter((n) => hasRole(session, ...n.roles));
  const item = route === 'reset' ? RESET : isAdmin ? nav.find((n) => n.id === (LEGACY[route] || route)) || nav[0] || NO_ACCESS : CHECKIN;

  // The page's large title folds into the phone top bar once it scrolls under it.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(false);
    let io;
    const id = requestAnimationFrame(() => {
      const t = document.querySelector('.main .large-title');
      if (!t) return;
      io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' });
      io.observe(t);
    });
    return () => { cancelAnimationFrame(id); io?.disconnect(); };
  }, [item.id, data]);
  const View = item.view;

  // The tour: the welcome tour on first sign-in, then each page's own tour on its
  // first visit. Seen tours are remembered per username in this browser.
  const tour = useTour();
  const section = item === RESET ? 'reset' : isAdmin ? item.id : 'checkin';
  const signedIn = authStage === 'signedIn';
  useEffect(() => { if (signedIn) tour.setWho(session.username || session.email, session.roles || []); }, [signedIn, session?.username, session?.email, (session?.roles || []).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { useTour.getState().stop(); }, [section, authStage]);
  useEffect(() => {
    if (!signedIn || !data || tour.run || tour.who !== (session.username || session.email)) return undefined;
    const first = isAdmin ? (!tour.seen.has('welcome') && tour.has('welcome') ? 'welcome' : null) : null;
    const page = !tour.seen.has(section) && tour.has(section) && (isAdmin || hasRole(session, 'operator')) ? section : null;
    if (!first && !page) return undefined;
    // Let the page settle in, and wait while a sheet or menu is open.
    const t = setInterval(() => {
      if (document.querySelector('[role="dialog"], [role="listbox"]')) return;
      clearInterval(t);
      if (first) tour.start(first, page);
      else tour.start(page);
    }, 700);
    return () => clearInterval(t);
  }, [signedIn, data, section, tour.run, tour.seen, tour.who]); // eslint-disable-line react-hooks/exhaustive-deps
  const replayTour = () => (tour.has(section) ? tour.start(section) : tour.start(isAdmin ? 'welcome' : 'checkin'));
  const fullTour = () => (isAdmin ? tour.start('welcome', section) : tour.start('checkin'));
  // Search is for the people who schedule and review; ⌘K or Ctrl+K opens it anywhere, and so does / outside a field.
  const canSearch = isAdmin && hasRole(session, 'scheduler', 'approver');
  useEffect(() => {
    if (!canSearch) return undefined;
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setSearching(true);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [canSearch, setSearching]);
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const manualSync = async () => {
    try { await sync({ manual: true }); } catch (e) { toast.error("Couldn't refresh", { description: e.message }); }
  };
  // Loading with nothing on screen yet: after a few seconds, say why it's taking a while.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (data || !syncing) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, [data, syncing]);
  // Unsent changes come first: the header says so until the save queue is empty.
  // Background work (store.background) counts too; one task on its own shows its own words.
  const stuck = jobs.filter((j) => j.state === 'stuck').length;
  const working = jobs.length - stuck + tasks.length;
  const one = !jobs.length && tasks.length === 1 ? tasks[0] : null;
  const status = stuck ? `${stuck} not saved`
    : one ? `${one.label}${one.note ? ` · ${one.note}` : ''}…`
    : working ? `Saving ${working}…`
    : DEMO ? 'Demo data'
    : syncing && !data ? 'Loading…'
      : error ? 'Refresh failed'
        : loadedAt ? `Updated ${fmtTime(loadedAt)}` : '';

  const main = (
    <main className="main" key={`${item.id}-${demo ? 'demo' : 'live'}`}>
      {data || item === RESET || (!isAdmin && authStage !== 'signedIn') ? <View /> : !syncing && error ? (
        <div className="view view-narrow">
          <div className="card pad load-fail" role="alert">
            <h2 className="group-title">Couldn’t load the Lotus data</h2>
            <p className="lede">{error}</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={manualSync}>Try again</button>
          </div>
        </div>
      ) : <div className="view"><div className="skeleton" /><div className="skeleton tall" />{slow && <p className="lede load-slow" role="status">Still loading from SharePoint. The first load can take up to a minute.</p>}</div>}
    </main>
  );
  const actions = (compact) => (
    <>
      {compact && canSearch && <button type="button" className="icon-btn" aria-label="Search" data-tour="search" onClick={() => setSearching(true)}><Search size={18} /></button>}
      {signedIn && <button type="button" className="icon-btn" aria-label="Tour of this page" title="Tour of this page" data-tour="help" onClick={replayTour}><CircleHelp size={18} /></button>}
      <SyncButton syncing={syncing} onClick={stuck ? () => useStore.getState().retryJobs() : manualSync} status={status} error={error || (stuck ? `${stuck} change${stuck === 1 ? '' : 's'} didn’t reach Lotus after several tries. They’re kept in this browser. Click to try again.` : '')} saving={working > 0} compact={compact} />
      <button type="button" className="icon-btn" aria-label="Settings" data-tour="settings" onClick={() => setSettings(true)}><Settings size={18} /></button>
    </>
  );
  const toaster = (
    <>
      <SettingsSheet open={settings} onOpenChange={setSettings} admin={isAdmin} onTour={signedIn ? fullTour : null} />
      <Tour />
      <DemoBanner />
      <UpdateNotice />
      {canSearch && data && <><SearchSheet /><OperatorSheet /></>}
      {/* On phones the check-in actions sit at the bottom, so toasts come in from the top. */}
      <Toaster position={phone ? 'top-center' : 'bottom-center'} duration={6000} theme={resolved} offset={24} mobileOffset={{ top: 64 }} toastOptions={{ className: 'toast' }} />
    </>
  );

  if (!isAdmin) {
    return (
      <div className="app app-checkin">
        <header className="topbar topbar-checkin">
          <div className="top-left">
            <Logo size={26} />
            <span className="top-brand">Lotus on-site</span>
            {DEMO && <Tag tone="warn">Demo</Tag>}
          </div>
          <div className="top-actions">{actions(true)}</div>
        </header>
        {main}
        {toaster}
      </div>
    );
  }

  if (authStage !== 'signedIn') {
    return (
      <div className="app app-checkin">
        <header className="topbar topbar-checkin">
          <div className="top-left"><Logo size={26} /><span className="top-brand">Lotus admin</span>{DEMO && <Tag tone="warn">Demo</Tag>}</div>
        </header>
        <main className="main"><CheckIn /></main>
        {toaster}
      </div>
    );
  }

  return (
    <div className="app app-admin">
      <aside className="sidebar">
        <div className="side-brand">
          <Logo size={30} />
          <div className="side-titles">
            <span className="side-name">Lotus admin</span>
            <span className="side-project">{CFG.project}</span>
          </div>
        </div>
        {canSearch && (
          <button type="button" className="side-search" data-tour="search" onClick={() => setSearching(true)}>
            <Search size={16} aria-hidden="true" /> Search <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        )}
        <nav className="side-nav" aria-label="Admin">
          {nav.filter((n) => !n.hidden).map((n) => (
            <a key={n.id} href={`#/${n.id}`} data-tour={`nav-${n.id}`} className={clsx('side-link', n.id === item.id && 'is-active')} aria-current={n.id === item.id ? 'page' : undefined}>
              <n.icon size={18} aria-hidden="true" />
              {n.label}
            </a>
          ))}
        </nav>
        <a className="side-out" href="#/" target="_blank" rel="noopener">
          <ExternalLink size={15} aria-hidden="true" /> Open the operator page
        </a>
        <a className="side-out" href="?preview=operator#/" target="_blank" rel="noopener" title="Opens the operator page as a sample operator, on demo data. Nothing is saved.">
          <Eye size={15} aria-hidden="true" /> Preview as an operator
        </a>
        <div className="side-who">
          <span className="row-title">{session.name}</span>
          <span className="row-sub">{(session.roles || []).map((r) => ROLES[r]).join(' · ')}</span>
        </div>
        <div className="side-foot">{actions(false)}</div>
        <span className="app-version side-version" title={`Lotus ${VERSION}`}>v{VERSION}</span>
      </aside>

      <header className="topbar" data-collapsed={collapsed || undefined}>
        <div className="top-left">
          <Logo size={24} />
          {DEMO && <Tag tone="warn">Demo</Tag>}
          <span className="top-name">{item.label}</span>
        </div>
        <div className="top-actions">{actions(true)}</div>
      </header>

      {main}

      <nav className="tabbar" aria-label="Admin" style={{ gridTemplateColumns: `repeat(${nav.filter((n) => n.phone !== false && !n.hidden).length || 1}, 1fr)` }}>
        {nav.filter((n) => n.phone !== false && !n.hidden).map((n) => (
          <a key={n.id} href={`#/${n.id}`} data-tour={`nav-${n.id}`} className={clsx('tab', n.id === item.id && 'is-active')} aria-current={n.id === item.id ? 'page' : undefined}>
            <n.icon size={22} aria-hidden="true" />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      {toaster}
    </div>
  );
}

function SyncButton({ syncing, onClick, status, error, saving, compact }) {
  return (
    <button
      type="button"
      className={clsx('sync', syncing && 'is-busy', !syncing && saving && !error && 'is-saving', error && 'is-bad', compact && 'sync-compact')}
      onClick={onClick}
      aria-busy={syncing}
      title={error || (saving ? `${status}. Your changes are on screen and saving to Lotus in the background; you can keep working.` : 'Refresh now')}
    >
      <span className="sync-icon" aria-hidden="true">
        <RefreshCw size={16} className="sync-glyph" />
        <span className="dots"><i /><i /><i /><i /></span>
      </span>
      <span className={clsx('sync-text', compact && 'sr-only-sm')} role="status" aria-live="polite">
        <StatusLine text={syncing ? 'Syncing' : status} />
      </span>
    </button>
  );
}

function NoAccess() {
  const { session, signOut } = useStore();
  return (
    <div className="view view-narrow view-enter center-col">
      <h1 className="large-title">No admin access</h1>
      <p className="lede">{session?.name} is signed in as an operator. Admin views are for schedulers, approvers and reporting.</p>
      <div className="dock">
        <a className="btn btn-primary btn-block" href="#/">Open the operator page</a>
        <button type="button" className="link-quiet" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

function SettingsSheet({ open, onOpenChange, admin, onTour }) {
  const { theme, setTheme, device, setDevice, session, signOut, resetDemo, switchDemo } = useStore();
  const [switching, setSwitching] = useState(false);
  const latest = useUpdate((s) => s.latest);
  const timings = useTimings((s) => s.list);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Settings">
      <Group title="Appearance">
        <div className="pad">
          <Segmented
            label="Appearance"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: 'System', icon: <Monitor size={15} /> },
              { value: 'light', label: 'Light', icon: <Sun size={15} /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={15} /> },
            ]}
          />
        </div>
      </Group>
      {!admin && (
        <Group title="This device" footer={device === 'shared' ? 'The lab laptop signs each operator out after they clock in or out, so the next one signs in as themselves.' : 'Your own phone stays signed in.'}>
          <div className="pad">
            <Segmented
              label="This device"
              value={device || 'personal'}
              onChange={setDevice}
              options={[
                { value: 'personal', label: 'My phone', icon: <Smartphone size={15} /> },
                { value: 'shared', label: 'Lab laptop', icon: <Laptop size={15} /> },
              ]}
            />
          </div>
        </Group>
      )}
      {onTour && (
        <Group title="Help">
          <Row leading={<CircleHelp size={18} aria-hidden="true" />} title="Take the tour" subtitle={admin ? 'A short walk through Lotus admin' : 'A short walk through clocking in'} trailing={<ChevronRight size={18} aria-hidden="true" />} onClick={() => { onOpenChange(false); setTimeout(onTour, 250); }} />
        </Group>
      )}
      {hasRole(session, 'admin') && (
        <Group title="Admin" footer="Add people, set their roles, and reset passwords.">
          <Row leading={<KeyRound size={18} aria-hidden="true" />} title="Users and sign-ins" trailing={<ChevronRight size={18} aria-hidden="true" />} onClick={() => { onOpenChange(false); go('admin/users'); }} />
        </Group>
      )}
      {session && (
        <Group title="Signed in">
          <Row title={session.name} subtitle={`${session.username || session.email} · ${(session.roles || []).map((r) => ROLES[r]).join(', ')}${LOCAL_AUTH ? ' · demo' : ''}`} trailing={<button type="button" className="link" onClick={() => { onOpenChange(false); signOut(); }}><LogOut size={14} /> Sign out</button>} />
        </Group>
      )}
      <Group title="Data" footer={!LIVE_READY ? 'Sample data saved only in this browser. Add the Power Automate flow URLs to go live.' : DEMO ? 'Sample operators and shifts, kept in this browser. Nothing is saved to SharePoint or emailed. Sign-in stays real.' : 'Reads and writes the Lotus lists on SharePoint through Power Automate.'}>
        <Row title="Source" trailing={DEMO ? 'Demo' : 'Live · SharePoint'} />
        {admin && (
          <button
            type="button"
            role="switch"
            aria-checked={DEMO}
            aria-busy={switching || undefined}
            className="row row-btn"
            disabled={!LIVE_READY}
            onClick={async () => {
              if (switching) return;
              const on = !DEMO;
              setSwitching(true);
              try {
                await switchDemo(on);
                toast(on ? 'Demo data on' : 'Live data loaded', { description: on ? 'Sample operators and shifts in this browser only.' : 'Reading the Lotus lists on SharePoint.' });
              } catch (e) {
                toast.error('Couldn’t load the live data', { description: e.message });
              } finally {
                setSwitching(false);
              }
            }}
          >
            <span className="row-main"><span className="row-title">Demo data</span><span className="row-sub">{!LIVE_READY ? 'Always on until the flow URLs are added to the site' : DEMO ? 'On in this browser. Switch off to load the real data.' : 'Off. Switch on to try things with sample data in this browser.'}</span></span>
            <span className="row-trail"><span className={clsx('switch', DEMO && 'is-on')} aria-hidden="true"><span /></span></span>
          </button>
        )}
        <Row title="Sign-in" trailing={LOCAL_AUTH ? 'Demo · this browser' : 'Lotus username'} />
        {DEMO && <Row title="Reset sample data" onClick={() => { resetDemo(); toast('Sample data reset'); }} className="row-action" />}
      </Group>
      <Group title="About">
        <Row title="Version" trailing={<span className="mono-num">{VERSION}</span>} />
        {latest && <Row title={`Refresh to update to ${latest}`} onClick={hardRefresh} className="row-action" />}
      </Group>
      {timings.length > 0 && (
        <Group title="Speed" footer="How long each recent call took. Most of it is the Power Automate flow's run time.">
          {timings.slice(0, 6).map((t) => (
            <Row key={`${t.at}-${t.label}`} title={t.label} trailing={<span className="mono-num">{t.ok ? '' : 'failed · '}{(t.ms / 1000).toFixed(1)} s</span>} />
          ))}
        </Group>
      )}
    </Sheet>
  );
}

// On a live site with demo data switched on, always on screen, so nobody mistakes
// sample operators for real ones. (Without flow URLs the Demo tag says it instead.)
function DemoBanner() {
  const switchDemo = useStore((s) => s.switchDemo);
  useStore((s) => s.demo); // re-render when the switch flips
  if (PREVIEW) {
    return (
      <div className="demo-banner" role="status">
        <span className="demo-banner-dot" aria-hidden="true" />
        <span><strong>Operator preview</strong><span className="demo-banner-more"> · demo data in this tab only, nothing is saved or emailed</span></span>
        <button type="button" className="link" onClick={() => window.close()}>Close</button>
      </div>
    );
  }
  if (!DEMO_CHOSEN) return null;
  return (
    <div className="demo-banner" role="status">
      <span className="demo-banner-dot" aria-hidden="true" />
      <span><strong>Demo data</strong><span className="demo-banner-more"> · sample operators, nothing is saved or emailed</span></span>
      <button type="button" className="link" onClick={() => switchDemo(false).then(() => toast('Live data loaded'), (e) => toast.error('Couldn’t load the live data', { description: e.message }))}>Show real data</button>
    </div>
  );
}
