import { describe, expect, it } from 'vitest';
import { planSheetSync, sheetKey } from '../src/lib/sheetSync.js';
import { planScheduleImport } from '../src/lib/importer.js';

// The owner's rule (2026-11-17, to recruiting): "it works both ways. The app always
// refers to the Excel tracker for the week by week assignments, but any changes during
// the week should be made in the app." These walk a week through both sides, with the
// same pure plans the Lotus Schedule Sync flow and Schedule → Import follow.
// Synthetic demo people only.
const users = [
  { id: 'OP-1', email: 'avery.lin@example.com', name: 'Avery Lin', location: 'RED' },
  { id: 'OP-2', email: 'jordan.pike@example.com', name: 'Jordan Pike', location: 'RED' },
  { id: 'OP-3', email: 'sam.okafor@example.com', name: 'Sam Okafor', location: 'RED' },
  { id: 'OP-4', email: 'riley.chen@example.com', name: 'Riley Chen', location: 'RED' },
];
const labs = [{ id: 'RED', templates: [{ id: 'RED-AM', start: '07:00', end: '12:30' }, { id: 'RED-MID', start: '12:00', end: '17:30' }, { id: 'RED-PM', start: '17:00', end: '23:00' }] }];
const who = (w) => users.find((u) => u.email.startsWith(w));
const row = (date, shift, time, w) => ({ table: 'tblRedmondSchedule', date, shift, time, name: who(w).name, email: who(w).email });
const AM = '7:00 AM - 12:30 PM PT';
const MID = '12:00 PM - 5:30 PM PT';

// What the flow and the app do with a plan: apply it to Lotus_Shifts.
let seq = 0;
const apply = (shifts, p) => shifts.filter((r) => !p.remove.includes(r.id)).map((r) => p.update.find((u) => u.id === r.id) || r).concat(p.add.map((r) => ({ ...r, id: `S-${++seq}` })));
const sync = (rows, state, today = '2026-11-15') => {
  const p = planSheetSync({ rows, shifts: state.shifts, users, skips: state.skips, today, labs });
  return { p, state: { ...state, shifts: apply(state.shifts, p) } };
};
// Remove in Lotus = Delete Shift: a sheet shift's key goes to Lotus_SheetSkips.
const removeInLotus = (state, id) => {
  const r = state.shifts.find((x) => x.id === id);
  return { shifts: state.shifts.filter((x) => x.id !== id), skips: r.sheetKey ? [...state.skips, r.sheetKey] : state.skips };
};
// Add shift in Lotus = a new row with Source app.
const addInLotus = (state, w, date, start, end) => ({ ...state, shifts: [...state.shifts, { id: `S-app-${++seq}`, date, email: who(w).email, name: who(w).name, operatorId: who(w).id, location: 'RED', start, end, station: '', pair: '', source: 'app', sheetKey: '' }] });

const week = [
  row('2026-11-17', 'Morning', AM, 'avery'),
  row('2026-11-17', 'Morning', AM, 'jordan'),
  row('2026-11-18', 'Morning', AM, 'sam'),
  row('2026-11-18', 'Morning', AM, 'riley'),
];

