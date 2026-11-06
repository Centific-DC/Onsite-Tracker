import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store with a stand-in Write flow that is slow, busy or refusing, to check
// that the screen never waits on it and nothing is lost or saved twice.
const flow = vi.hoisted(() => ({ calls: [], answer: null }));
vi.mock('../src/lib/api.js', async (orig) => {
  const real = await orig();
  const call = (op, body, ok) => { flow.calls.push(op); return flow.answer ? flow.answer(op, body) : Promise.resolve(ok(body)); };
  return {
    ...real,
    api: {
      ...real.api,
      upsertShifts: (shifts) => call('shift_upsert', shifts, (b) => b.map((r, i) => ({ ...r, id: r.id || `S-new${i}` }))),
      removeShift: (id) => call('shift_delete', id, () => undefined),
      upsertUsers: (users) => call('users_upsert', users, (b) => b),
      all: () => Promise.resolve({ schedule: [] }),
      approveDay: (a, status) => call('approve_day', a, (b) => ({ ...b, status, by: 'lead@x.com', at: 'now' })),
      punch: (body) => call('punch', body, (b) => ({ ...b, id: `P-${b.type}`, ts: '2026-11-09T15:00:00Z' })),
    },
  };
});

const { useStore } = await import('../src/lib/store.js');
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
const shift = { email: 'a@x.com', name: 'A', date: '2026-11-09', start: '07:00', end: '12:30', location: 'RED' };

describe('store save queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    flow.calls.length = 0;
    flow.answer = null;
    useStore.setState({ authStage: 'signedIn', session: { email: 'lead@x.com', roles: ['scheduler'] }, jobs: [], base: { schedule: [], operators: [{ email: 'a@x.com', name: 'A' }] }, data: { schedule: [], operators: [{ email: 'a@x.com', name: 'A' }] } });
  });
  afterEach(() => vi.useRealTimers());

  it('shows a new shift at once, and swaps in the saved one when the slow flow answers', async () => {
    let finish;
    flow.answer = (op, b) => new Promise((r) => { finish = () => r(b.map((x) => ({ ...x, id: 'S-1' }))); });
    useStore.getState().upsertShifts([shift]);
    const shown = useStore.getState().data.schedule;
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ pending: true });
    expect(useStore.getState().jobs).toHaveLength(1);
    await tick();
    finish();
    await tick();
    expect(useStore.getState().jobs).toHaveLength(0);
    expect(useStore.getState().data.schedule.map((r) => r.id)).toEqual(['S-1']);
  });

  it('keeps a change on screen while the flow is busy, and saves it on a later try', async () => {
    let n = 0;
    flow.answer = (op, b) => (++n < 3 ? Promise.reject(Object.assign(new Error('Lotus is busy.'), { status: 503 })) : Promise.resolve(b));
    useStore.getState().updateUsers([{ email: 'a@x.com', experience: 'new' }], 'A’s experience');
    await tick();
    expect(useStore.getState().data.operators[0].experience).toBe('new');
    await tick(5000);
    await tick(15000);
    expect(n).toBe(3);
    expect(useStore.getState().jobs).toHaveLength(0);
    expect(useStore.getState().data.operators[0].experience).toBe('new');
  });

  it('a refused change goes back the way it was', async () => {
    flow.answer = () => Promise.reject(Object.assign(new Error('Nope.'), { status: 400 }));
    useStore.getState().updateUsers([{ email: 'a@x.com', experience: 'new' }], 'A’s experience');
    await tick();
    expect(useStore.getState().jobs).toHaveLength(0);
    expect(useStore.getState().data.operators[0].experience).toBeUndefined();
  });

  it('a new shift that saved before a timeout is not sent again', async () => {
    let n = 0;
    flow.answer = () => { n += 1; return Promise.reject(Object.assign(new Error('timeout'), { status: 504 })); };
    const mod = await import('../src/lib/api.js');
    mod.api.all = () => Promise.resolve({ schedule: [{ ...shift, id: 'S-5' }] });
    useStore.getState().upsertShifts([shift]);
    await tick();
    await tick(5000);
    expect(n).toBe(1);
    expect(useStore.getState().jobs).toHaveLength(0);
    expect(useStore.getState().data.schedule.map((r) => r.id)).toEqual(['S-5']);
  });

  it('deleting a shift that hasn’t been sent yet just drops it', async () => {
    flow.answer = () => new Promise(() => {});
    useStore.setState({ authStage: 'pick' }); // queue paused
    const [row] = useStore.getState().upsertShifts([shift]);
    useStore.getState().removeShift(row.id);
    expect(useStore.getState().jobs).toHaveLength(0);
    expect(useStore.getState().data.schedule).toHaveLength(0);
    expect(flow.calls).toHaveLength(0);
  });

  it('an approval counts only once the flow confirms it, and the day says so meanwhile', async () => {
    let finish;
    flow.answer = (op, b) => new Promise((r) => { finish = () => r({ ...b, status: 'approved' }); });
    useStore.setState({ base: { ...useStore.getState().base, approvals: [] }, data: { ...useStore.getState().data, approvals: [] } });
    const done = useStore.getState().approveDay({ email: 'a@x.com', name: 'A', date: '2026-11-09', hours: 5, computed: 5, note: '' });
    expect(useStore.getState().approving['a@x.com|2026-11-09']).toBe('approved');
    expect(useStore.getState().data.approvals).toHaveLength(0);
    expect(useStore.getState().tasks).toHaveLength(1);
    await tick();
    finish();
    await done;
    expect(useStore.getState().data.approvals).toHaveLength(1);
    expect(useStore.getState().approving).toEqual({});
    await tick();
    expect(useStore.getState().tasks).toHaveLength(0);
  });

  it('a clock-in shows at once, and a clock-out right after waits for it', async () => {
    const order = [];
    let finishIn;
    flow.answer = (op, b) => { order.push(b.type); return b.type === 'in' ? new Promise((r) => { finishIn = () => r({ ...b, id: 'P-in', ts: '2026-11-09T15:00:05Z' }); }) : Promise.resolve({ ...b, id: 'P-out', ts: '2026-11-09T20:00:00Z' }); };
    useStore.setState({ base: { ...useStore.getState().base, punches: [] }, data: { ...useStore.getState().data, punches: [] } });
    const a = useStore.getState().punch({ type: 'in', email: 'a@x.com', name: 'A', station: 'Robot 1' });
    expect(useStore.getState().data.punches).toHaveLength(1);
    expect(useStore.getState().data.punches[0].pending).toBe(true);
    const b = useStore.getState().punch({ type: 'out', email: 'a@x.com', name: 'A' });
    await tick();
    expect(order).toEqual(['in']);
    finishIn();
    await a.saved;
    await b.saved;
    await tick();
    expect(order).toEqual(['in', 'out']);
    // The server's times replace the tap times.
    expect(useStore.getState().data.punches.map((p) => p.ts)).toEqual(['2026-11-09T15:00:05Z', '2026-11-09T20:00:00Z']);
  });

  it('a refused clock-in leaves the screen as it was', async () => {
    flow.answer = () => Promise.reject(Object.assign(new Error('Clock-in opens at 6:50 AM'), { status: 409, code: 'early' }));
    useStore.setState({ base: { ...useStore.getState().base, punches: [] }, data: { ...useStore.getState().data, punches: [] } });
    const { saved } = useStore.getState().punch({ type: 'in', email: 'a@x.com', name: 'A' });
    await expect(saved).rejects.toThrow('Clock-in opens');
    await tick();
    expect(useStore.getState().data.punches).toHaveLength(0);
  });
});
