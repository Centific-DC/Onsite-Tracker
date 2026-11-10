import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LOCATIONS } from '../lib/config.js';
import { robotNames } from '../lib/robots.js';
import { useStore } from '../lib/store.js';
import { Group, Sheet } from './ui.jsx';

// Settings → Robots (admins). A name for each robot, like its host name. The robot
// keeps its id ("Robot 3") in every record, so renaming never changes past hours.
export function RobotNamesSheet({ open, onOpenChange }) {
  const saveRobotNames = useStore((s) => s.saveRobotNames);
  const [names, setNames] = useState({});
  useEffect(() => { if (open) setNames(robotNames()); }, [open]);
  const ids = LOCATIONS.flatMap((l) => l.robots);
  const changed = ids.some((id) => (names[id] || '').trim() !== (robotNames()[id] || ''));

  const save = () => {
    const out = Object.fromEntries(ids.map((id) => [id, (names[id] || '').trim()]));
    onOpenChange(false);
    saveRobotNames(out).then(
      () => toast('Robot names saved'),
      (e) => toast.error('Robot names didn’t save', { description: e.message }),
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Robots"
      description="Give each robot a name, like its host name. It shows next to the robot everywhere. Past hours and exports keep the robot’s number."
      footer={<button type="button" className="btn btn-primary btn-block" disabled={!changed} onClick={save}>Save</button>}
    >
      {LOCATIONS.map((l) => (
        <Group key={l.id} title={l.name}>
          {l.robots.map((id) => (
            <label key={id} className="field-row">
              <span>{id}</span>
              <input
                value={names[id] || ''}
                onChange={(e) => setNames((n) => ({ ...n, [id]: e.target.value }))}
                placeholder="Not named yet"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={60}
              />
            </label>
          ))}
        </Group>
      ))}
    </Sheet>
  );
}
