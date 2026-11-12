# Research notes: iOS PWA + Apps Script sync

Date: 2026-11-12. Limitation: webkit.org and developers.google.com were NOT
reachable from this sandbox (DNS blocked), so no primary page was fetched
directly. Findings come from WebSearch result summaries that quote/cite
primary pages (WebKit blog, WebKit Bugzilla, Apple release notes, caniuse,
Apps Script quota table). Anything beyond that is labelled "needs check".
Confidence: Known = a primary source was cited by search results;
Hypothesis = consistent with sources/background but not confirmed here;
Unknown = not found.

## 1. iOS Home-Screen PWA storage

Short answer
- The 7-day cap on script-writable storage applies to Safari (browser tabs).
  WebKit's clarification: Home Screen web apps have their own usage counter
  that resets with actual use of the app, so normal use is not capped.
  Confidence: Known (WebKit blog, via search summaries; blog post date needs check, ~2020).
- Open contradictory user reports exist (WebKit bug 237350, Mar 2022: cookies
  of a Home Screen app deleted after 7 days). Concerns script-set cookies, not
  IndexedDB. Status: Unknown.
- Since Safari 17 / iOS 17 (Sept 2023) Storage API is fully supported; a
  Home Screen web app gets the same origin/overall quotas as the site in a
  tab. `navigator.storage.persist()` exists and requests are granted by
  heuristics, one of which is "is a Home Screen web app". Confidence: Known
  (webkit.org/blog/14403 "Updates to Storage Policy", via search summary).
  Third-party pages claiming persist() is "always denied" contradict this; ignore.
- Exact quota numbers (I recall roughly 60% of disk per origin in browser,
  smaller share for other apps) and whether non-persistent data can be
  evicted under disk pressure / long disuse: needs check. Treat IndexedDB as
  evictable cache, not the system of record.

Sources
- https://webkit.org/?p=14403 (Updates to Storage Policy, Sept 2023)
- https://bugs.webkit.org/show_bug.cgi?id=211775 (ITP 7-day cap, 2020)
- https://bugs.webkit.org/show_bug.cgi?id=237350 (Home Screen cookies, 2022)
- https://developer.apple.com/forums/thread/710157 (user thread, date needs check)

Implication
- Call `navigator.storage.persist()` at first launch; log the boolean result.
- Keep Google Sheet as the source of truth; local queue of unsynced entries
  is the only data at risk. Offer an in-app "export JSON" backup.
- Show unsynced count in the UI so data is not left sitting for weeks.

## 2. Apps Script web app from browser JS

Short answer
- Apps Script has no `doOptions`; an OPTIONS preflight gets a 405. So the
  request must be a CORS "simple" request: POST with
  `Content-Type: text/plain;charset=utf-8` and `JSON.stringify(...)` body, or a
  GET with query params. Use `fetch(url, {method:'POST', redirect:'follow', body})`.
  Confidence: Known (multiple developer sources; no official Google page fetched).
- /exec answers with a 302 to script.googleusercontent.com; fetch follows it.
  That the final response carries `Access-Control-Allow-Origin: *` so JS can
  read it: Hypothesis (widely reported, not confirmed in a primary doc here).
  One report of a CORS error on mobile Chrome despite text/plain: needs
  test on real iOS Safari.
- Return JSON via `ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON)`.
- Deploy "Execute as: Me, Who has access: Anyone". Anyone-with-the-URL can
  call it, so the shared token is the only gate: send it in the body (the
  script cannot read request headers in doPost/doGet), compare server-side,
  store it in Script Properties, reject otherwise. Reasonable for a personal
  app, but the token lives in the client; keep it out of the repo, avoid
  putting it in GET query strings (URLs get logged). Confidence: Hypothesis (design reasoning).
- Edits to the script need a new deployment version for /exec to change.
- Quotas: official table lists 30 simultaneous executions per user (all
  callers share it when running as the owner) and 20 triggers per user/script
  (Known, via search of the quota page). ~40 writes/month and rare 2000-row
  reads are far below any limit. Daily runtime/6-min execution caps: needs
  check on the official page (secondary sources say 6 min/execution).
- Concurrency: wrap writes in `LockService.getScriptLock().waitLock(10000)`
  and release in `finally`. Make writes idempotent with a client-generated
  UUID per entry (dedupe on append) since retries after a lost response are
  expected.

Sources
- https://developers.google.com/apps-script/guides/services/quotas (current)
- https://developers.google.com/apps-script/reference/lock/lock-service
- https://developers.google.com/apps-script/guides/web (not fetched; needs check)
- Community: https://groups.google.com/g/google-apps-script-community/c/zJpevovcFLA ; Stack Overflow "app script sends 405 response when trying to send a post request"

