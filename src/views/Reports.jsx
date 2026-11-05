import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { APPROVED_COLUMNS, approvedRows, reviewDays } from '../lib/review.js';
import { download } from '../lib/csv.js';
import { addDays, dayKey, mondayOf, parseDay, fmtHrsU, fmtDay } from '../lib/time.js';
import { Group, Row, Segmented, Tag } from '../components/ui.jsx';

const firstOfMonth = (d, n = 0) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// Approved hours by operator and day, in the fixed format the agency-reporting
// sheet imports. Raw clock-ins are on Records and never mixed in here.
export function Reports() {
  const { data } = useStore();
  const now = new Date();
  const ranges = {
    lastweek: [addDays(mondayOf(now), -7), mondayOf(now)],
    month: [firstOfMonth(now), addDays(now, 1)],
    lastmonth: [firstOfMonth(now, -1), firstOfMonth(now)],
  };
  const [preset, setPreset] = useState('lastweek');
  const [custom, setCustom] = useState({ from: dayKey(ranges.lastweek[0]), to: dayKey(addDays(ranges.lastweek[1], -1)) });
  const [from, to] = preset === 'custom' ? [parseDay(custom.from), addDays(parseDay(custom.to), 1)] : ranges[preset];
  const rows = useMemo(() => approvedRows(data, from, to, now), [data, dayKey(from), dayKey(to)]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = useMemo(() => reviewDays(data, from, to, now).filter((d) => d.status === 'needs_review' || d.status === 'ready'), [data, dayKey(from), dayKey(to)]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((a, r) => a + Number(r.approved_hours), 0);
  const byOp = [...rows.reduce((m, r) => m.set(r.operator_id || r.operator_email, { name: r.operator_name, id: r.operator_id, days: (m.get(r.operator_id || r.operator_email)?.days || 0) + 1, hours: (m.get(r.operator_id || r.operator_email)?.hours || 0) + Number(r.approved_hours) }), new Map()).values()].sort((a, b) => a.name.localeCompare(b.name));
  const exportCsv = () => download(`lotus-approved-hours_${dayKey(from)}_${dayKey(addDays(to, -1))}.csv`, [APPROVED_COLUMNS, ...rows.map((r) => APPROVED_COLUMNS.map((c) => r[c]))]);

  return (
    <div className="view view-enter">
      <header className="page-head">
        <div>
          <h1 className="large-title">Reports</h1>
          <p className="lede">Approved hours only, {fmtDay(from)} – {fmtDay(addDays(to, -1))}</p>
        </div>
      </header>
      <div className="toolbar">
        <Segmented label="Range" value={preset} onChange={setPreset} options={[{ value: 'lastweek', label: 'Last week' }, { value: 'month', label: 'This month' }, { value: 'lastmonth', label: 'Last month' }, { value: 'custom', label: 'Custom' }]} />
      </div>
      {preset === 'custom' && (
        <Group>
          <label className="field-row"><span>From</span><input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></label>
          <label className="field-row"><span>To</span><input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></label>
        </Group>
      )}
      <Group tour="reports-export" title="Approved hours export" footer="One row per operator per day, with stable operator IDs and fixed column names for the agency-reporting sheet. No rates or pay.">
        <Row title="Approved" subtitle={`${rows.length} operator-days · ${byOp.length} operators`} trailing={<span className="mono-num">{fmtHrsU(total)}</span>} />
        {pending.length > 0 && <Row title={<>Not approved yet <Tag tone="warn">{pending.length} days</Tag></>} subtitle="Left out of the export until a manager approves them on Review" />}
        <Row leading={<span className="row-icon"><Download size={18} /></span>} title="Download approved hours" subtitle={APPROVED_COLUMNS.join(', ')} trailing="CSV" onClick={exportCsv} />
      </Group>
      <Group title="By operator">
        {byOp.map((o) => <Row key={o.id || o.name} title={o.name} subtitle={`${o.id || 'No ID'} · ${o.days} ${o.days === 1 ? 'day' : 'days'}`} trailing={<span className="mono-num">{fmtHrsU(o.hours)}</span>} />)}
        {!byOp.length && <div className="empty-row">No approved hours in this range.</div>}
      </Group>
    </div>
  );
}
