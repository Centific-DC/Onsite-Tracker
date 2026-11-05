// Acceptance tests for the Lotus workflows (docs: the plan's Acceptance tests table).
// Times are Pacific (npm test sets TZ), the labs' local time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCATIONS } from '../src/lib/config.js';
import { clockInCheck } from '../src/lib/attendance.js';
import { buildSessions, delivered } from '../src/lib/hours.js';
import { APPROVED_COLUMNS, approvedRows, reviewDays } from '../src/lib/review.js';
import { checkNewShift, conflicts, pairingRisks, weeklyLoad } from '../src/lib/rules.js';
import { planRosterImport, planScheduleImport } from '../src/lib/importer.js';
import { demo, setDemoActor } from '../src/lib/api.js';
import { parseDay } from '../src/lib/time.js';

const DAY = '2026-11-02'; // a Monday
const MON = parseDay(DAY);
const NEXT_MON = parseDay('2026-11-09');
const at = (hm, day = DAY) => { const d = parseDay(day); const [h, m] = hm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const AFTER = at('23:59', '2026-11-03');

const op = (name, done = 10, location = 'RED') => ({ id: `OP-${name.length}${done}`, name, email: `${name.toLowerCase().replace(/ /g, '.')}@example.com`, location, completedSessions: done, completedAsOf: '2026-11-01', roles: ['operator'] });
const shift = (who, start, end, station = 'Robot 1', day = DAY, extra = {}) => ({ id: `S-${who.email}-${day}-${start}`, date: day, name: who.name, email: who.email, operatorId: who.id, location: LOCATIONS.find((l) => l.robots.includes(station)).id, station, start, end, template: '', note: '', ...extra });
let n = 0;
const punch = (who, type, t, s = null, extra = {}) => ({ id: `P${++n}`, ts: t.toISOString(), name: who.name, email: who.email, operatorId: who.id, type, station: s?.station || 'Robot 1', location: s?.location || 'RED', shiftId: s?.id || '', grace: 0, flag: '', note: '', ...extra });
const data = (over = {}) => ({ operators: [], punches: [], schedule: [], resolutions: [], approvals: [], client: [], audit: [], ...over });
const dayOf = (d, who) => reviewDays(d, MON, parseDay('2026-11-04'), AFTER).find((x) => x.email === who.email && x.day === DAY);

const avery = op('Avery Lin');
const jordan = op('Jordan Pike');
const morgan = op('Morgan Diaz');

describe('configuration', () => {
  it('has Redmond with two robots and three overlapping shifts, and Mountain View with one robot', () => {
    const red = LOCATIONS.find((l) => l.id === 'RED');
    const mtv = LOCATIONS.find((l) => l.id === 'MTV');
    expect(red.robots).toEqual(['Robot 1', 'Robot 2']);
    expect(red.templates.map((t) => `${t.start}-${t.end}`)).toEqual(['07:00-12:30', '12:00-17:30', '17:00-23:00']);
    expect(mtv.robots).toEqual(['Robot 3']);
  });
});

describe('operator clock-in', () => {
  const s = shift(avery, '07:00', '12:30');

  it('2. is blocked 20 minutes before a 7:00 shift with a 10-minute grace', () => {
    const c = clockInCheck(s, at('06:40'));
    expect(c.allowed).toBe(false);
    expect(c.reason).toBe('early');
    expect(c.window.opensAt).toEqual(at('06:50'));
  });

  it('3. is allowed at 6:54 and records 6 minutes of grace', () => {
    const c = clockInCheck(s, at('06:54'));
    expect(c).toMatchObject({ allowed: true, grace: 6 });
    const d = data({ schedule: [s], punches: [punch(avery, 'in', at('06:54'), s, { grace: 6 }), punch(avery, 'out', at('12:30'), s)] });
    const day = dayOf(d, avery);
    expect(day.flags.map((f) => f.code)).toEqual(['grace_used']);
    // Grace is logged but not paid by default, and doesn't hold up approval.
    expect(day.computed).toBeCloseTo(5.5);
    expect(day.status).toBe('ready');
  });

  it('flags a late arrival 5 or more minutes after the start', () => {
    const d = data({ schedule: [s], punches: [punch(avery, 'in', at('07:12'), s), punch(avery, 'out', at('12:30'), s)] });
    expect(dayOf(d, avery).flags.map((f) => f.code)).toContain('late');
  });

  describe('through the demo backend', () => {
    beforeEach(() => { vi.useFakeTimers(); demo.reset(); setDemoActor('tester@example.com'); });
    afterEach(() => vi.useRealTimers());

    it('4. ignores a backdated time in the request', () => {
      vi.setSystemTime(at('06:57'));
      const r = demo.load().schedule.find((x) => x.date === DAY && x.start === '07:00');
      const p = demo.punch({ type: 'in', name: r.name, email: r.email, shiftId: r.id, location: r.location, station: r.station, ts: '2020-01-01T00:00:00Z' });
      expect(p.ts).toBe(new Date().toISOString());
    });

    it('6. records four evening operators clocking in within a few minutes, each on their own shift', () => {
      vi.setSystemTime(at('16:58'));
      const d = demo.load();
      const evening = d.schedule.filter((r) => r.date === DAY && r.start === '17:00');
      expect(evening.length).toBe(4);
      const before = demo.load().punches.length;
      evening.forEach((r, i) => {
        vi.setSystemTime(new Date(+at('16:58') + i * 45e3));
        demo.punch({ type: 'in', name: r.name, email: r.email, shiftId: r.id, location: r.location, station: r.station });
      });
      const added = demo.load().punches.slice(before);
      expect(added.map((p) => p.email).sort()).toEqual(evening.map((r) => r.email).sort());
      expect(new Set(added.map((p) => p.shiftId)).size).toBe(4);
    });
  });
});

describe('overlapping shifts', () => {
  it('5. a 30-minute handover is not a flag, and robot time counts the overlap once', () => {
    const am = [shift(avery, '07:00', '12:30'), shift(jordan, '07:00', '12:30')];
    const mid = [shift(morgan, '12:00', '17:30')];
    const punches = [
      punch(avery, 'in', at('07:00'), am[0]), punch(avery, 'out', at('12:30'), am[0]),
      punch(jordan, 'in', at('07:00'), am[1]), punch(jordan, 'out', at('12:30'), am[1]),
      punch(morgan, 'in', at('12:00'), mid[0]), punch(morgan, 'out', at('17:30'), mid[0]),
    ];
    const d = data({ schedule: [...am, ...mid], punches });
    const robot = delivered(buildSessions(punches, AFTER).sessions).find((x) => x.station === 'Robot 1');
    expect(robot.hours).toBeCloseTo(10.5);
    for (const who of [avery, jordan, morgan]) expect(dayOf(d, who).flags).toEqual([]);
    expect(conflicts(d.schedule)).toEqual([]);
  });
});

describe('clock-out', () => {
  const s = shift(jordan, '12:00', '17:30');

  it('7. a forgotten clock-out is flagged, with a system-suggested end that counts only once accepted', () => {
    const d = data({ schedule: [s], punches: [punch(jordan, 'in', at('12:00'), s)] });
    const day = dayOf(d, jordan);
    const f = day.flags.find((x) => x.code === 'no_clockout');
    expect(f).toBeTruthy();
    expect(f.suggested).toEqual(at('17:30'));
    expect(day.computed).toBe(0);
    expect(day.status).toBe('needs_review');
    const resolved = data({ ...d, resolutions: [{ key: f.key, outcome: 'accept', reason: 'Lead saw them leave at the end', by: 'm', at: '1' }] });
    expect(dayOf(resolved, jordan).computed).toBeCloseTo(5.5);
    // Or the manager types the real end.
    const typed = data({ ...d, resolutions: [{ key: f.key, outcome: 'accept', reason: 'Left at 4', endTime: at('16:00').toISOString(), by: 'm', at: '1' }] });
    expect(dayOf(typed, jordan).computed).toBeCloseTo(4);
  });

  it('8. a late finish is accepted but the extra time waits for approval', () => {
    const d = data({ schedule: [s], punches: [punch(jordan, 'in', at('12:00'), s), punch(jordan, 'out', at('17:48'), s)] });
    const day = dayOf(d, jordan);
    const f = day.flags.find((x) => x.code === 'outside_shift');
    expect(f.minutes).toBe(18);
    expect(day.computed).toBeCloseTo(5.5);
    const ok = data({ ...d, resolutions: [{ key: f.key, outcome: 'accept', reason: 'Finished a reset', by: 'm', at: '1' }] });
    expect(dayOf(ok, jordan).computed).toBeCloseTo(5.8);
  });

  it('9. leaving early is flagged', () => {
    const d = data({ schedule: [s], punches: [punch(jordan, 'in', at('12:00'), s), punch(jordan, 'out', at('15:00'), s, { flag: 'early', note: 'Unwell' })] });
    expect(dayOf(d, jordan).flags.map((f) => f.code)).toContain('left_early');
  });
});

describe('scheduling', () => {
  const rookieA = op('Drew Sato', 1);
  const rookieB = op('Reese Park', 0);

  it('10. pairing two operators with fewer than two completed sessions is flagged', () => {
    const a = shift(rookieA, '17:00', '23:00', 'Robot 2');
    const warn = checkNewShift(shift(rookieB, '17:00', '23:00', 'Robot 2'), [a], [rookieA, rookieB], [], MON);
    expect(warn.map((w) => w.code)).toContain('pairing');
    // With an experienced partner it's fine.
    expect(pairingRisks([a, shift(avery, '17:00', '23:00', 'Robot 2')], [rookieA, avery], [])).toEqual([]);
  });

  it('11. booking past 37 hours in a week warns', () => {
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
    const sched = week.flatMap((day) => [shift(morgan, '07:00', '12:30', 'Robot 1', day)]).concat(week.slice(0, 1).map((day) => shift(morgan, '12:00', '17:30', 'Robot 1', day)));
    expect(weeklyLoad(sched, MON)[0]).toMatchObject({ hours: 33, over: false });
    const warn = checkNewShift(shift(morgan, '12:00', '17:30', 'Robot 1', '2026-11-03'), sched, [morgan], [], MON);
    expect(warn.map((w) => w.code)).toContain('over_cap');
  });

  it('12. the same operator at two labs at once is a conflict', () => {
    const warn = checkNewShift(shift(avery, '12:00', '17:30', 'Robot 3'), [shift(avery, '07:00', '12:30', 'Robot 1')], [avery], [], MON);
    expect(warn.map((w) => w.code)).toContain('overlap');
  });

  it('13. importing Active Roster 2 gives new operators IDs and a re-import makes no duplicates', () => {
    const csv = 'Name,Email,Cohort,Sessions Completed,Training Status,Location\nAvery Lin,avery.lin@example.com,Cohort 1,12,Trained,Redmond\nNew Person,new.person@example.com,Cohort 4,0,In training,Mountain View\n,bad,,,,\n';
    const plan = planRosterImport(csv, [{ ...avery, id: 'OP-0001' }], '2026-11-05');
    expect(plan.add.map((o) => [o.id, o.location, o.completedSessions])).toEqual([['OP-0002', 'MTV', 0]]);
    expect(plan.update.map((o) => o.changed)).toEqual([['cohort', 'completedSessions', 'training']]);
    expect(plan.skip.length).toBe(1);
    const after = [{ ...avery, id: 'OP-0001', ...plan.update[0] }, ...plan.add];
    const again = planRosterImport(csv, after, '2026-11-05');
    expect(again.add).toEqual([]);
    expect(again.update).toEqual([]);
  });

  it('imports a schedule tab, matching templates, and updates rather than duplicates on re-import', () => {
    const ops = [{ ...avery, id: 'OP-0001' }];
    const csv = 'Date,Email,Location,Robot,Shift\n11/2/2026,avery.lin@example.com,Redmond,Robot 2,7:00 AM - 12:30 PM\n11/3/2026,someone@else.com,Redmond,,7:00 AM - 12:30 PM\n';
    const plan = planScheduleImport(csv, ops, []);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0]).toMatchObject({ date: '2026-11-02', location: 'RED', station: 'Robot 2', start: '07:00', end: '12:30', template: 'RED-AM' });
    expect(plan.skip[0].reason).toMatch(/Unknown operator/);
    const again = planScheduleImport(csv, ops, [{ ...plan.add[0], id: 'S-1' }]);
    expect(again.add).toHaveLength(0);
  });
});

