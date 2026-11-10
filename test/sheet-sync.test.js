import { describe, expect, it } from 'vitest';
import { normScheduleSync, parseSheetTime, planSheetSync, sheetDate, sheetKey, syncIncludesToday } from '../src/lib/sheetSync.js';

// Synthetic people and rows only (demo data); the real workbook never goes in the repo.
const users = [
  { id: 'OP-1', email: 'avery.lin@example.com', name: 'Avery Lin', location: 'RED' },
  { id: 'OP-2', email: 'jordan.pike@example.com', name: 'Jordan Pike', location: 'RED' },
  { id: 'OP-3', email: 'sam.okafor@example.com', name: 'Sam Okafor', location: 'RED' },
  { id: 'OP-4', email: 'riley.chen@example.com', name: 'Riley Chen', location: 'RED' },
  { id: 'OP-5', email: 'alex.moreno@example.com', name: 'Alex Moreno', location: 'MTV' },
];
const labs = [
  { id: 'RED', templates: [{ id: 'RED-AM', start: '07:00', end: '12:30' }, { id: 'RED-PM', start: '17:00', end: '23:00' }] },
  { id: 'MTV', templates: [{ id: 'MTV-AM', start: '07:00', end: '12:00' }] },
];
const today = '2026-11-10';
const row = (date, shift, time, who, extra = {}) => ({ table: 'tblRedmondSchedule', date, shift, time, name: who ? users.find((u) => u.email.startsWith(who)).name : '', email: who ? users.find((u) => u.email.startsWith(who)).email : '', ...extra });
const AM = '7:00 AM - 12:30 PM PT';
const PM = '5:00 PM - 11:00 PM PT';
const plan = (rows, shifts = [], skips = []) => planSheetSync({ rows, shifts, users, skips, today, labs });
const saved = (p) => p.add.map((s, i) => ({ ...s, id: `S-${i}` }));

describe('reading the sheet', () => {
  it('reads the Time column', () => {
    expect(parseSheetTime('7:00 AM - 12:30 PM PT')).toEqual({ start: '07:00', end: '12:30' });
    expect(parseSheetTime('12:00 PM - 5:30 PM PT')).toEqual({ start: '12:00', end: '17:30' });
    expect(parseSheetTime('5:30 PM – 11:00 PM')).toEqual({ start: '17:30', end: '23:00' });
    expect(parseSheetTime('Lab closed')).toBeNull();
  });
  it('reads every range in the live tabs (3 Redmond, 7 Mountain View)', () => {
    const ranges = {
      '7:00 AM - 12:30 PM PT': ['07:00', '12:30'], '12:00 PM - 5:30 PM PT': ['12:00', '17:30'], '5:00 PM - 11:00 PM PT': ['17:00', '23:00'],
      '9:00 AM - 11:00 AM PT': ['09:00', '11:00'], '7:00 AM - 11:00 AM PT': ['07:00', '11:00'], '7:00 AM - 12:00 PM PT': ['07:00', '12:00'],
      '12:30 PM - 5:00 PM PT': ['12:30', '17:00'], '10:00 AM - 5:00 PM PT': ['10:00', '17:00'], '5:30 PM - 11:00 PM PT': ['17:30', '23:00'],
    };
    for (const [text, [start, end]] of Object.entries(ranges)) expect(parseSheetTime(text)).toEqual({ start, end });
    // A row whose Time can't be read is skipped and reported, never guessed.
    const p = plan([row('2026-11-12', 'Morning', 'TBD', 'avery')]);
    expect(p.add).toEqual([]);
    expect(p.skipped[0].reason).toBe('bad_time');
  });
  it('keeps the last counts while a run is under way or queued', () => {
    const s = normScheduleSync(JSON.stringify({ at: '2026-11-10T13:30:00Z', added: 3, runningSince: '2026-11-10T22:00:00Z' }));
    expect(s).toMatchObject({ at: '2026-11-10T13:30:00Z', added: 3, runningSince: '2026-11-10T22:00:00Z' });
    expect(normScheduleSync({ requestedAt: '2026-11-10T22:00:00Z' })).toMatchObject({ at: '', requestedAt: '2026-11-10T22:00:00Z' });
    expect(normScheduleSync('')).toBeNull();
  });
  it('reads Excel dates as ISO, serial numbers or m/d/yyyy', () => {
    expect(sheetDate('2026-11-12T00:00:00.000Z')).toBe('2026-11-12');
    expect(sheetDate(46338)).toBe('2026-11-12');
    expect(sheetDate('11/12/2026')).toBe('2026-11-12');
  });
});

