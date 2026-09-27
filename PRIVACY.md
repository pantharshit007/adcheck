# AdCheck Privacy Policy

Last updated: September 27, 2026

AdCheck sends no data to an AdCheck-controlled service and uses no analytics.
It inspects pages to perform the checks you configure.

## Storage and retention

- **Chrome Sync:** check names and patterns, ignored domains, blocking settings,
  and widget preferences remain until you change or clear them. Chrome may sync
  these settings through your Google account when Chrome Sync is enabled.
- **Local extension storage:** hostname-specific selectors and override snippets
  remain until deleted, replaced by an import, or the extension is uninstalled.
  Picker selections also stay locally until cleared. They are not in backups.
- **Session storage and worker memory:** up to 200 completed matching script
  requests per tab plus matching requests still in flight. History clears on
  navigation, tab closure, tracking-setting changes, or the end of Chrome's session
  (including extension reload). Session storage preserves it across service-worker
  suspension. Writes and page notifications are batched at most once per 100 ms
  per active tab; pausing cancels queued writes and clears tracked state. Legacy
  unredacted session history from older versions is discarded on worker startup.
- **Page memory:** visible check results can contain cookie values, local-storage
  values, and inspected globals. They disappear when the page is closed or
  reloaded; they are not included in configuration backups.

Network matching briefly uses the original URL. Retained and displayed URLs omit
credentials, query strings, and fragments. Paths, status codes, resource types,
matched check names, and durations are retained for diagnosis. Paths and configured
patterns can themselves contain identifiers, so choose them accordingly.

## Backups and user-provided scripts

Settings-only exports contain Chrome Sync configuration. Full exports also contain
local site overrides. Both are ordinary files under your control, without network
history or picker state. Imports preview hostnames and let you merge, replace, or
skip conflicting overrides. Treat snippets as executable code: injected scripts
can make network requests and interact with the publisher page. External script
fallback loading may fetch a URL you configured. This is distinct from AdCheck
sending telemetry. Removing an override removes its tracked markup; already-run
script effects require reloading the page.

## Permissions

- `storage`: save synced settings and local overrides, and retain temporary redacted request history.
- `webRequest`: observe matching script starts, responses, and failures.
- `userScripts`: execute configured override scripts and inspect window globals in
  the page context, with Chrome's user-script access enabled.
- `declarativeNetRequest`: install site-scoped blocking rules. Only subresources in
  eligible tabs on the selected exact hostname are blocked; pause and ignored
  domains disable these rules. The popup can disable all blocking immediately.
- HTTP/HTTPS host access: inject the widget, observe requests, inspect page context,
  fetch configured external scripts, and read eligible tab URLs for site scope.
  Separate `tabs` and `activeTab` permissions are unnecessary with this host access
  and have been removed.

Questions can be directed to the publisher through the project repository.