describe('review and approval', () => {
  const s = shift(avery, '07:00', '12:30');

  it('15. an unscheduled clock-in is saved and flagged, and its time counts only if accepted', () => {
    const d = data({ schedule: [shift(jordan, '07:00', '12:30')], punches: [punch(avery, 'in', at('12:05')), punch(avery, 'out', at('15:05'))] });
    const day = dayOf(d, avery);
    const f = day.flags.find((x) => x.code === 'unscheduled');
    expect(f).toBeTruthy();
    expect(day.computed).toBe(0);
    expect(dayOf(data({ ...d, resolutions: [{ key: f.key, outcome: 'accept', reason: 'Asked to cover', by: 'm', at: '1' }] }), avery).computed).toBeCloseTo(3);
  });

  it('16. each day carries scheduled, recorded, flags, computed, approved, approver and time', () => {
    const d = data({ operators: [avery], schedule: [s], punches: [punch(avery, 'in', at('07:00'), s), punch(avery, 'out', at('12:40'), s)], approvals: [{ email: avery.email, date: DAY, status: 'approved', hours: 5.5, computed: 5.5, by: 'manager@example.com', at: '2026-11-09T17:00:00Z' }] });
    const day = dayOf(d, avery);
    expect(day).toMatchObject({ operatorId: avery.id, scheduled: 5.5, approved: 5.5, status: 'approved' });
    expect(day.recorded).toBeCloseTo(5 + 40 / 60);
    expect(day.approval).toMatchObject({ by: 'manager@example.com', at: '2026-11-09T17:00:00Z' });
  });

  describe('through the demo backend', () => {
    beforeEach(() => { demo.reset(); setDemoActor('manager@example.com'); });

    it('17. resolving a flag needs a reason', () => {
      expect(() => demo.resolveFlag({ key: 'k', outcome: 'noted', reason: '  ' })).toThrow();
      expect(demo.resolveFlag({ key: 'k', outcome: 'noted', reason: 'Checked with lead' }).by).toBe('manager@example.com');
    });

    it('18. approve, then reopen and re-approve before reporting, all in the audit trail', () => {
      const a = { email: avery.email, operatorId: avery.id, date: DAY, hours: 5.5, computed: 5.5, note: '' };
      expect(() => demo.approveDay({ ...a, hours: 5 }, 'approved')).toThrow(/note/);
      demo.approveDay(a, 'approved');
      expect(() => demo.approveDay(a, 'reopened')).toThrow(/reason/);
      demo.approveDay({ ...a, note: 'Badge record shows 12:15 out' }, 'reopened');
      demo.approveDay({ ...a, hours: 5.25, note: 'Corrected to badge out' }, 'approved');
      const d = { ...demo.load(), schedule: [s], punches: [punch(avery, 'in', at('07:00'), s), punch(avery, 'out', at('12:30'), s)] };
      const rows = approvedRows(d, MON, NEXT_MON, AFTER).filter((r) => r.operator_email === avery.email);
      expect(rows).toHaveLength(1);
      expect(rows[0].approved_hours).toBe('5.25');
      expect(demo.load().audit.filter((x) => x.target === `${avery.email}|${DAY}`).map((x) => x.action)).toEqual(['approve_day', 'reopen_day', 'approve_day']);
    });
  });

  it('19. a no-show is flagged with no hours', () => {
    const day = dayOf(data({ schedule: [s] }), avery);
    expect(day.flags.map((f) => f.code)).toEqual(['no_show']);
    expect(day.computed).toBe(0);
  });
});