Implication
- Client: single `sync()` posting `{token, op, entries:[{id,...}]}` as text/plain.
- Server: token check, LockService, UUID dedupe, JSON out with `ok` field.

## 3. Vibration / haptics on iOS

Short answer
- `navigator.vibrate` is not implemented in WebKit/Safari (Safari's standards
  position is negative per Mozilla's tracker). Confidence: Known (Mozilla bug
  1653318 cites it; no WebKit primary page fetched). Feature-detect and no-op.
- `<input type="checkbox" switch>` gives a haptic tick on iOS. Apple's
  Safari 18 release notes list the haptic feedback; WebKit commits from
  Dec 2023 added it (some third parties say Safari 17.4). Confidence: Known
  for existence; exact first version: needs check.
- Reliability: it is a side effect, not a haptics API. The known trick is to
  call `.click()` / click a label on a hidden switch from a user gesture.
  Reports describe it working, but it could change or be removed; I have not
  verified it in a standalone Home Screen app. Confidence: Hypothesis.

Sources
- https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes
- https://lists.webkit.org/pipermail/webkit-changes/2023-December/294748.html
- https://bugs.webkit.org/show_bug.cgi?id=285120
- https://bugzilla.mozilla.org/show_bug.cgi?id=1653318
- https://github.com/ionic-team/ionic-framework/issues/29942

Implication
- Haptics = optional polish: `if (navigator.vibrate) navigator.vibrate(10) else hiddenSwitchLabel.click()`
  inside a tap handler, wrapped in try/catch. Never rely on it for feedback
  the user needs; pair with a visual confirmation. Test on device.

## 4. Web Audio and the silent switch

Short answer
- Yes: Web Audio output is muted when the ringer/silent switch is on (it is
  treated as ambient audio); media elements (`<audio>`) generally ignore the
  switch. WebKit bug 237322 (2022), reported worse from iOS 16.3. Current
  fix status: needs check. Confidence: Known (bug tracker) for the behaviour
  historically; Hypothesis that it still holds on current iOS.
- Workarounds seen: play a silent looping `<audio>` element alongside
  (unmute-ios-audio library); the Audio Session API was suggested by a
  WebKit commenter. Unverified here.
- Separate issue (bug 291892, 2025): reports that in Home Screen PWAs on
  iOS 26 Web Audio only works on first run. Status: needs check.
- AudioContext needs a user gesture to start/resume; also resume on
  visibilitychange (bug 263627).

Sources
- https://bugs.webkit.org/show_bug.cgi?id=237322
- https://bugs.webkit.org/show_bug.cgi?id=291892
- https://bugs.webkit.org/show_bug.cgi?id=263627
- https://github.com/feross/unmute-ios-audio

Implication
- Treat sounds as best-effort and silent-switch-respecting (arguably the
  desired behaviour for a money app). Do not depend on audio for feedback.
  If sounds are kept, create/resume the AudioContext inside a tap.

## 5. Service worker and Background Sync on iOS

Short answer
- Background Sync (SyncManager / `sync` event) is NOT available in Safari on
  iOS (caniuse: unsupported through iOS 26.5; WebKit bug 201866 from 2019 open
  in results). Confidence: Known (caniuse via search summary; page date not stated).
- Reliable pattern: foreground flush. Trigger `flushQueue()` on app start,
  `visibilitychange` -> visible, `online`, `pageshow`, and right after each save;
  plus a manual "Sync now" button. Serialise flushes with a lock flag, retry
  with backoff while open, mark entries synced only on a server `ok`.
  Confidence: Hypothesis (standard design, consistent with the above).
- Do not use Workbox BackgroundSync as the sole mechanism (a fallback issue
  was reported in Safari 13; needs check).
- `navigator.onLine` is unreliable; treat a failed fetch as offline.

Sources
- https://caniuse.com/background-sync
- https://bugs.webkit.org/show_bug.cgi?id=201866
- https://bugs.webkit.org/show_bug.cgi?id=182565
- https://github.com/GoogleChrome/workbox/issues/2386

Implication
- Queue in IndexedDB (entry UUIDs); flush from the page, not the service
  worker. Service worker is for app-shell caching only.

## Needs check (requires network access to primary hosts)
- Allow webkit.org and developers.google.com, then confirm: Home Screen
  exemption wording/date, quota percentages, eviction rules, exact /exec CORS
  headers (best: test with curl and a real iPhone), Apps Script runtime quotas.
