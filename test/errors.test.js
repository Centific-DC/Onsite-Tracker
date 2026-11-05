import { describe, expect, it } from 'vitest';
import { errorText } from '../src/lib/api.js';

describe('flow error text', () => {
  it('reads both the flow’s and Power Automate’s error shapes', () => {
    expect(errorText({ error: 'Please sign in again.' }, 401)).toBe('Please sign in again.');
    expect(errorText({ error: { code: 'NoResponse', message: 'The server did not receive a response from an upstream server.' } }, 502)).toBe('The server did not receive a response from an upstream server. (NoResponse)');
    expect(errorText({ error: { code: 'WorkflowNotEnabled' } }, 400)).toBe('(WorkflowNotEnabled)');
    expect(errorText({ message: 'Locked' }, 401)).toBe('Locked');
    expect(errorText({}, 500)).toBe('The flow answered 500.');
  });
});