describe('the tracker sets the week, Lotus changes stick', () => {
  it('books the tracker’s week into Lotus, and a second run changes nothing', () => {
    let { p, state } = sync(week, { shifts: [], skips: [] });
    expect(p.add).toHaveLength(4);
    expect(state.shifts.every((r) => r.source === 'sheet')).toBe(true);
    ({ p } = sync(week, state));
    expect([p.add, p.update, p.remove]).toEqual([[], [], []]);
  });

  it('a mid-week move in Lotus (remove + add) survives every later sync', () => {
    let { state } = sync(week, { shifts: [], skips: [] });
    // Mid-week the scheduler moves Avery from Tuesday morning to Tuesday afternoon.
    const avery = state.shifts.find((r) => r.email === who('avery').email);
    state = addInLotus(removeInLotus(state, avery.id), 'avery', '2026-11-17', '12:00', '17:30');
    // The tracker is never updated. The next daily run, and the one after:
    for (const today of ['2026-11-15', '2026-11-16']) {
      const r = sync(week, state, today);
      expect(r.p.add).toEqual([]);
      expect(r.p.remove).toEqual([]);
      expect(r.p.kept.map((k) => k.reason)).toEqual(['removed_in_lotus']);
      state = r.state;
    }
    const averys = state.shifts.filter((r) => r.email === who('avery').email);
    expect(averys.map((r) => [r.start, r.source])).toEqual([['12:00', 'app']]);
  });

  it('a mid-week swap in Lotus survives, and no duplicate when recruiting copies it into the tracker', () => {
    let { state } = sync(week, { shifts: [], skips: [] });
    const sam = state.shifts.find((r) => r.email === who('sam').email);
    // Sam can't make Wednesday; the scheduler books Avery instead, in Lotus.
    state = addInLotus(removeInLotus(state, sam.id), 'avery', '2026-11-18', '07:00', '12:30');
    let r = sync(week, state);
    expect([r.p.add, r.p.remove]).toEqual([[], []]);
    // Later recruiting types the same swap into the tracker.
    const updated = week.map((x) => (x.email === who('sam').email ? row('2026-11-18', 'Morning', AM, 'avery') : x));
    r = sync(updated, r.state);
    expect(r.p.add).toEqual([]);
    expect(r.p.kept.map((k) => k.reason)).toEqual(['booked_in_lotus']);
    expect(r.state.shifts.filter((x) => x.date === '2026-11-18' && x.email === who('avery').email)).toHaveLength(1);
  });

  it('an operator added in Lotus and also in the tracker is booked once', () => {
    let { state } = sync(week, { shifts: [], skips: [] });
    state = addInLotus(state, 'riley', '2026-11-19', '12:00', '17:30');
    const r = sync([...week, row('2026-11-19', 'Afternoon', MID, 'riley')], state);
    expect(r.p.add).toEqual([]);
    expect(r.state.shifts.filter((x) => x.date === '2026-11-19')).toHaveLength(1);
  });

  it('next week’s tracker rows still flow in after mid-week Lotus changes', () => {
    let { state } = sync(week, { shifts: [], skips: [] });
    state = removeInLotus(state, state.shifts[0].id);
    const r = sync([...week, row('2026-11-24', 'Morning', AM, 'avery'), row('2026-11-24', 'Morning', AM, 'jordan')], state);
    expect(r.p.add.map((x) => [x.date, x.name])).toEqual([['2026-11-24', 'Avery Lin'], ['2026-11-24', 'Jordan Pike']]);
  });
});

describe('Schedule → Import beside the tracker', () => {
  const header = ['Date', 'Lab', 'Operator', 'Email', 'Start', 'End'];
  const sheetShift = { id: 'S-1', date: '2026-11-18', email: 'sam.okafor@example.com', name: 'Sam Okafor', operatorId: 'OP-3', location: 'RED', station: '', start: '07:00', end: '12:30', template: 'RED-AM', pair: '', note: '', source: 'sheet', sheetKey: sheetKey('RED', '2026-11-18', 'Morning', 'sam.okafor@example.com') };

  it('skips a row that overlaps a shift the person already has that day, instead of booking them twice', () => {
    const plan = planScheduleImport([header, ['2026-11-18', 'Redmond', 'Sam Okafor', 'sam.okafor@example.com', '07:30', '12:30']], users, [sheetShift]);
    expect(plan.add).toEqual([]);
    expect(plan.skip.map((s) => s.reason)).toEqual(['Already booked 07:00–12:30 that day']);
  });

  it('still books a second, separate shift the same day (a double)', () => {
    const plan = planScheduleImport([header, ['2026-11-18', 'Redmond', 'Sam Okafor', 'sam.okafor@example.com', '17:00', '23:00']], users, [sheetShift]);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].source).toBe('import');
  });

  it('skips the second of two overlapping rows for one person in the same file', () => {
    const plan = planScheduleImport([header, ['2026-11-19', 'Redmond', 'Riley Chen', '', '07:00', '12:30'], ['2026-11-19', 'Redmond', 'Riley Chen', '', '08:00', '13:00']], users, []);
    expect(plan.add).toHaveLength(1);
    expect(plan.skip[0].reason).toBe('Already booked 07:00–12:30 that day');
  });

  it('a changed end time on a synced shift stops being the sheet’s, so the next sync keeps it', () => {
    const plan = planScheduleImport([header, ['2026-11-18', 'Redmond', 'Sam Okafor', 'sam.okafor@example.com', '07:00', '11:00']], users, [sheetShift]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: 'S-1', end: '11:00', source: 'import', sheetKey: sheetShift.sheetKey });
    const p = planSheetSync({ rows: [row('2026-11-18', 'Morning', AM, 'sam')], shifts: plan.update, users, today: '2026-11-15', labs });
    expect([p.add, p.update, p.remove]).toEqual([[], [], []]);
    expect(p.kept[0].reason).toBe('changed_in_lotus');
  });
});
