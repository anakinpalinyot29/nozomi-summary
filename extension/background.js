/**
 * Nozomi SOAR Robot — background service worker.
 *
 * Sniffs the `vantage-org` request header off any /api/ request the Vantage SPA
 * fires (mirrors VantageSession._capture_org in the Python robot) and stashes
 * the latest value in session storage for the popup to read. Read-only
 * observation, which Manifest V3 permits.
 */

'use strict';

const ORG_HEADER = 'vantage-org';
const VANTAGE_URLS = ['https://*.vantage.nozominetworks.io/*'];

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (!details.url.includes('/api/')) return;
    const hdr = (details.requestHeaders || []).find(
      (h) => h.name.toLowerCase() === ORG_HEADER
    );
    if (hdr && hdr.value) {
      chrome.storage.session.set({
        vantageOrg: hdr.value,
        vantageOrgAt: Date.now(),
      });
    }
  },
  { urls: VANTAGE_URLS },
  ['requestHeaders', 'extraHeaders']
);
