import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Toaster, toast } from 'sonner';
import { CalendarDays, ChartColumn, ClipboardCheck, Clock, ExternalLink, FileSpreadsheet, IdCard, Laptop, List, LogOut, Monitor, Moon, RefreshCw, Search, Settings, Smartphone, Sun, Users } from 'lucide-react';
import { useStore } from './lib/store.js';
import { CFG, DEMO } from './lib/config.js';
import { MS_AUTH, ROLES, hasRole } from './lib/auth.js';
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
import { OperatorSheet, SearchSheet } from './components/Search.jsx';
import centificMark from './assets/centific-mark.png';

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
];
const CHECKIN = { id: 'checkin', label: 'Clock in', icon: Clock, view: CheckIn };
const NO_ACCESS = { id: 'admin/none', label: 'Admin', view: NoAccess };
const LEGACY = { today: 'admin/today', schedule: 'admin/schedule', hours: 'admin/hours', records: 'admin/records', admin: 'admin/today' };

export default function App() {
  const route = useRoute();
  const { sync, init, theme, data, syncing, error, loadedAt, session, authReady, setSearching } = useStore();
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
  // Load now, then refresh every minute while the page is visible.
  useEffect(() => {
    if (!authReady) return undefined;
    sync();
    const id = setInterval(() => { if (!document.hidden) sync(); }, 60000);
    const onVis = () => { if (!document.hidden) sync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [sync, authReady, session?.email]);

  // Older links (#/today, #/hours, #/records) and a bare #/admin land on the admin views.
  useEffect(() => {
    const to = LEGACY[route];
    if (to) location.replace(`${location.pathname}${location.search}#/${to}${location.hash.includes('?') ? location.hash.slice(location.hash.indexOf('?')) : ''}`);
  }, [route]);
  const isAdmin = route.startsWith('admin') || route in LEGACY;
  const nav = ADMIN_NAV.filter((n) => hasRole(session, ...n.roles));
  const item = isAdmin ? nav.find((n) => n.id === (LEGACY[route] || route)) || nav[0] || NO_ACCESS : CHECKIN;

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
  const status = DEMO
    ? 'Demo data'
    : syncing && !data ? 'Loading…'
      : error ? 'Refresh failed'
        : loadedAt ? `Updated ${fmtTime(loadedAt)}` : '';

  const main = (
    <main className="main" key={item.id}>
      {data || (!isAdmin && !session) ? <View /> : <div className="view"><div className="skeleton" /><div className="skeleton tall" /></div>}
    </main>
  );
  const actions = (compact) => (
    <>
      {compact && canSearch && <button type="button" className="icon-btn" aria-label="Search" onClick={() => setSearching(true)}><Search size={18} /></button>}
      <SyncButton syncing={syncing} onClick={manualSync} status={status} error={error} compact={compact} />
      <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettings(true)}><Settings size={18} /></button>
    </>
  );
  const toaster = (
    <>
      <SettingsSheet open={settings} onOpenChange={setSettings} admin={isAdmin} />
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

  if (!session) {
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
          <button type="button" className="side-search" onClick={() => setSearching(true)}>
            <Search size={16} aria-hidden="true" /> Search <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        )}
        <nav className="side-nav" aria-label="Admin">
          {nav.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className={clsx('side-link', n.id === item.id && 'is-active')} aria-current={n.id === item.id ? 'page' : undefined}>
              <n.icon size={18} aria-hidden="true" />
              {n.label}
            </a>
          ))}
        </nav>
        <a className="side-out" href="#/" target="_blank" rel="noopener">
          <ExternalLink size={15} aria-hidden="true" /> Open the operator page
        </a>
        <div className="side-who">
          <span className="row-title">{session.name}</span>
          <span className="row-sub">{(session.roles || []).map((r) => ROLES[r]).join(' · ')}</span>
        </div>
        <div className="side-foot">{actions(false)}</div>
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

      <nav className="tabbar" aria-label="Admin" style={{ gridTemplateColumns: `repeat(${nav.length || 1}, 1fr)` }}>
        {nav.map((n) => (
          <a key={n.id} href={`#/${n.id}`} className={clsx('tab', n.id === item.id && 'is-active')} aria-current={n.id === item.id ? 'page' : undefined}>
            <n.icon size={22} aria-hidden="true" />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>
      {toaster}
    </div>
  );
}

function SyncButton({ syncing, onClick, status, error, compact }) {
  return (
    <button
      type="button"
      className={clsx('sync', syncing && 'is-busy', error && 'is-bad', compact && 'sync-compact')}
      onClick={onClick}
      aria-busy={syncing}
      title={error || 'Refresh now'}
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

function SettingsSheet({ open, onOpenChange, admin }) {
  const { theme, setTheme, device, setDevice, session, signOut, resetDemo } = useStore();
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
      {session && (
        <Group title="Signed in">
          <Row title={session.name} subtitle={`${session.email} · ${(session.roles || []).map((r) => ROLES[r]).join(', ')}${session.demo ? ' · demo' : ''}`} trailing={<button type="button" className="link" onClick={() => { onOpenChange(false); signOut(); }}><LogOut size={14} /> Sign out</button>} />
        </Group>
      )}
      <Group title="Data" footer={DEMO ? 'Sample data saved only in this browser. Add the Power Automate flow URLs to config.js to go live.' : 'Reads and writes the Lotus lists on SharePoint through Power Automate.'}>
        <Row title="Source" trailing={DEMO ? 'Demo' : 'Live · SharePoint'} />
        <Row title="Sign-in" trailing={MS_AUTH ? 'Microsoft' : 'Demo'} />
        {DEMO && <Row title="Reset sample data" onClick={() => { resetDemo(); toast('Sample data reset'); }} className="row-action" />}
      </Group>
    </Sheet>
  );
}
