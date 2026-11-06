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
});
