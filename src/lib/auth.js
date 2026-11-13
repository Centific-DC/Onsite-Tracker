// Roles. Everyone signs in with a username and password that a Lotus admin gave
// them (src/lib/auth/, the Lotus Auth flow); every Read and Write call carries the
// sign-in token, so the flows know who is asking and check their role there.

// Which screens each role opens. A person can hold several roles.
export const ROLES = {
  operator: 'Operator',
  scheduler: 'Scheduler',
  approver: 'Approver',
  reporting: 'Reporting',
  admin: 'Admin',
};
export const ROLE_NOTE = {
  operator: 'Clocks in; sees only their own shifts and time',
  scheduler: 'Schedule, Roster and schedule emails',
  approver: 'Review and approve hours',
  reporting: 'Approved-hours reports',
  admin: 'Sign-ins: adds people, sets roles, resets passwords',
};
/** The office roles. Anyone holding one of these is staff and is listed on Users. */
export const STAFF_ROLES = ['scheduler', 'approver', 'reporting', 'admin'];
/** Staff sign-ins only: operator-only sign-ins are managed on the Roster, not Users. */
export const staffSignIns = (users = []) => users.filter((u) => (u.roles || []).some((r) => STAFF_ROLES.includes(r)));
export const hasRole = (session, ...roles) => !!session && roles.some((r) => (session.roles || []).includes(r));
