import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickSheet, readXlsx } from '../src/lib/xlsx.js';
import { matchRobot, planScheduleImport, toDateKey, toHHMM } from '../src/lib/importer.js';

// test/fixtures/schedule-filled.xlsx is scripts/make-schedule-template.py run on
// demo-roster.csv (synthetic demo names), filled in and saved by a spreadsheet app.
const ops = [
  { id: 'OP-0001', name: 'Avery Lin', email: 'avery.lin@example.com', location: 'RED' },
  { id: 'OP-0002', name: 'Jordan Pike', email: 'jordan.pike@example.com', location: 'RED' },
  { id: 'OP-0003', name: 'Morgan Diaz', email: 'morgan.diaz@example.com', location: 'RED' },
  { id: 'OP-0004', name: 'Sam Ortiz', email: 'sam.ortiz@example.com', location: 'MTV' },
];
const load = async () => {
  const buf = readFileSync(new URL('./fixtures/schedule-filled.xlsx', import.meta.url));
  return readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};

describe('Excel schedule import', () => {
  it('reads the template’s sheets and picks Schedule, not Example', async () => {
    const sheets = await load();
    expect(sheets.map((s) => s.name)).toEqual(['Instructions', 'Schedule', 'Example', 'Lists']);
    const s = pickSheet(sheets, 'schedule');
    expect(s.name).toBe('Schedule');
    expect(s.rows[0].slice(0, 10)).toEqual(['Date', 'Lab', 'Shift', 'Operator', 'Email', 'Pair', 'Robot', 'Start', 'End', 'Note']);
    // The Email formula filled in from the Operator.
    expect(s.rows[1][4]).toBe('avery.lin@example.com');
  });

  it('plans the shifts: templates, custom times, pairs, Any robot, and skips with reasons', async () => {
    const plan = planScheduleImport(pickSheet(await load(), 'Schedule').rows, ops, [], '2026-11-10');
    expect(plan.add.map((s) => [s.date, s.name, s.start, s.end, s.template, s.station])).toEqual([
      ['2026-11-16', 'Avery Lin', '07:00', '12:30', 'RED-AM', ''],
      ['2026-11-16', 'Jordan Pike', '07:00', '12:30', 'RED-AM', ''],
      ['2026-11-16', 'Morgan Diaz', '17:00', '23:00', 'RED-PM', 'Robot 2'],
      ['2026-11-17', 'Avery Lin', '09:00', '15:00', '', ''],
      // Mountain View has a Night shift since the Master List's times (2026-11-10).
      ['2026-11-17', 'Sam Ortiz', '17:30', '23:00', 'MTV-PM', ''],
      ['2026-11-17', 'Sam Ortiz', '07:00', '12:00', 'MTV-AM', 'Robot 3'],
    ]);
    const [a, j, m] = plan.add;
    expect(a.pair).toMatch(/^P-/);
    expect(j.pair).toBe(a.pair);
    expect(m.pair).not.toBe(a.pair);
    expect(m.note).toBe('Covers for Avery');
    expect(plan.add[3]).toMatchObject({ pair: '', note: 'Training day' });
    expect(plan.skip).toEqual([]);
  });

  it('updates rather than duplicates when the same file comes in again', async () => {
    const rows = pickSheet(await load(), 'Schedule').rows;
    const first = planScheduleImport(rows, ops, []);
    const saved = first.add.map((s, i) => ({ ...s, id: `S-${i}` }));
    const again = planScheduleImport(rows, ops, saved);
    expect(again.add).toEqual([]);
    expect(again.update).toEqual([]);
    expect(again.skip.filter((x) => x.reason === 'Already scheduled')).toHaveLength(6);
  });
});

describe('schedule import rules', () => {
  const head = 'Date,Lab,Shift,Operator,Pair,Robot\n';
  it('allows two per pair, and checks the robot belongs to the lab', () => {
    const csv = `${head}11/16/2026,Redmond Lab,Night,Avery Lin,A,\n11/16/2026,Redmond Lab,Night,Jordan Pike,A,\n11/16/2026,Redmond Lab,Night,Morgan Diaz,A,\n11/17/2026,Redmond Lab,Morning,Avery Lin,,Robot 3\n11/18/2026,Redmond Lab,Morning,Avery Lin,,Robot 9\n`;
    const plan = planScheduleImport(csv, ops, []);
    expect(plan.add).toHaveLength(2);
    expect(plan.skip.map((x) => x.reason)).toEqual(['Pair A already has two operators', "Robot 3 isn't at Redmond Lab", 'Unknown robot “Robot 9”']);
  });
  it('skips rows repeated in the file and warns about past dates', () => {
    // Both labs run every day now (the Master List has Mountain View weekends), so no closed-day warning.
    const csv = `${head}11/16/2026,Redmond Lab,Morning,Avery Lin,,\n11/16/2026,Redmond Lab,Morning,Avery Lin,,\n11/21/2026,Mountain View Lab,Morning,Sam Ortiz,,\n11/2/2026,Redmond Lab,Morning,Jordan Pike,,\n`;
    const plan = planScheduleImport(csv, ops, [], '2026-11-10');
    expect(plan.add).toHaveLength(3);
    expect(plan.skip[0].reason).toBe('Repeated in the file');
    expect(plan.warn.map((x) => x.reason)).toEqual(['2026-11-02 is in the past']);
  });
  it('finds the header under a title row and ignores blank template rows', () => {
    const plan = planScheduleImport([['Lotus schedule'], ['Date', 'Lab', 'Shift', 'Operator'], ['', '', '', ''], ['46342', 'Redmond Lab', 'Afternoon', 'Jordan Pike']], ops, []);
    expect(plan.skip).toEqual([]);
    expect(plan.add[0]).toMatchObject({ date: '2026-11-16', start: '12:00', end: '17:30' });
  });
  it('reads Excel serial dates and times, and robots by number or name', () => {
    expect(toDateKey('46342')).toBe('2026-11-16');
    expect(toDateKey('46342.5')).toBe('2026-11-16');
    expect(toHHMM('0.375')).toBe('09:00');
    expect(toHHMM('.729166666666667')).toBe('17:30');
    expect(['Robot 2', '2', 'R2', 'Robot 2 · Mobile', 'Mobile', 'Any', ''].map(matchRobot)).toEqual(['Robot 2', 'Robot 2', 'Robot 2', 'Robot 2', 'Robot 2', '', '']);
  });
});
