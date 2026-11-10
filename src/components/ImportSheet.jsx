import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { locationName } from '../lib/config.js';
import { planRosterImport, planScheduleImport } from '../lib/importer.js';
import { pickSheet, readXlsx } from '../lib/xlsx.js';
import { robotTitle } from '../lib/robots.js';
import { dayKey, fmtDay, fmtTime, parseDay } from '../lib/time.js';
import { shiftTimes } from '../lib/schedule.js';
import { Group, Row, Segmented, Sheet } from './ui.jsx';

const USER_BATCH = 5;
const SHIFT_BATCH = 25;

// Imports Active Roster 2 (Roster) and the Schedulers' schedule (Roster and Schedule).
// A CSV or an Excel file: from an .xlsx the "Schedule" sheet is read (or the first
// sheet), so the template's Example and Instructions sheets never import. Nothing is
// saved until the preview is confirmed.
export function ImportSheet({ open, onOpenChange, kinds = ['roster', 'schedule'] }) {
  const { data, upsertUsers, importShifts, background } = useStore();
  const [kind, setKind] = useState(kinds[0]);
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(null); // { file, name, rows } from an .xlsx
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setText(''); setSheet(null); setErr(''); setKind(kinds[0]); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const input = sheet ? sheet.rows : text;
  const plan = useMemo(() => {
    if (sheet ? !sheet.rows.length : !text.trim()) return null;
    return kind === 'roster' ? planRosterImport(text, data.operators, dayKey(new Date())) : planScheduleImport(input, data.operators, data.schedule, dayKey(new Date()));
  }, [input, text, sheet, kind, data.operators, data.schedule]);
  const file = async (e) => {
    const f = e.target.files?.[0];
    setErr('');
    if (!f) return;
    if (/\.xlsx$/i.test(f.name)) {
      if (kind === 'roster') { setErr('Export Active Roster 2 as CSV first.'); return; }
      try {
        const s = pickSheet(await readXlsx(await f.arrayBuffer()), 'Schedule');
        setText('');
        setSheet({ file: f.name, name: s.name, rows: s.rows });
      } catch (x) { setSheet(null); setErr(x.message || 'This file can’t be read.'); }
    } else { setSheet(null); setText(await f.text()); }
  };
  // The sheet closes at once; the import runs in the background in small batches
  // (each Write call stays well under the flow's two-minute limit), with the count
  // in the header, and a toast says how far it got if it stops.
  const save = () => {
    const rows = kind === 'roster' ? [...plan.add, ...plan.update].map(({ changed, ...o }) => o) : [...plan.add, ...plan.update]; // eslint-disable-line no-unused-vars
    const size = kind === 'roster' ? USER_BATCH : SHIFT_BATCH;
    const what = kind;
    const counts = { add: plan.add.length, update: plan.update.length, skip: plan.skip.length };
    let saved = 0;
    background(`Importing ${rows.length} ${what === 'roster' ? 'operators' : 'shifts'}`, async (note) => {
      for (let i = 0; i < rows.length; i += size) {
        const part = rows.slice(i, i + size);
        if (what === 'roster') await upsertUsers(part);
        else await importShifts(part);
        saved += part.length;
        note(`${saved} of ${rows.length}`);
      }
    }).then(
      () => toast.success(`Imported ${counts.add} new, ${counts.update} updated`, { description: counts.skip ? `${counts.skip} rows skipped` : undefined }),
      (e) => toast.error("Import didn't finish", { description: `${saved} of ${rows.length} saved. ${e.message} Import the same file again to finish: saved rows show as up to date.`, duration: 20000 }),
    );
    onOpenChange(false);
  };
  const label = (x) => (kind === 'roster' ? `${x.name} · ${x.email}${x.changed ? ` · ${x.changed.join(', ')}` : ''}` : `${fmtDay(parseDay(x.date))} · ${x.name} · ${locationName(x.location)} · ${fmtTime(shiftTimes(x).start)}–${fmtTime(shiftTimes(x).end)}`);
  const sub = (x) => (kind === 'roster' ? `${x.id} · ${locationName(x.location) || 'No lab'}` : [robotTitle(x.station) || 'Any robot', x.template || 'Custom time', x.pair && 'Paired'].filter(Boolean).join(' · '));
  const count = plan ? plan.add.length + plan.update.length : 0;
  const scheduleOnly = kinds.length === 1 && kinds[0] === 'schedule';
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={scheduleOnly ? 'Import schedule' : 'Import from recruiting'}
      description={scheduleOnly ? 'Upload the Schedulers’ Excel template (or a CSV). Nothing is saved until you confirm.' : 'Export the sheet as CSV, then upload or paste it. Columns are matched by their headers. Nothing is saved until you confirm.'}
      footer={<button type="button" className="btn btn-primary btn-block" disabled={!plan || plan.add.length + plan.update.length === 0} onClick={save}>{plan ? `Import ${count} ${kind === 'roster' ? 'rows' : count === 1 ? 'shift' : 'shifts'}` : 'Import'}</button>}
    >
      {kinds.length > 1 && (
        <div className="pad">
          <Segmented label="What to import" value={kind} onChange={(v) => { setKind(v); setSheet(null); setErr(''); }} options={[{ value: 'roster', label: 'Active Roster 2' }, { value: 'schedule', label: 'Schedule' }].filter((o) => kinds.includes(o.value))} />
        </div>
      )}
      <Group footer={kind === 'roster' ? 'Uses Name, Email, Cohort, Sessions completed, Training status and Location. New operators get the next ID.' : 'Uses Date, Lab, Shift (Morning, Afternoon, Night, or Start and End), Operator or Email, Robot (blank is Any robot) and Pair (rows with the same date, shift and Pair letter are booked together). Re-importing updates what changed.'}>
        <label className="field-row"><span>File</span><input type="file" accept={kind === 'roster' ? '.csv,text/csv,text/plain' : '.xlsx,.csv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'} onChange={file} /></label>
        {sheet
          ? <div className="empty-row">Reading the “{sheet.name}” sheet of {sheet.file}.</div>
          : <textarea className="reason mono" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or paste CSV here" aria-label="CSV to import" />}
        {err && <div className="empty-row" role="alert">{err}</div>}
      </Group>
      {plan && (
        <>
          <Group title={`New (${plan.add.length})`}>{plan.add.slice(0, 50).map((x, i) => <Row key={i} title={label(x)} subtitle={sub(x)} />)}{plan.add.length > 50 && <div className="empty-row">and {plan.add.length - 50} more</div>}{!plan.add.length && <div className="empty-row">None</div>}</Group>
          <Group title={`Updated (${plan.update.length})`}>{plan.update.slice(0, 50).map((x, i) => <Row key={i} title={label(x)} subtitle={kind === 'roster' ? undefined : sub(x)} />)}{plan.update.length > 50 && <div className="empty-row">and {plan.update.length - 50} more</div>}{!plan.update.length && <div className="empty-row">None</div>}</Group>
          {plan.warn?.length > 0 && <Group title={`Check (${plan.warn.length})`} footer="These import anyway.">{plan.warn.slice(0, 50).map((x, i) => <Row key={i} title={`Line ${x.line} · ${x.name}`} subtitle={x.reason} />)}</Group>}
          <Group title={`Skipped (${plan.skip.length})`}>{plan.skip.slice(0, 100).map((x, i) => <Row key={i} title={`Line ${x.line} · ${x.name || 'blank'}`} subtitle={x.reason} />)}{!plan.skip.length && <div className="empty-row">None</div>}</Group>
        </>
      )}
    </Sheet>
  );
}
