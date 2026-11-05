import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { Copy, Moon, PencilLine, Sun } from 'lucide-react';
import { useStore } from '../lib/store.js';
import { DEMO } from '../lib/config.js';
import { FIELD_LABEL, isBlockField } from '../lib/email/blocks.js';
import { DARK, LIGHT } from '../lib/email/palette.js';
import { AUDIENCE_LABEL, TEMPLATES, TEMPLATE_FIELDS } from '../lib/email/templates.js';
import { buildEmail, copyRich, fillFields, fillSubject, sanitize, tintedLogo, toPlainText } from '../lib/email/render.js';
import { useTemplates } from '../lib/email/useTemplates.js';
import { noticeStatus, scheduleValues } from '../lib/email/notices.js';
import { reviewDays } from '../lib/review.js';
import { addDays, firstName, mondayOf, weekLabel } from '../lib/time.js';
import { Segmented, Select } from '../components/ui.jsx';
import TemplateEditor from '../components/email/TemplateEditor.jsx';
import logoPng from '../assets/centific-logo.png';

// Email templates, in the Project Atlas format. Schedulers and approvers see
// each email as it will arrive, filled in for a real person; schedulers can
// edit every template.

const when = (iso) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Sample values for the preview: a real operator's coming week, or last week's review for approvers. */
function useSamples(data, session, testMode) {
  return useMemo(() => {
    const wk1 = addDays(mondayOf(new Date()), 7);
    const entries = data ? noticeStatus(data, wk1, testMode) : [];
    const people = entries.map((e) => ({ id: e.op.email, label: `${e.op.name} · ${weekLabel(wk1)}`, entry: e }));
    const changed = entries.filter((e) => e.status === 'changed');
    const last = addDays(mondayOf(new Date()), -7);
    const open = data ? reviewDays(data, last, addDays(last, 7)).filter((d) => d.status !== 'approved').length : 0;
    return {
      wk1,
      people,
      changedPeople: changed.map((e) => ({ id: e.op.email, label: `${e.op.name} · ${weekLabel(wk1)}`, entry: e })),
      approver: { approverFirstName: firstName(session?.name || 'there'), reviewWeek: weekLabel(last), openDays: `${open} operator-days` },
    };
  }, [data, session, testMode]);
}

