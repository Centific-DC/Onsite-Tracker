import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { FileSpreadsheet, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { DEMO, SYNC_URL, locationName } from '../lib/config.js';
import { SYNC_CHECKS, SYNC_REASONS } from '../lib/sheetSync.js';
import { fmtDay, fmtTime, parseDay } from '../lib/time.js';
import { Group, Row, Sheet, StatusLine, Tag } from './ui.jsx';

const when = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return `${today ? 'today' : fmtDay(d)} ${fmtTime(d)}`;
};

// The Master List sync on the Schedule page: when it last ran, what it changed, the
// rows it couldn't book, and "Sync now" for schedulers. The flow runs by itself each
// morning at 5:30 AM (that run includes today); a Sync now later starts from tomorrow.
export function SheetSyncLine() {
  const { data, session, syncSchedule } = useStore();
  const s = data.scheduleSync;
  const canRun = (DEMO || !!SYNC_URL) && (session?.roles || []).some((r) => r === 'scheduler' || r === 'admin');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const t0 = useRef(0);
  useEffect(() => {
    if (!busy) return undefined;
    t0.current = performance.now();
    setSecs(0);
    const id = setInterval(() => setSecs(Math.floor((performance.now() - t0.current) / 1000)), 250);
    return () => clearInterval(id);
  }, [busy]);
  if (!s && !canRun) return null;

  const attention = s ? s.skipped.length : 0;
  const parts = s ? [
    s.added && `${s.added} added`,
    s.changed && `${s.changed} changed`,
    s.removed && `${s.removed} removed`,
    !s.added && !s.changed && !s.removed && 'no changes',
  ].filter(Boolean) : [];
  const last = !s?.at ? 'Not synced yet'
    : s.error ? `Last sync failed ${when(s.at)}`
    : `Last sync ${when(s.at)} · ${parts.join(' · ')}`;
  // A run under way, or a Sync now waiting for the flow's next check. A request older
  // than the last finished run has been done.
  const queued = s?.requestedAt && !s.runningSince && (!s.at || s.requestedAt > s.at);
  const summary = s?.runningSince ? `${last} · running since ${fmtTime(new Date(s.runningSince))}`
    : queued ? `${last} · Sync queued, runs at the next check (${SYNC_CHECKS})`
    : last;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await syncSchedule();
      if (!out) toast('Sync queued', { description: `It runs at the next check (${SYNC_CHECKS}); after 7 PM, at 5:30 AM. The new counts show on the next refresh.` });
      else if (out.error) toast.error('The Master List sync failed', { description: out.error });
      else toast.success('Synced from the Master List', { description: `${out.added} added · ${out.changed} changed · ${out.removed} removed${out.skipped.length ? ` · ${out.skipped.length} to check` : ''}` });
    } catch (e) {
      toast.error('Couldn’t start the sync', { description: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={clsx('sheet-sync', s?.error && 'is-bad')} data-tour="sched-sync">
      <span className="sheet-sync-icon" aria-hidden="true"><FileSpreadsheet size={16} /></span>
      <span className="sheet-sync-text" role="status" aria-live="polite">
        <strong>Master List{DEMO ? ' (demo)' : ''}</strong>
        <StatusLine text={summary} title={s?.error || (s?.from ? `Days from ${fmtDay(parseDay(s.from))} on follow the sheet. Earlier days are only changed here in Lotus.` : '')} />
      </span>
      {s && (attention > 0 || s.kept.length > 0 || s.held > 0) && (
        <button type="button" className="link" onClick={() => setOpen(true)}>
          {attention > 0 ? `${attention} to check` : 'Details'}
        </button>
      )}
      {canRun && (
        <button type="button" className={clsx('sync', (busy || s?.runningSince) && 'is-busy')} onClick={run} aria-busy={busy} disabled={!!s?.runningSince || queued} title={s?.runningSince ? 'A sync is running' : queued ? 'Already queued' : `Queues a sync for the next check (${SYNC_CHECKS})`}>
          <span className="sync-icon" aria-hidden="true">
            <RefreshCw size={16} className="sync-glyph" />
            <span className="dots"><i /><i /><i /><i /></span>
          </span>
          <span className="sync-text">{busy ? `Asking ${secs}s` : s?.runningSince ? 'Syncing' : queued ? 'Queued' : 'Sync now'}</span>
        </button>
      )}
      <SyncDetails open={open} onOpenChange={setOpen} s={s} />
    </div>
  );
}

function SyncDetails({ open, onOpenChange, s }) {
  if (!s) return null;
  const item = (r, i) => (
    <Row
      key={`${r.date}-${r.lab}-${r.shift}-${r.name}-${i}`}
      title={<>{r.name || 'No name'} <Tag tone="muted">{SYNC_REASONS[r.reason] || r.reason}</Tag></>}
      subtitle={`${r.date ? fmtDay(parseDay(r.date)) : ''} · ${locationName(r.lab)} · ${r.shift}`}
    />
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Master List sync"
      description={`${s.at ? `Last run ${when(s.at)}` : 'No run has finished yet'}.${s.from ? ` Days from ${fmtDay(parseDay(s.from))} on follow the sheet;` : ''} Shifts added or changed here in Lotus stay as they are.`}
    >
      {s.held > 0 && (
        <Group title="Removals held back" className="group-urgent">
          <p className="hint">{s.held} shifts are gone from the sheet at once, which usually means a renamed column or table. The sync removed none of them. Check the sheet, then sync again.</p>
        </Group>
      )}
      {s.skipped.length > 0 && (
        <Group title="Not booked" footer="Fix these in the sheet (or add the person on Roster), then sync again.">
          {s.skipped.map(item)}
        </Group>
      )}
      {s.kept.length > 0 && (
        <Group title="Lotus’s version kept">
          {s.kept.map(item)}
        </Group>
      )}
    </Sheet>
  );
}
