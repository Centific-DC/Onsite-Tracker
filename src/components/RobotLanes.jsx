import { useState } from 'react';
import { union } from '../lib/hours.js';
import { fmtHrs, fmtTime, shortName, fmtHrsU } from '../lib/time.js';
import { Tag } from './ui.jsx';
import { TriangleAlert } from 'lucide-react';
import { robotName, robotTitle } from '../lib/robots.js';

const H = 36e5;
const TIP_ROOM = 72; // a tooltip's height plus its gap; less room above flips it below

// Where a span's tooltip goes, relative to the lanes box. The card clips its contents,
// so a span near the top (the first lane) gets its tooltip underneath instead.
function tipAt(el) {
  const r = el.closest('.lanes').getBoundingClientRect();
  const b = el.getBoundingClientRect();
  const mid = b.left - r.left + Math.min(b.width, r.right - b.left) / 2;
  const below = b.top - r.top < TIP_ROOM;
  return { left: Math.max(120, Math.min(r.width - 120, mid)), top: below ? b.bottom - r.top : b.top - r.top, below };
}

// One lane per robot across the day. Each operator's time is a thin line labelled with
// their name (shortened to a last initial when long); the solid bar under them is the merged span, which is what counts as
// the robot's hours worked. A pair working together reads as one bar.
// `planned` are scheduled shifts whose person hasn't arrived: drawn as dashed outlines
// over the time they were due, so a gap in a lane reads as someone missing.
export function RobotLanes({ day, sessions, planned = [], stations, now, pairSize = 2 }) {
  const [tip, setTip] = useState(null);
  const base = new Date(day);
  base.setHours(0, 0, 0, 0);
  const isToday = now.toDateString() === base.toDateString();

  // 7 AM to 7 PM unless the day's sessions run outside it.
  let from = 7, to = 19;
  for (const s of [...sessions, ...planned.map((p) => ({ start: p.startAt, end: p.endAt }))]) {
    from = Math.min(from, Math.floor((s.start - base) / H));
    to = Math.max(to, Math.ceil((s.end - base) / H));
  }
  const span = to - from;
  const x = (t) => `${(((t - base) / H - from) / span) * 100}%`;
  const w = (a, b) => `${(Math.max(0, b - a) / H / span) * 100}%`;
  const ticks = [];
  for (let h = from; h <= to; h += span > 14 ? 3 : 2) ticks.push(h);
  const tickLabel = (h) => { const hh = ((h + 11) % 12) + 1; return `${hh} ${h < 12 || h === 24 ? 'AM' : 'PM'}`; };

  const names = [...new Set([...stations, ...sessions.map((s) => s.station)])];

  return (
    <div className="lanes" onPointerLeave={() => setTip(null)}>
      <div className="lane lane-axis" aria-hidden="true">
        <div className="lane-label" />
        <div className="lane-track">
          {ticks.map((h) => (
            <span key={h} className="tick" style={{ left: `${((h - from) / span) * 100}%` }}>{tickLabel(h)}</span>
          ))}
        </div>
      </div>
      {names.map((name) => {
        const mine = sessions.filter((s) => s.station === name).sort((a, b) => a.start - b.start);
        const due = planned.filter((p) => p.station === name);
        const merged = union(mine);
        const hours = merged.reduce((a, [s, e]) => a + (e - s) / H, 0);
        const liveNow = mine.filter((s) => s.live).length;
        const short = isToday && liveNow > 0 && liveNow < pairSize;
        return (
          <div className="lane" key={name}>
            <div className="lane-label">
              <span className="lane-name">{name}</span>{robotName(name) && <span className="lane-meta">{robotName(name)}</span>}
              <span className="lane-meta">
                {mine.length === 0 ? (due.length ? 'No one checked in' : 'Idle') : `${fmtHrsU(hours)} worked`}
              </span>
              {short && <Tag tone="warn" icon={<TriangleAlert size={12} />}>{liveNow} of {pairSize} on site</Tag>}
            </div>
            <div className="lane-track" role="img" aria-label={`${robotTitle(name)}: ${mine.map((s) => `${s.name} ${fmtTime(s.start)} to ${s.live ? 'now' : fmtTime(s.end)}`).join(', ') || 'no one'}. ${fmtHrs(hours)} hours worked.${due.length ? ` Scheduled but not here: ${due.map((p) => `${p.name} ${fmtTime(p.startAt)} to ${fmtTime(p.endAt)}`).join(', ')}.` : ''}`}>
              {ticks.map((h) => <span key={h} className="gridline" style={{ left: `${((h - from) / span) * 100}%` }} />)}
              <div className="lane-people">
                {mine.map((s, i) => (
                  <div
                    key={`${s.email}-${i}`}
                    className="person-span"
                    data-live={s.live || undefined}
                    data-early={s.early || undefined}
                    data-short={(s.end - s.start) / H / span < 0.12 ? ((s.start - base) / H - from) / span > 0.8 ? 'end' : 'start' : undefined}
                    style={{ left: x(s.start), width: w(s.start, s.end), animationDelay: `${i * 60}ms` }}
                    onPointerEnter={(e) => setTip({ s, ...tipAt(e.currentTarget) })}
                  >
                    <span className="person-ini">{shortName(s.name)}</span>
                    <span className="person-line" />
                  </div>
                ))}
                {due.map((p) => (
                  <div
                    key={p.id}
                    className="person-span plan-span"
                    data-status={p.status}
                    style={{ left: x(p.startAt), width: w(p.startAt, p.endAt) }}
                    onPointerEnter={(e) => setTip({ plan: p, ...tipAt(e.currentTarget) })}
                  >
                    <span className="person-ini">{shortName(p.name)}</span>
                    <span className="person-line" />
                  </div>
                ))}
              </div>
              <div className="lane-union">
                {merged.map(([s, e]) => (
                  <span key={s} className="union-bar reveal-x" style={{ left: x(new Date(s)), width: w(s, e) }} />
                ))}
              </div>
              {isToday && now >= new Date(base.getTime() + from * H) && now <= new Date(base.getTime() + to * H) && (
                <span className="now-line" style={{ left: x(now) }} />
              )}
            </div>
          </div>
        );
      })}
      {tip?.plan && (
        <div className="lane-tip" data-below={tip.below || undefined} style={{ left: tip.left, top: tip.top }} role="tooltip">
          <strong>{tip.plan.name}</strong>
          <span>Due {fmtTime(tip.plan.startAt)} – {fmtTime(tip.plan.endAt)}</span>
          <span className="tip-early">{tip.plan.status === 'upcoming' ? 'Shift not started' : tip.plan.status === 'late' ? 'Not here yet' : 'No-show'}</span>
        </div>
      )}
      {tip?.s && (
        <div className="lane-tip" data-below={tip.below || undefined} style={{ left: tip.left, top: tip.top }} role="tooltip">
          <strong>{tip.s.name}</strong>
          <span>{fmtTime(tip.s.start)} – {tip.s.live ? 'now' : fmtTime(tip.s.end)} · {fmtHrsU(tip.s.hours)}</span>
          {tip.s.auto && <span className="tip-early">Auto clock-out</span>}
          {tip.s.early && <span className="tip-early">Left early{tip.s.note ? `: ${tip.s.note}` : ''}</span>}
        </div>
      )}
    </div>
  );
}
