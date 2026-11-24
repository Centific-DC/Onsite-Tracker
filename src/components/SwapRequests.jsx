import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { DEMO, locationName } from '../lib/config.js';
import { SWAP_CUTOFF_HOURS, hoursUntil, planSwap } from '../lib/swaps.js';
import { matchByName } from '../lib/importer.js';
import { shiftTimes } from '../lib/schedule.js';
import { fmtDay, fmtTime, fmtHrsU } from '../lib/time.js';
import { Group, Row, Select, Sheet, Tag } from './ui.jsx';

// Shift swap requests waiting for a scheduler (2026-11-23). Each one names the shift,
// who asked and who they say is taking it. The scheduler picks that operator, sees any
// problem, and makes the change (the shift moves to them) or declines it.
export function SwapRequests({ inLab = () => true }) {
  const { data, session } = useStore();
  const canAct = !!session?.roles?.some((r) => r === 'scheduler' || r === 'admin');
  const [open, setOpen] = useState(null);
  const list = (data.swaps || []).filter((x) => x.status === 'open' && inLab(x)).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  if (!list.length) return null;
  return (
    <>
      <Group title={`Swap requests · ${list.length} waiting`} footer={`Operators ask at least ${SWAP_CUTOFF_HOURS} hours ahead. Making the change moves the shift to the other operator; send them the updated schedule email.`} tour="sched-swaps">
        {list.map((x) => {
          const h = hoursUntil(x);
          return (
            <Row
              key={x.id}
              onClick={canAct ? () => setOpen(x) : undefined}
              title={<>{x.name} → {x.taker || 'someone'} {h < SWAP_CUTOFF_HOURS && <Tag tone={h < 0 ? 'bad' : 'warn'}>{h < 0 ? 'Shift started' : `Shift in ${fmtHrsU(Math.max(0, h))}`}</Tag>}</>}
              subtitle={`${fmtDay(new Date(`${x.date}T12:00`))} · ${locationName(x.location)} · ${x.start}–${x.end}${x.message ? ` · “${x.message}”` : ''}`}
            />
          );
        })}
      </Group>
      <ResolveSwap swap={open} onClose={() => setOpen(null)} />
    </>
  );
}

function ResolveSwap({ swap, onClose }) {
  const { data, resolveSwap } = useStore();
  const ops = useMemo(() => (data.operators || []).filter((o) => o.active !== false && (o.roles || ['operator']).includes('operator')), [data.operators]);
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [decline, setDecline] = useState(false);
  useEffect(() => {
    if (!swap) return;
    setWho(matchByName(swap.taker, ops.filter((o) => o.location === swap.location || !o.location))?.email || '');
    setNote('');
    setDecline(false);
  }, [swap]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!swap) return <Sheet open={false} onOpenChange={() => {}} title="" />;
  const taker = ops.find((o) => o.email === who);
  const plan = planSwap(swap, data.schedule, data.operators, taker);
  const shift = (data.schedule || []).find((r) => r.id === swap.shiftId);
  const t = shift ? shiftTimes(shift) : null;
  const choices = ops.filter((o) => o.email !== swap.email && (!o.location || o.location === swap.location)).sort((a, b) => a.name.localeCompare(b.name));
  const done = (label, body) => {
    resolveSwap({ id: swap.id, ...body }, label).then(
      () => toast.success(body.status === 'done' ? `Shift moved to ${taker.name}` : 'Swap declined', { description: DEMO ? 'Demo mode: no email was sent.' : `${swap.name} gets an email.` }),
      (e) => toast.error('The swap didn’t save', { description: e.message, duration: 15000 }),
    );
    onClose();
  };
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Swap: ${swap.name} → ${swap.taker || 'someone'}`}
      description={t ? `${fmtDay(t.start)} · ${locationName(swap.location)} · ${fmtTime(t.start)}–${fmtTime(t.end)}${swap.message ? ` · “${swap.message}”` : ''}` : 'That shift is no longer on the schedule.'}
      footer={decline
        ? <button type="button" className="btn btn-danger btn-block" disabled={!note.trim()} onClick={() => done('Declining the swap', { status: 'declined', note: note.trim() })}>Decline swap</button>
        : <button type="button" className="btn btn-primary btn-block" disabled={!!plan.problem} onClick={() => done('Moving the shift', { status: 'done', takerEmail: taker.email, shift: plan.next, linked: plan.linked, removed: plan.shift.id, note: note.trim() })}>Move the shift to {taker?.name || '…'}</button>}
    >
      <Group footer={decline ? undefined : plan.problem ? <span className="err" role="alert">{plan.problem}</span> : undefined}>
        {!decline && (
          <label className="field-row">
            <span>Taking it</span>
            <Select className="sel-field" label="Who is taking it" value={who} onChange={setWho} options={choices.map((o) => ({ value: o.email, label: o.name }))} placeholder="Pick an operator" />
          </label>
        )}
        <div className="pad"><textarea className="reason" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={decline ? 'Why not (required; they see this)' : 'Note (optional)'} aria-label={decline ? 'Reason for declining' : 'Note'} /></div>
      </Group>
      {!decline && plan.warnings?.length > 0 && (
        <Group title="Check before moving it" className="group-urgent">
          {plan.warnings.map((w) => <p key={w} className="warn-line" role="alert">{w}</p>)}
        </Group>
      )}
      <button type="button" className="link-quiet" onClick={() => setDecline(!decline)}>{decline ? 'Back to the swap' : 'Decline this swap instead'}</button>
    </Sheet>
  );
}
