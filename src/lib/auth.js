import { CFG } from './config.js';

// Sign-in. With `auth.clientId` and `auth.tenantId` set in public/config.js, everyone
// signs in with their own Microsoft (Entra ID) work account, and each flow call
// carries their token, so the flows know who is asking and check their role.
// Without them the app is in demo sign-in: you pick who you are, labelled demo.

const A = CFG.auth || {};
export const MS_AUTH = !!(A.clientId && A.tenantId);
// Power Automate's resource; the trailing slash is part of it.
const SCOPES = A.scopes || ['https://service.flow.microsoft.com//.default'];

let msal = null;
async function client() {
  if (msal) return msal;
  const { PublicClientApplication } = await import('@azure/msal-browser');
  msal = new PublicClientApplication({
    auth: { clientId: A.clientId, authority: `https://login.microsoftonline.com/${A.tenantId}`, redirectUri: location.origin + location.pathname },
    cache: { cacheLocation: 'localStorage' },
  });
  await msal.initialize();
  const r = await msal.handleRedirectPromise();
  if (r?.account) msal.setActiveAccount(r.account);
  else if (!msal.getActiveAccount() && msal.getAllAccounts()[0]) msal.setActiveAccount(msal.getAllAccounts()[0]);
  return msal;
}

// The signed-in Microsoft account, or null.
export async function msAccount() {
  if (!MS_AUTH) return null;
  const c = await client();
  const a = c.getActiveAccount();
  return a ? { email: String(a.username || '').toLowerCase(), name: a.name || a.username } : null;
}

export async function msSignIn() {
  const c = await client();
  await c.loginRedirect({ scopes: SCOPES, prompt: 'select_account' });
}

export async function msSignOut() {
  const c = await client();
  await c.logoutRedirect({ account: c.getActiveAccount() });
}

// A bearer token for the flows; null in demo sign-in.
export async function flowToken() {
  if (!MS_AUTH) return null;
  const c = await client();
  const account = c.getActiveAccount();
  if (!account) throw new Error('Not signed in');
  try {
    return (await c.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
  } catch {
    await c.acquireTokenRedirect({ scopes: SCOPES, account });
    return null;
  }
}

// Which screens each role opens. A person can hold several roles.
export const ROLES = {
  operator: 'Operator',
  scheduler: 'Scheduler',
  approver: 'Approver',
  reporting: 'Reporting',
};
export const hasRole = (session, ...roles) => !!session && roles.some((r) => (session.roles || []).includes(r));