describe('reporting', () => {
  it('20. the approved-hours export holds approved days only, with the agreed columns', () => {
    const s1 = shift(avery, '07:00', '12:30');
    const s2 = shift(jordan, '07:00', '12:30');
    const d = data({
      operators: [avery, jordan],
      schedule: [s1, s2],
      punches: [punch(avery, 'in', at('07:00'), s1), punch(avery, 'out', at('12:30'), s1), punch(jordan, 'in', at('07:00'), s2), punch(jordan, 'out', at('12:30'), s2)],
      approvals: [{ email: avery.email, operatorId: avery.id, date: DAY, status: 'approved', hours: 5.5, computed: 5.5, by: 'manager@example.com', at: '2026-11-09T17:00:00Z' }],
    });
    const rows = approvedRows(d, MON, NEXT_MON, AFTER);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).toEqual(APPROVED_COLUMNS);
    expect(rows[0]).toMatchObject({ operator_id: avery.id, work_date: DAY, iso_week: '2026-W45', location_id: 'RED', location_name: 'Redmond Lab', approved_hours: '5.50', approval_status: 'approved' });
    expect(JSON.stringify(rows)).not.toMatch(/rate|markup|pay/i);
  });
});

describe('admin search', async () => {
  const { parseQuery, search } = await import('../src/lib/search.js');
  const { api } = await import('../src/lib/api.js');
  const now = new Date(2026, 10, 5, 10, 0); // Thu Nov 5 2026
  const k = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('reads dates in the ways people type them', () => {
    expect(k(parseQuery('nov 3', now).range[0])).toBe('2026-11-03');
    expect(k(parseQuery('11/3', now).range[0])).toBe('2026-11-03');
    expect(k(parseQuery('2026-11-03', now).range[0])).toBe('2026-11-03');
    expect(k(parseQuery('3rd november', now).range[0])).toBe('2026-11-03');
    expect(k(parseQuery('yesterday', now).range[0])).toBe('2026-11-04');
    expect(k(parseQuery('tuesday', now).range[0])).toBe('2026-11-03');
    expect(k(parseQuery('last tue', now).range[0])).toBe('2026-10-27');
    const lw = parseQuery('last week', now).range;
    expect([k(lw[0]), k(lw[1])]).toEqual(['2026-10-26', '2026-11-02']);
  });

  it('pulls out labs, robots, flags and statuses and keeps the name', () => {
    const p = parseQuery('jordan no clock-out redmond robot 2 last week', now);
    expect(p.words).toEqual(['jordan']);
    expect(p.flags).toEqual(['no_clockout']);
    expect(p.labs).toEqual(['RED']);
    expect(p.robots).toEqual(['Robot 2']);
    expect(parseQuery('no-show', now).flags).toEqual(['no_show']);
    expect(parseQuery('needs review', now).status).toBe('needs_review');
    expect(parseQuery('Mountain View', now).labs).toEqual(['MTV']);
    // Names that start like a weekday or a lab are still names.
    expect(parseQuery('Sato', now).words).toEqual(['sato']);
    expect(parseQuery('Monica', now).range).toBe(null);
  });

  it('finds operators by name, email and ID', async () => {
    const data = await api.all();
    const o = data.operators.find((x) => (x.roles || ['operator']).includes('operator'));
    expect(search(data, o.name.split(' ')[0]).operators.map((x) => x.email)).toContain(o.email);
    expect(search(data, o.id).operators.map((x) => x.email)).toEqual([o.email]);
    expect(search(data, o.email).operators.map((x) => x.email)).toEqual([o.email]);
    expect(search(data, 'zzzz-nobody').operators).toEqual([]);
  });

  it('finds flagged days, and only days with that flag', async () => {
    const data = await api.all();
    const r = search(data, 'no clock-out');
    expect(r.days.length).toBeGreaterThan(0);
    expect(r.days.every((d) => d.flags.some((f) => f.code === 'no_clockout'))).toBe(true);
    expect(r.days.some((d) => d.name.startsWith('Jordan'))).toBe(true);
    expect(r.operators).toEqual([]);
  });

  it('a date shows that day’s shifts and a link to it', async () => {
    const data = await api.all();
    const d = data.schedule[0].date;
    const r = search(data, d);
    expect(r.dayLinks).toEqual([d]);
    expect(r.shifts.length).toBeGreaterThan(0);
    expect(r.shifts.every((s) => s.date === d)).toBe(true);
  });
});

