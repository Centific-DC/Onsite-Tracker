import { useEffect, useState } from 'react';
import {
  CalendarCheck, CalendarDays, ChartColumn, ChevronRight, CircleHelp, ClipboardCheck, Clock, FileSpreadsheet, Flag, IdCard, Lightbulb,
  LogIn, LogOut, Mail, MessageSquareWarning, RefreshCw, Repeat, Settings, ShieldAlert, Timer, Upload, UserPlus, Users,
} from 'lucide-react';
import { useStore } from '../lib/store.js';
import { STAFF_ROLES, hasRole } from '../lib/auth.js';
import { useRoute } from '../lib/hooks.js';
import { OPERATOR_GUIDE, STAFF_GUIDE } from '../lib/guide.js';
import { useTour } from '../tour/tourStore.js';
import { Segmented } from '../components/ui.jsx';

const ICONS = { CalendarCheck, CalendarDays, ChartColumn, ClipboardCheck, Clock, FileSpreadsheet, Flag, IdCard, LogIn, LogOut, Mail, MessageSquareWarning, RefreshCw, Repeat, Settings, ShieldAlert, Timer, Upload, UserPlus, Users };
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// The Lotus guide: every feature, as short numbered steps and "good to know" notes.
// Operators see the operator guide; staff can switch between both.
export function Guide() {
  const route = useRoute();
  const { session } = useStore();
  const staff = hasRole(session, ...STAFF_ROLES);
  const [who, setWho] = useState(staff && route.startsWith('admin') ? 'staff' : 'operator');
  const list = who === 'staff' ? STAFF_GUIDE : OPERATOR_GUIDE;
  // Opened from further down another page (the tour, the operator page): start at the top.
  useEffect(() => { scrollTo(0, 0); document.querySelector('.main')?.scrollTo?.(0, 0); }, []);
  const jump = (id) => document.getElementById(`guide-${id}`)?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
  const tour = () => useTour.getState().start(who === 'staff' ? 'welcome' : 'checkin');

  return (
    <div className="view guide view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Guide</h1>
          <p className="lede">{who === 'staff' ? 'Planning shifts, covering gaps and approving hours, step by step.' : 'Clocking in and out, your hours and what to do when something goes wrong, step by step.'}</p>
        </div>
        <a className="btn btn-plain btn-sm" href={route.startsWith('admin') ? '#/admin/today' : '#/'}>{route.startsWith('admin') ? 'Back to admin' : 'Back to clock in'}</a>
      </header>

      {staff && (
        <div className="toolbar">
          <Segmented label="Guide for" value={who} onChange={setWho} options={[{ value: 'operator', label: 'Operators' }, { value: 'staff', label: 'Staff' }]} />
        </div>
      )}

      <nav className="guide-jump" aria-label="Topics">
        {list.map((s, i) => {
          const Icon = ICONS[s.icon] || CircleHelp;
          return (
            <button key={s.id} type="button" className="guide-tile" onClick={() => jump(s.id)}>
              <span className="guide-tile-num" aria-hidden="true">{i + 1}</span>
              <span className="guide-icon"><Icon size={18} aria-hidden="true" /></span>
              <span className="guide-tile-title">{s.title}</span>
              <ChevronRight size={16} className="guide-tile-go" aria-hidden="true" />
            </button>
          );
        })}
      </nav>

      {list.map((s, i) => {
        const Icon = ICONS[s.icon] || CircleHelp;
        return (
          <section key={s.id} id={`guide-${s.id}`} className="guide-sec" aria-labelledby={`guide-${s.id}-h`}>
            <header className="guide-sec-head">
              <span className="guide-icon is-lg"><Icon size={22} aria-hidden="true" /></span>
              <div>
                <span className="guide-kicker">{i + 1} of {list.length}</span>
                <h2 id={`guide-${s.id}-h`} className="guide-title">{s.title}</h2>
                <p className="guide-summary">{s.summary}</p>
              </div>
            </header>
            {s.steps?.length > 0 && (
              <ol className="guide-steps">
                {s.steps.map((t, k) => <li key={k}><span className="guide-step-num" aria-hidden="true">{k + 1}</span><span>{t}</span></li>)}
              </ol>
            )}
            {s.table && (
              <table className="guide-table">
                <thead><tr>{s.table.head.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                <tbody>{s.table.rows.map((r) => <tr key={r[0]}><th scope="row">{r[0]}</th><td>{r[1]}</td></tr>)}</tbody>
              </table>
            )}
            {s.tips?.length > 0 && (
              <div className="guide-tips">
                <span className="guide-tips-head"><Lightbulb size={16} aria-hidden="true" /> Good to know</span>
                <ul>{s.tips.map((t, k) => <li key={k}>{t}</li>)}</ul>
              </div>
            )}
          </section>
        );
      })}

      <section className="guide-end">
        <h2 className="guide-title">Still stuck?</h2>
        <p className="guide-summary">Ask your lead or a Lotus admin. The ? button at the top of any page walks you through that page.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={tour}><CircleHelp size={16} aria-hidden="true" /> Take the tour</button>
      </section>
    </div>
  );
}