describe('the daily sync', () => {
  it('adds only days after today, skips open slots, and pairs a shift of two', () => {
    const p = plan([
      row('2026-11-09', 'Morning', AM, 'avery'),
      row('2026-11-10', 'Morning', AM, 'avery'),
      row('2026-11-11', 'Morning', AM, 'avery'),
      row('2026-11-11', 'Morning', AM, 'jordan'),
      row('2026-11-11', 'Night', PM, ''),
    ]);
    expect(p.add.map((s) => [s.date, s.email])).toEqual([['2026-11-11', 'avery.lin@example.com'], ['2026-11-11', 'jordan.pike@example.com']]);
    expect(p.add[0]).toMatchObject({ location: 'RED', template: 'RED-AM', start: '07:00', end: '12:30', source: 'sheet', sheetKey: 'RED|2026-11-11|morning|avery.lin@example.com', station: '', operatorId: 'OP-1' });
    expect(p.add[0].pair).toBe(p.add[1].pair);
    expect(p.add[0].pair).toMatch(/^P-sheet-/);
  });

  it('includes today only for a run before the workday (the 5:30 AM run)', () => {
    expect(syncIncludesToday(new Date(2026, 10, 10, 5, 30))).toBe(true);
    expect(syncIncludesToday(new Date(2026, 10, 10, 6, 0))).toBe(false);
    expect(syncIncludesToday(new Date(2026, 10, 10, 14, 0))).toBe(false);
    const rows = [row('2026-11-09', 'Morning', AM, 'avery'), row('2026-11-10', 'Morning', AM, 'jordan'), row('2026-11-11', 'Morning', AM, 'sam')];
    const early = planSheetSync({ rows, users, today, includeToday: true, labs });
    expect(early.from).toBe('2026-11-10');
    expect(early.add.map((s) => s.date)).toEqual(['2026-11-10', '2026-11-11']);
    // Later in the day, a sheet shift for today is left as it is, even if its row is gone.
    const shifts = early.add.map((s, i) => ({ ...s, id: `S-${i}` }));
    expect(planSheetSync({ rows: [], shifts, users, today, labs, labsRead: ['RED'] }).remove).toEqual(['S-1']);
  });

  it('leaves the pair to the scheduler when 3 or more share a shift, unless the sheet has a Pair column', () => {
    const four = ['avery', 'jordan', 'sam', 'riley'];
    expect(plan(four.map((w) => row('2026-11-12', 'Night', PM, w))).add.every((s) => !s.pair)).toBe(true);
    const p = plan(four.map((w, i) => row('2026-11-12', 'Night', PM, w, { pair: i < 2 ? 'A' : 'B' })));
    expect(new Set(p.add.map((s) => s.pair)).size).toBe(2);
  });

  it('is idempotent, updates a changed time and removes a row that is gone', () => {
    const rows = [row('2026-11-11', 'Morning', AM, 'avery'), row('2026-11-11', 'Morning', AM, 'jordan'), row('2026-11-12', 'Night', PM, 'sam')];
    const shifts = saved(plan(rows));
    expect(plan(rows, shifts)).toMatchObject({ add: [], update: [], remove: [] });
    const next = plan([row('2026-11-11', 'Morning', '8:00 AM - 12:30 PM PT', 'avery'), row('2026-11-11', 'Morning', AM, 'jordan')], shifts);
    expect(next.update).toHaveLength(1);
    expect(next.update[0]).toMatchObject({ id: 'S-0', start: '08:00', template: '' });
    expect(next.remove).toEqual(['S-2']);
  });

  it('a new name on a row replaces the old one', () => {
    const shifts = saved(plan([row('2026-11-12', 'Night', PM, 'sam')]));
    const p = plan([row('2026-11-12', 'Night', PM, 'riley')], shifts);
    expect(p.add.map((s) => s.email)).toEqual(['riley.chen@example.com']);
    expect(p.remove).toEqual(['S-0']);
  });

  it('never touches shifts added or changed in Lotus, nor today or the past', () => {
    const manual = { id: 'S-m', date: '2026-11-12', email: 'sam.okafor@example.com', start: '17:00', end: '23:00', source: 'app', sheetKey: '' };
    const changed = { id: 'S-c', date: '2026-11-13', email: 'avery.lin@example.com', start: '09:00', end: '12:30', source: 'app', sheetKey: sheetKey('RED', '2026-11-13', 'Morning', 'avery.lin@example.com') };
    const todays = { id: 'S-t', date: '2026-11-10', email: 'jordan.pike@example.com', start: '07:00', end: '12:30', source: 'sheet', sheetKey: sheetKey('RED', '2026-11-10', 'Morning', 'jordan.pike@example.com') };
    const p = plan([row('2026-11-12', 'Night', PM, 'sam'), row('2026-11-13', 'Morning', AM, 'avery')], [manual, changed, todays]);
    expect(p.add).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
    expect(p.kept.map((k) => k.reason).sort()).toEqual(['booked_in_lotus', 'changed_in_lotus']);
  });

  it('keeps a sheet shift that was removed in Lotus out', () => {
    const k = sheetKey('RED', '2026-11-12', 'Night', 'sam.okafor@example.com');
    const p = plan([row('2026-11-12', 'Night', PM, 'sam')], [], [k]);
    expect(p.add).toEqual([]);
    expect(p.kept[0].reason).toBe('removed_in_lotus');
  });

  it('reports rows it cannot book instead of guessing', () => {
    const p = plan([
      { table: 'tblRedmondSchedule', date: '2026-11-12', shift: 'Night', time: PM, name: 'Someone New', email: '' },
      { table: 'tblRedmondSchedule', date: '2026-11-12', shift: 'Night', time: PM, name: 'Not Yet', email: 'not.yet@example.com' },
      { table: 'tblRedmondSchedule', date: '2026-11-12', shift: 'Night', time: PM, name: 'Alex Moreno', email: 'Alex.Moreno@example.com ' },
    ]);
    expect(p.add).toEqual([]);
    expect(p.skipped.map((s) => s.reason)).toEqual(['no_email', 'not_in_lotus', 'other_lab']);
  });

  it('removes nothing when most of the sheet vanishes at once (a renamed table or column)', () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`2026-11-${String(11 + i).padStart(2, '0')}`, 'Night', PM, 'sam'));
    const shifts = saved(plan(many));
    const p = plan([row('2026-11-11', 'Night', PM, 'sam')], shifts);
    expect(p.remove).toEqual([]);
    expect(p.held).toBe(11);
  });

  it('never prunes a lab whose table was not read', () => {
    const shifts = saved(planSheetSync({ rows: [{ table: 'tblMVSchedule', date: '2026-11-12', shift: 'Morning', time: '7:00 AM - 12:00 PM PT', name: 'Alex Moreno', email: 'alex.moreno@example.com' }], users, today, labs }));
    expect(shifts[0].template).toBe('MTV-AM');
    const p = planSheetSync({ rows: [row('2026-11-12', 'Night', PM, 'sam')], shifts, users, today, labs });
    expect(p.remove).toEqual([]);
  });
});
