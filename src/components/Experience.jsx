import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { experience } from '../lib/rules.js';

// Lets an admin mark an operator Experienced or New, or leave it to completed
// sessions. Every pair needs at least one experienced operator.
export function ExperienceSelect({ op, sessions, className = 'exp-select' }) {
  const { upsertUsers } = useStore();
  const x = experience(op, sessions);
  const save = async (e) => {
    const v = e.target.value;
    try {
      await upsertUsers([{ ...op, experience: v }]);
      const now = experience({ ...op, experience: v }, sessions);
      toast(`${op.name}: ${now.level === 'new' ? 'New' : 'Experienced'}`, { description: v ? 'Set by you. Re-importing the roster keeps it.' : `Decided by completed sessions (${x.done}).` });
    } catch (err) {
      toast.error("Couldn't save", { description: err.message });
    }
  };
  return (
    <select className={className} value={op.experience || ''} onChange={save} onClick={(e) => e.stopPropagation()} aria-label={`Experience for ${op.name}`}>
      <option value="">Auto · {x.marked ? (experience({ ...op, experience: '' }, sessions).level) : x.level}</option>
      <option value="experienced">Experienced</option>
      <option value="new">New</option>
    </select>
  );
}
