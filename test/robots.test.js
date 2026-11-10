import { describe, expect, it } from 'vitest';
import { CFG } from '../src/lib/config.js';
import { robotName, robotTitle, setRobotNames } from '../src/lib/robots.js';
import { robotLabel } from '../src/lib/schedule.js';
import { demo } from '../src/lib/api.js';

describe('robot names', () => {
  it('shows the name next to the robot, and only the robot when it has none', () => {
    CFG.robotNames = { 'Robot 3': 'franka-thor-02' };
    setRobotNames({});
    expect(robotTitle('Robot 3')).toBe('Robot 3 · franka-thor-02');
    expect(robotTitle('Robot 9')).toBe('Robot 9');
    expect(robotLabel({ station: 'Robot 3' })).toBe('Robot 3 · franka-thor-02');
    expect(robotLabel({ station: '' })).toBe('Any robot');
  });

  it('names saved in Settings win over config.js, even when cleared', () => {
    CFG.robotNames = { 'Robot 1': 'Stationary', 'Robot 3': 'franka-thor-02' };
    setRobotNames({ 'Robot 1': '  Mobile ', 'Robot 3': '' });
    expect(robotName('Robot 1')).toBe('Mobile');
    expect(robotTitle('Robot 3')).toBe('Robot 3');
    setRobotNames(null);
    expect(robotName('Robot 1')).toBe('Stationary');
  });

  it('demo mode saves the names and keeps them in the audit trail', () => {
    const saved = demo.robotNames({ 'Robot 4': 'jetson-thor-004' });
    expect(saved).toEqual({ 'Robot 4': 'jetson-thor-004' });
    const d = demo.load();
    expect(d.robotNames['Robot 4']).toBe('jetson-thor-004');
    expect(d.audit.at(-1)).toMatchObject({ action: 'robot_names', target: 'robots' });
  });
});