describe('real Redmond shift pattern', async () => {
  const { planScheduleImport, toHHMM } = await import('../src/lib/importer.js');
  const { LOCATIONS } = await import('../src/lib/config.js');
  it('Redmond runs every day: 2 on Morning, 2 on Afternoon, 4 on Night', () => {
    const red = LOCATIONS.find((l) => l.id === 'RED');
    expect(red.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(red.templates.map((t) => [t.label, t.seats])).toEqual([['Morning', 2], ['Afternoon', 2], ['Night', 4]]);
  });
  it('reads times with a time zone, and shift names alone', () => {
    expect(toHHMM('11:00 PM PDT')).toBe('23:00');
    expect(toHHMM('7:00 AM PST')).toBe('07:00');
    const ops = [{ id: 'OP-1', email: 'a@x.com', name: 'A', location: 'RED' }];
    const plan = planScheduleImport('Date,Email,Shift\n11/7/2026,a@x.com,5:00 PM - 11:00 PM PDT\n11/8/2026,a@x.com,Night\n', ops, []);
    expect(plan.add.map((x) => [x.start, x.end, x.template])).toEqual([['17:00', '23:00', 'RED-PM'], ['17:00', '23:00', 'RED-PM']]);
  });
});

describe('operator experience', async () => {
  const { experience, pairingRisks, checkNewShift } = await import('../src/lib/rules.js');
  const mk = (name, done, exp = '') => ({ email: `${name}@x.com`, name, completedSessions: done, completedAsOf: '2026-11-01', experience: exp });
  const sh = (o, id) => ({ id, date: '2026-11-10', email: o.email, name: o.name, station: 'Robot 1', location: 'RED', start: '17:00', end: '23:00' });
  it('an admin mark beats completed sessions, both ways', () => {
    expect(experience(mk('a', 0), []).level).toBe('new');
    expect(experience(mk('a', 0, 'experienced'), []).level).toBe('experienced');
    expect(experience(mk('a', 30, 'new'), []).level).toBe('new');
    expect(experience(mk('a', 30, 'new'), []).marked).toBe(true);
  });
  it('a pair with no experienced operator is flagged, using the mark', () => {
    const vet = mk('vet', 40, 'new');
    const rookie = mk('rookie', 0);
    expect(pairingRisks([sh(vet, 1), sh(rookie, 2)], [vet, rookie], [])).toHaveLength(1);
    const promoted = mk('rookie', 0, 'experienced');
    expect(pairingRisks([sh(vet, 1), sh(promoted, 2)], [vet, promoted], [])).toHaveLength(0);
    const w = checkNewShift(sh(rookie, 'new1'), [sh(vet, 1)], [vet, rookie], [], new Date(2026, 10, 9));
    expect(w.map((x) => x.code)).toContain('pairing');
  });
});

describe('handover is not a pairing', async () => {
  const { pairingRisks } = await import('../src/lib/rules.js');
  it('two new operators on Afternoon and Night of one robot are not a pair', () => {
    const a = { email: 'a@x.com', name: 'A', completedSessions: 0 };
    const b = { email: 'b@x.com', name: 'B', completedSessions: 0 };
    const r = (o, id, start, end) => ({ id, date: '2026-11-10', email: o.email, name: o.name, station: 'Robot 1', start, end });
    expect(pairingRisks([r(a, 1, '12:00', '17:30'), r(b, 2, '17:00', '23:00')], [a, b], [])).toEqual([]);
    expect(pairingRisks([r(a, 1, '17:00', '23:00'), r(b, 2, '17:00', '23:00')], [a, b], [])).toHaveLength(1);
  });
});
