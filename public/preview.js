// Operator preview, opened by staff from the admin sidebar (?preview=operator).
// It runs in its own tab on demo data only: the flow addresses are blanked so nothing
// reaches SharePoint or email, and this tab keeps everything in sessionStorage, so it
// can't touch the real sign-in or data cache in the staff member's other tabs.
(function () {
  if (new URLSearchParams(location.search).get('preview') !== 'operator') return;
  try { Object.defineProperty(window, 'localStorage', { value: window.sessionStorage, configurable: true }); } catch (e) { /* keep going: no flow URLs below */ }
  var c = (window.ONSITE_CONFIG = window.ONSITE_CONFIG || {});
  c.readUrl = ''; c.writeUrl = ''; c.authUrl = ''; c.preview = true;
})();
