import { toast } from 'sonner';
import { useStore } from '../lib/store.js';
import { experience } from '../lib/rules.js';
import { Select } from './ui.jsx';

// Lets an admin mark an operator Experienced or New, or leave it to completed
// sessions. Every pair needs at least one experienced operator.
export function ExperienceSelect({ op, sessions, className = 'sel-pill' }) {
  const { upsertUsers } = useStore();
  const x = experience(op, sessions);
  const save = async (v) => {
    try {
      await upsertUsers([{ ...op, experience: v }]);
      const now = experience({ ...op, experience: v }, sessions);
      toast(`${op.name}: ${now.level === 'new' ? 'New' : 'Experienced'}`, { description: v ? 'Set by you. Re-importing the roster keeps it.' : `Decided by completed sessions (${x.done}).` });
    } catch (err) {
      toast.error("Couldn't save", { description: err.message });
    }
  };
  return (
    <Select
      className={className}
      label={`Experience for ${op.name}`}
      value={op.experience || ''}
      onChange={save}
      options={[
        { value: '', label: `Auto · ${x.marked ? experience({ ...op, experience: '' }, sessions).level : x.level}`, hint: `${x.done} sessions` },
        { value: 'experienced', label: 'Experienced' },
        { value: 'new', label: 'New' },
      ]}
    />
  );
}