export function Emails() {
  const data = useStore((s) => s.data);
  const session = useStore((s) => s.session);
  const canEdit = !!session?.roles?.includes('scheduler');
  const testMode = data?.emailTestMode !== false;
  const store = useTemplates();
  const samples = useSamples(data, session, testMode);

  const [selected, setSelected] = useState(TEMPLATES[0].id);
  const [mode, setMode] = useState('light');
  const [personId, setPersonId] = useState('');
  const [draft, setDraft] = useState(null);
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [logos, setLogos] = useState({ light: null, dark: null });
  const subjectRef = useRef(null);

  const meta = TEMPLATES.find((t) => t.id === selected);
  const content = store.get(meta.id);
  const editing = draft !== null;

  useEffect(() => {
    let live = true;
    Promise.all([tintedLogo(logoPng, LIGHT.logo), tintedLogo(logoPng, DARK.logo)]).then(([light, dark]) => { if (live) setLogos({ light, dark }); });
    return () => { live = false; };
  }, []);

  const options = meta.id === 'operator-schedule-update' && samples.changedPeople.length ? samples.changedPeople : samples.people;
  const person = options.find((p) => p.id === personId) || options[0] || null;
  const values = useMemo(() => {
    if (meta.audience === 'approver') return samples.approver;
    if (!person) return {};
    return scheduleValues(person.entry, samples.wk1);
  }, [meta.audience, person, samples]);

  const subject = fillSubject(content.subject, values);
  const email = useMemo(() => buildEmail(fillFields(content.html, values), mode, logos[mode]), [content.html, values, mode, logos]);

  const pick = (id) => {
    if (editing || id === selected) return;
    setSelected(id);
    setPersonId('');
  };

  const copyEmail = async () => {
    try {
      await copyRich(email, toPlainText(email));
      toast.success('Email copied. Paste it into Outlook.');
    } catch {
      toast.error('Couldn’t copy. Select the email and copy it by hand.');
    }
  };

  const startEdit = () => {
    setDraft({ subject: content.subject, html: content.html });
    setMode('light');
    setEditorKey((k) => k + 1);
  };
  const onBody = useCallback((html) => setDraft((d) => (d ? { ...d, html } : d)), []);

  const save = async () => {
    if (!draft) return;
    if (!draft.subject.trim()) { toast.error('Add a subject line.'); return; }
    setBusy(true);
    try {
      await store.save(meta.id, draft);
      setDraft(null);
      toast.success(`${meta.name} saved`, { description: DEMO ? 'Demo mode: saved in this browser only.' : 'Everyone sending this email now uses the new version.' });
    } catch (e) {
      toast.error('Couldn’t save the template', { description: e.message || 'The images may be too large; try smaller ones.' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    const kept = draft;
    setDraft(null);
    if (kept && (kept.subject !== content.subject || sanitize(kept.html) !== content.html)) {
      toast('Changes discarded', { action: { label: 'Undo', onClick: () => { setDraft(kept); setEditorKey((k) => k + 1); } } });
    }
  };

  const reset = async () => {
    const before = store.get(meta.id);
    try {
      await store.reset(meta.id);
      setDraft(null);
      toast(`${meta.name} is back to the original`, { action: { label: 'Undo', onClick: () => store.save(meta.id, before) } });
    } catch (e) {
      toast.error('Couldn’t reset the template', { description: e.message });
    }
  };

  const fields = TEMPLATE_FIELDS[meta.id];
  const addSubjectField = (id) => {
    if (!id || !draft) return;
    const input = subjectRef.current;
    const token = `{${id}}`;
    const at = input?.selectionStart ?? draft.subject.length;
    const end = input?.selectionEnd ?? at;
    setDraft({ ...draft, subject: draft.subject.slice(0, at) + token + draft.subject.slice(end) });
    requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(at + token.length, at + token.length); });
  };

  const groups = ['operator', 'approver'].map((a) => ({ audience: a, items: TEMPLATES.filter((t) => t.audience === a) }));

  return (
    <div className="view view-enter view-wide">
      <header className="page-head">
        <div>
          <h1 className="large-title">Emails</h1>
          <p className="lede">
            {testMode ? 'Test mode: every email goes to project_lotus@centific.com until the team switches it off.' : 'Sent from project_lotus@centific.com.'}
            {canEdit ? ' Schedulers can edit every template.' : ''}
          </p>
        </div>
      </header>

      <div className="em-layout">
        <nav className="em-list" aria-label="Templates">
          {groups.map((g) => (
            <div key={g.audience} className="em-group">
              <h2 className="group-title em-group-title">{AUDIENCE_LABEL[g.audience]}</h2>
              {g.items.map((t, i) => {
                const c = store.get(t.id);
                const on = t.id === meta.id;
                return (
                  <button key={t.id} type="button" className={clsx('em-item row-in', on && 'is-active')} style={{ animationDelay: `${i * 35}ms` }} aria-current={on ? 'true' : undefined} disabled={editing && !on} onClick={() => pick(t.id)}>
                    <span className="em-item-name">{t.name}</span>
                    <span className="em-item-when">{t.when}</span>
                    <span className="em-item-meta">{store.isEdited(t.id) && c.updatedAt ? `Edited ${when(c.updatedAt)}${c.updatedBy ? ` by ${c.updatedBy}` : ''}` : 'Original'}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <section className="em-work" aria-label={meta.name}>
          {!editing ? (
            <div key={meta.id} className="em-pane">
              <div className="em-bar">
                {meta.audience === 'operator' ? (
                  <div className="em-fill">
                    <span className="em-eyebrow">Preview for</span>
                    <Select className="sel-input" label="Preview for" align="start" value={person?.id || ''} onChange={setPersonId} placeholder="No operators booked next week" options={options.map((p) => ({ value: p.id, label: p.label }))} />
                  </div>
                ) : (
                  <p className="em-note">The scheduled flow sends this to each approver on Monday at 8:00 AM, with last week’s numbers.</p>
                )}
                <div className="em-tools">
                  <Segmented
                    label="Preview mode"
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'light', icon: <Sun size={16} aria-hidden="true" />, aria: 'Light mode preview' },
                      { value: 'dark', icon: <Moon size={16} aria-hidden="true" />, aria: 'Dark mode preview' },
                    ]}
                  />
                  <button type="button" className="btn btn-plain btn-sm" onClick={copyEmail} aria-label="Copy email"><Copy size={15} aria-hidden="true" /><span>Copy<span className="em-long"> email</span></span></button>
                  {canEdit && <button type="button" className="btn btn-primary btn-sm" onClick={startEdit} aria-label="Edit template" data-tour="emails-edit"><PencilLine size={15} aria-hidden="true" /><span>Edit<span className="em-long"> template</span></span></button>}
                </div>
              </div>

              <div className="em-subject">
                <span className="em-eyebrow">Subject</span>
                <span className="em-subject-text">{subject}</span>
              </div>

              <div className={clsx('em-canvas em-well', `is-${mode}`)}>
                <div className="em-email" dangerouslySetInnerHTML={{ __html: email }} />
              </div>

            </div>
          ) : (
            <div className="em-pane">
              <div className="em-actions">
                {store.isEdited(meta.id) && <button type="button" className="em-reset" onClick={reset}>Reset to original</button>}
                <button type="button" className="btn btn-plain btn-sm" onClick={cancel}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy} aria-busy={busy || undefined}>Save template</button>
              </div>
              <div className="em-subject-edit">
                <label className="em-subject-field">
                  <span className="em-eyebrow">Subject</span>
                  <input ref={subjectRef} className="em-input" value={draft.subject} maxLength={160} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </label>
                <div className="em-subject-add">
                  <span className="em-eyebrow">Add field</span>
                  <Select className="sel-input" label="Add field to subject" align="start" value="" onChange={addSubjectField} placeholder="Choose…" options={fields.filter((id) => !isBlockField(id)).map((id) => ({ value: id, label: FIELD_LABEL[id] }))} />
                </div>
              </div>

              <TemplateEditor key={`${meta.id}-${editorKey}`} initialHtml={draft.html} onChange={onBody} fields={fields} />

            </div>
          )}
        </section>
      </div>
    </div>
  );
}
