# Behavior checks

Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`.
The Node test runner compiles source in memory and executes it with mocked Chrome
APIs. No test dependencies or production test hooks are added. Tests cover request
concurrency, navigation, redirects, tab closure, batched persistence, startup
restoration, storage failure recovery, pause, matching, cookies, DNR scope/regex
validation/limits, check coalescing, script cancellation, and backup validation.

## Browser fixtures

Run `node tests/browser-server.mjs`, then visit `/content` or `/popup` on port 8765.
These pages run the actual extension source with mocked Chrome storage and
messaging. They exercise DOM behavior without installing an extension. The fixture
server serves only an explicit allowlist of source assets.

Browser checks completed during this change:

- Override insert, edit, disable, re-enable, and invalid-selector recovery.
- Immediate window-global capability guidance, including checks awaiting a bundle.
- Full and settings-only export payloads.
- Import preview, per-hostname errors, merge, replacement, and skip-conflict results.
- One-click blocking disable updates stored configuration.

## Native Chrome checks

The browser fixture does not verify native Chrome extension APIs. Load `dist/` as
an unpacked extension to check these integration behaviors:

1. Enable AdCheck and configure a test script filename. Reload a publisher fixture
   with concurrent scripts, redirects, an HTTP 404, and a matching image. Only a
   successful script should pass. Inspect resource type, URL, HTTP status, and time.
2. Reload rapidly and close tabs during loads. After the worker becomes idle,
   refresh the widget and confirm redacted session history is restored.
3. Select a blocking hostname, save a valid route and an unsupported regex such as
   `/(?=ads)/`. Check row statuses and installed count. Compare requests on the
   selected site and another site, then pause, ignore, and disable all blocking.
4. Disable Allow User Scripts and configure a global check. Check immediate popup
   and widget guidance; enable access and reload the extension to verify recovery.

DNR validation and tab scoping follow the [Chrome DNR API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).
The permission audit follows the [Tabs API permission documentation](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions).
