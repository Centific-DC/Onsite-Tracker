// Each operator works at their home lab only (user rule, 2026-11-05).
import { beforeEach, describe, expect, it } from 'vitest';
import { homeLabProblem, wrongLab } from '../src/lib/rules.js';
import { planScheduleImport } from '../src/lib/importer.js';
import { demo, setDemoActor } from '../src/lib/api.js';
import { locOf } from '../src/lib/config.js';

const ops = [
  { id: 'OP-1', email: 'r@x.com', name: 'Rae Red', location: 'RED' },
  { id: 'OP-2', email: 'm@x.com', name: 'Mo View', location: 'MTV' },
  { id: 'OP-3', email: 'n@x.com', name: 'No Home', location: '' },
];

describe('home lab only', () => {
  it('refuses a shift at the other lab', () => {
    expect(homeLabProblem({ email: 'r@x.com', location: 'MTV' }, ops)).toMatch(/Rae Red works at Redmond Lab only/);
    expect(homeLabProblem({ email: 'r@x.com', location: 'RED' }, ops)).toBe('');
    expect(homeLabProblem({ email: 'n@x.com', location: 'MTV' }, ops)).toBe('');
  });
  it('lists booked shifts away from the home lab', () => {
    const sched = [{ id: 'S1', date: '2026-11-09', email: 'm@x.com', name: 'Mo View', location: 'RED', station: 'Robot 1', start: '07:00', end: '12:30' }];
    expect(wrongLab(sched, ops).map((w) => w.ids[0])).toEqual(['S1']);
  });
  it('skips imported shifts at the other lab', () => {
    const plan = planScheduleImport('Date,Email,Location,Start,End\n11/9/2026,m@x.com,Redmond Lab,7:00 AM,12:30 PM\n11/9/2026,r@x.com,Redmond Lab,7:00 AM,12:30 PM\n', ops, []);
    expect(plan.add.map((s) => s.email)).toEqual(['r@x.com']);
    expect(plan.skip[0].reason).toMatch(/Mo View works at Mountain View Lab only/);
  });
  describe('demo', () => {
    beforeEach(() => { demo.reset(); setDemoActor('tester@example.com'); });
    it('seeds nobody away from their home lab', () => {
      const d = demo.load();
      const home = new Map(d.operators.map((o) => [o.email, o.location]));
      expect(d.schedule.filter((r) => home.get(r.email) && locOf(r) !== home.get(r.email))).toEqual([]);
    });
    it('refuses to book or clock in at the other lab', () => {
      const d = demo.load();
      const o = d.operators.find((x) => x.location === 'MTV');
      expect(() => demo.upsertShifts([{ date: '2026-11-20', email: o.email, name: o.name, operatorId: o.id, location: 'RED', station: 'Robot 1', start: '07:00', end: '12:30' }])).toThrow(/works at Mountain View Lab only/);
      expect(() => demo.punch({ type: 'in', email: o.email, operatorId: o.id, location: 'RED', station: 'Robot 1' })).toThrow(/only clock in at Mountain View Lab/);
    });
  });
});
