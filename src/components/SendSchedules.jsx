import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Check, ChevronLeft } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { DEMO } from '../lib/config.js';
import { dayKey, weekLabel } from '../lib/time.js';
import { buildEmail, fillFields, fillSubject, tintedLogo } from '../lib/email/render.js';
import { LIGHT } from '../lib/email/palette.js';
import logoPng from '../assets/centific-logo.png';
import { LOGO_URL, useTemplates } from '../lib/email/useTemplates.js';
import { scheduleValues, snapshotOf, summaryLine, templateFor } from '../lib/email/notices.js';
import { Avatar, Group, Segmented, Sheet, Tag } from './ui.jsx';

// Email each operator their own shifts for a week. "Changed" means the shifts
// moved after their last email; those get the Schedule change template with
// the changes marked. The flow checks every recipient and records a notice.

const sentWhen = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const MAX_SHOWN = 5;

export function messageFor(entry, wk0, templates, mode = 'light', logo = LOGO_URL) {
  const tid = templateFor(entry);
  const content = templates.get(tid);
  const values = scheduleValues(entry, wk0);
  return {
    kind: tid,
    subject: fillSubject(content.subject, values),
    html: buildEmail(fillFields(content.html, values), mode, logo),
  };
}

export function SendSchedules({ open, onOpenChange, wk0, entries, testMode }) {
  const sendEmails = useStore((s) => s.sendEmails);
  const templates = useTemplates();
  const [scope, setScope] = useState('todo');
  const [picked, setPicked] = useState(() => new Set());
  const [more, setMore] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState(null);
  useEffect(() => { tintedLogo(logoPng, LIGHT.logo).then(setLogo); }, []);

  const groups = useMemo(() => [
    { id: 'changed', title: 'Changed since their last email', tag: ['warn', 'Changed'], rows: entries.filter((e) => e.status === 'changed') },
    { id: 'unsent', title: 'Not sent yet', tag: ['bad', 'Not sent'], rows: entries.filter((e) => e.status === 'unsent') },
    { id: 'current', title: 'Up to date', tag: ['on', 'Sent'], rows: entries.filter((e) => e.status === 'current') },
  ], [entries]);
  const todo = entries.filter((e) => e.status !== 'current');

  // Opening the sheet ticks everyone who needs an email.
  useEffect(() => {
    if (!open) return;
    setPicked(new Set(todo.map((e) => e.op.email)));
    setScope('todo');
    setPreview(null);
    setMore({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (email) => setPicked((p) => { const n = new Set(p); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  const chosen = entries.filter((e) => picked.has(e.op.email));

  const send = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      const messages = chosen.map((e) => ({ to: e.op.email, operatorId: e.op.id, name: e.op.name, snapshot: snapshotOf(e.shifts), ...messageFor(e, wk0, templates) }));
      for (let i = 0; i < messages.length; i += 25) {
        await sendEmails({ kind: 'schedule', weekStart: dayKey(wk0), messages: messages.slice(i, i + 25) });
      }
      const n = messages.length;
      toast.success(`${n} schedule ${n === 1 ? 'email' : 'emails'} ${DEMO ? 'marked as sent' : 'sent'}`, {
        description: DEMO ? 'Demo mode: no email leaves this browser.' : testMode ? 'Test mode: they went to project_lotus@centific.com.' : `Week of ${weekLabel(wk0)}.`,
      });
      onOpenChange(false);
    } catch (e) {
      toast.error('Couldn’t send the emails', { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  const shownGroups = groups.filter((g) => g.rows.length && (scope === 'all' || g.id !== 'current'));
  const last = groups[2].rows.map((e) => e.last).sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0];

  const msg = preview ? messageFor(preview, wk0, templates, 'light', logo) : null;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      className={clsx('send-sheet', preview && 'send-sheet-wide')}
      title={preview ? preview.op.name : 'Email schedules'}
      description={preview
        ? `${preview.status === 'changed' ? 'Schedule change' : 'Weekly schedule'} · to ${testMode ? 'project_lotus@centific.com (test mode)' : preview.op.email}`
        : `Week of ${weekLabel(wk0)} · from project_lotus@centific.com`}
      footer={preview ? (
        <div className="send-foot">
          <button type="button" className="btn btn-plain btn-sm" onClick={() => setPreview(null)}><ChevronLeft size={16} /> Back</button>
          <p />
          <button type="button" className={clsx('btn btn-sm', picked.has(preview.op.email) ? 'btn-plain' : 'btn-primary')} onClick={() => toggle(preview.op.email)}>
            {picked.has(preview.op.email) ? 'Leave out of this send' : 'Include in this send'}
          </button>
        </div>
      ) : (
        <div className="send-foot">
          <p>
            One email per operator, listing only their own shifts.
            {DEMO ? ' Demo mode: nothing is sent.' : testMode ? ' Test mode is on, so every email goes to project_lotus@centific.com until the team switches it off.' : ''}
          </p>
          <button type="button" className="btn btn-primary" disabled={!chosen.length || busy} aria-busy={busy || undefined} onClick={send}>
            {busy ? 'Sending…' : `Send ${chosen.length} ${chosen.length === 1 ? 'email' : 'emails'}`}
          </button>
        </div>
      )}
    >
      {preview ? (
        <div key="preview" className="em-pane">
          <p className="send-subject"><strong>Subject</strong> {msg.subject}</p>
          <div className="send-email"><div className="em-email" dangerouslySetInnerHTML={{ __html: msg.html }} /></div>
        </div>
      ) : (
      <div key="list" className="em-pane">
      <div className="toolbar">
        <Segmented label="Show" value={scope} onChange={setScope} options={[{ value: 'todo', label: `Not sent and changed (${todo.length})` }, { value: 'all', label: `Everyone (${entries.length})` }]} />
      </div>
      {!entries.length && <p className="empty-row">No operators are booked this week.</p>}
      {entries.length > 0 && !todo.length && scope === 'todo' && (
        <Group>
          <div className="send-more"><span>Everyone has this week’s schedule{last ? `, last emailed ${sentWhen(last.sentAt)}` : ''}.</span></div>
        </Group>
      )}
      {shownGroups.map((g) => {
        const rows = more[g.id] ? g.rows : g.rows.slice(0, MAX_SHOWN);
        return (
          <Group key={g.id} title={`${g.title} · ${g.rows.length}`}>
            {rows.map((e) => {
              const on = picked.has(e.op.email);
              return (
                <div key={e.op.email} className="send-row">
                  <button type="button" role="checkbox" aria-checked={on} aria-label={`Email ${e.op.name}`} className="send-check" onClick={() => toggle(e.op.email)}><Check size={14} strokeWidth={3} /></button>
                  <Avatar name={e.op.name} />
                  <span className="send-main">
                    <span className="send-name">{e.op.name} <Tag tone={g.tag[0]}>{g.tag[1]}</Tag></span>
                    <span className="send-sub">{g.id === 'current' && e.last ? `Emailed ${sentWhen(e.last.sentAt)} · ${summaryLine(e)}` : summaryLine(e)}</span>
                  </span>
                  <button type="button" className="send-preview" onClick={() => setPreview(e)}>Preview</button>
                </div>
              );
            })}
            {g.rows.length > MAX_SHOWN && (
              <button type="button" className="send-more" onClick={() => setMore((m) => ({ ...m, [g.id]: !m[g.id] }))}>
                <span>{more[g.id] ? 'Show fewer' : `${g.rows.length - MAX_SHOWN} more`}</span><span>{more[g.id] ? 'Hide' : 'Show'}</span>
              </button>
            )}
          </Group>
        );
      })}
      </div>
      )}
    </Sheet>
  );
}
