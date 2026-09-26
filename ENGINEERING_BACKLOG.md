# AdCheck Engineering Backlog

This file is a handoff-ready list of bugs and feature opportunities found during a static code review. Each item explains why the work matters and gives a concrete finish line so another engineer or agent can pick it up without rediscovering the problem.

Priorities use this scale:

- **P0:** Core results can be wrong, data can be lost, or normal browsing can be affected.
- **P1:** Important reliability or usability problem with a reasonable workaround.
- **P2:** Product improvement, maintainability work, or lower-risk correctness issue.

## P0: Make Network Tracking Atomic Across Concurrent Requests

**Problem:** `webRequest` callbacks update the same per-tab state asynchronously. Two requests that finish together can read the same old state and overwrite each other. A late event from the previous navigation can also appear in the new page's history.

**Why it matters:** Missing or stale requests produce intermittent false results in the extension's primary ad-tag check.

**Suggested approach:** Serialize updates per tab or use one in-memory reducer, and assign each navigation a generation that is attached to pending requests.

**Acceptance criteria:**

- Parallel request starts and completions never lose history entries.
- A navigation discards late events from the previous document.
- Closing a tab clears both cached state and pending request records.
- Tests cover concurrent requests, rapid reloads, redirects, and tab closure.

**Relevant code:** `src/background.ts` request listeners and `handleBeforeRequest`/`finalizeRequest`.

## P0: Distinguish Successful Script Loads From Failed or Unrelated Requests

**Problem:** A completed URL match is treated as a pass without retaining its HTTP status. Broad substring matching also allows an image, XHR, or query parameter to satisfy a configured script check.

**Why it matters:** A `404` response or an unrelated resource can make a broken ad implementation look healthy.

**Suggested approach:** Store HTTP status and resource type, default bundle checks to script resources, and define explicit match modes such as filename, URL substring, and regular expression.

**Acceptance criteria:**

- HTTP `4xx` and `5xx` responses do not pass by default.
- A matching image or XHR cannot satisfy a script-only check.
- Network errors and intentionally blocked requests become terminal results promptly.
- The widget shows status code, resource type, matched URL, and load duration.

**Relevant code:** `src/background.ts`, `src/content.ts` bundle result construction, and existing `TODO.md` network-status note.

## P0: Stop Background Request Storage Work While AdCheck Is Paused

**Problem:** The extension observes all HTTP(S) requests and persists tab state even when the global toggle says AdCheck is paused or no bundle checks are configured.

**Why it matters:** Busy pages can cause unnecessary service-worker wakeups and session-storage writes across every open tab.

**Suggested approach:** Short-circuit request tracking when disabled, retain only requests needed by configured checks, and debounce persistence and update messages.

**Acceptance criteria:**

- Paused AdCheck performs no request-state writes.
- Unrelated requests are not retained when there are no bundle checks.
- Bursts are persisted in bounded batches rather than once per event.
- Storage failures are caught and do not stop later tracking.

**Relevant code:** `src/background.ts` web request listeners and tab-state persistence.

## P1: Make Site Override Updates Reversible

**Problem:** Disabling, deleting, or editing an override disconnects its observer but leaves injected markup and target markers on the page. The marker can then prevent an updated override from applying.

**Why it matters:** Users can see old and new configurations mixed together and may need to reload the page to recover.

**Suggested approach:** Assign an application ID, track every inserted node, remove reversible markup on changes, and then apply the newest rule once. Script side effects should be documented as requiring a reload because they cannot generally be undone.

**Acceptance criteria:**

- Editing an override replaces its old injected markup without duplicates.
- Disable and delete remove reversible nodes and markers.
- Re-enabling applies the rule once without a page reload.
- Invalid selectors show a useful error and never prevent the widget from starting.

**Relevant code:** `src/content.ts` site override synchronization, application, and teardown.

## P1: Scope Blocked Routes Clearly and Respect Pause/Ignore State

**Problem:** Dynamic blocking rules currently apply browser-wide. They are not restricted by site, tab, or resource type and can remain active while AdCheck appears paused or a domain is ignored.

**Why it matters:** A broad pattern can silently break unrelated websites and be difficult to diagnose.

**Suggested approach:** Prefer site-scoped rules or offer an explicit global/site scope control. Define and enforce how pause and ignored domains affect blocking.

**Acceptance criteria:**

- The popup states the effective scope before blocking is enabled.
- Pause and ignored-domain behavior is consistent and tested.
- The popup displays how many rules Chrome installed.
- Users have a reliable one-click way to disable all AdCheck blocking.

**Relevant code:** `src/background.ts` DNR rule generation and `src/popup.ts` blocked-route settings.

## P1: Validate Blocked-Route Regexes With Chrome's DNR Engine

**Problem:** Validation uses JavaScript `RegExp`, but Chrome DNR supports a smaller RE2-style syntax. An invalid regex can silently become a different `urlFilter`, while rejected or truncated rules are only reported in the service-worker console.

**Why it matters:** The UI can claim a rule was saved even though Chrome did not install the intended rule.

**Suggested approach:** Use `chrome.declarativeNetRequest.isRegexSupported`, never reinterpret an invalid regex as a URL filter, and return per-rule synchronization status to the popup.

**Acceptance criteria:**

- Invalid and unsupported patterns are identified beside their input row.
- Regex flags and case behavior are explicit and documented.
- Existing valid rules remain installed when a new rule is invalid.
- The UI distinguishes saved, installed, disabled, invalid, and omitted-due-to-limit states.

**Relevant code:** `src/background.ts` blocked-route parsing/sync and `src/popup.ts` save feedback.

## P1: Explain User-Script Access Failures in Window Global Checks

**Problem:** Window global inspection depends on `chrome.userScripts`, but capability failures surface as a generic missing result or as copy that only mentions inline site overrides.

**Why it matters:** A real page global can look missing when the actual issue is a disabled Chrome permission.

**Suggested approach:** Preflight the capability whenever global checks are configured and show feature-specific remediation in both the popup and widget.

**Acceptance criteria:**

- Missing user-script access produces an immediate capability error, not a delayed false negative.
- Guidance explicitly mentions window global inspection.
- The popup warns before saving global checks that cannot run.
- Checks recover after access is enabled and the extension is reloaded.

**Relevant code:** `src/background.ts` `readWindowGlobals`, `src/content.ts` global checks, and `src/popup.ts` permission warning.

## P1: Prevent Overlapping Check Runs From Rendering Stale Results

**Problem:** Polling, network notifications, and manual refresh can start checks concurrently. A slower older run can finish last and overwrite newer state.

**Why it matters:** Results can flicker or regress, especially when several window globals are read serially.

**Suggested approach:** Use a single-flight runner with a generation token. Coalesce refresh requests while one run is active and discard obsolete results.

**Acceptance criteria:**

- Only one check run is active per frame.
- Repeated network notifications queue at most one follow-up run.
- Manual refresh supersedes stale work.
- Runs started before settings, enablement, or ignore-state changes cannot update the UI.

**Relevant code:** `src/content.ts` polling, network message handling, and `runChecks`.

## P1: Decode Malformed Cookie Values Without Aborting All Checks

**Problem:** Cookie values are passed directly to `decodeURIComponent`. A malformed percent escape can throw and abort construction of the entire page snapshot.

**Why it matters:** One unrelated cookie can leave every check stale or empty.

**Suggested approach:** Decode each cookie defensively and fall back to its raw value when decoding fails.

**Acceptance criteria:**

- Invalid encoding in one cookie does not interrupt another check group.
- The malformed cookie remains detectable through its raw value.
- Tests cover empty values, embedded `=`, encoded delimiters, and invalid `%` sequences.

**Relevant code:** `src/content.ts` cookie parsing.

## P2: Add Site Overrides to Versioned Import and Export

**Opportunity:** Current backup JSON includes synced settings but excludes hostname-specific selectors and tag snippets, even though those are often the hardest settings to recreate.

**Suggested approach:** Add a versioned full-backup format with separate choices for settings-only and settings-plus-overrides. Do not include transient network history or picker hover state.

**Acceptance criteria:**

- Users choose between settings-only and full configuration export.
- Import previews affected hostnames and supports merge, replace, and skip-conflict behavior.
- Invalid entries are reported per hostname without blocking valid entries.
- Existing settings-only exports remain importable.

**Relevant code:** `src/popup.ts` import/export and `src/shared/defaults.ts` storage keys.

## P2: Align Privacy Copy With Chrome Sync and Request Retention

**Problem:** Settings are stored with Chrome Sync and recent full request URLs are stored in session state, while the privacy copy broadly says information remains on-device and focuses on the current page.

**Why it matters:** Full URLs can contain identifiers or query data, and inaccurate wording creates user-trust and store-review risk even when AdCheck sends nothing to its own servers.

**Suggested approach:** Document each storage area and retention period, redact unnecessary URL components, and audit whether both `tabs` and `activeTab` remain necessary.

**Acceptance criteria:**

- Privacy documentation explains sync settings, local overrides, and temporary request state.
- It clearly states that no data is transmitted to an AdCheck-controlled service.
- Sensitive URL parts are not retained unless required for matching or display.
- Every manifest permission is removed or explicitly justified.

**Relevant code:** `PRIVACY.md`, `manifest.json`, `src/background.ts`, and popup persistence.

## Cross-Cutting Test Foundation

The repository currently has typecheck and build commands but no automated behavior tests. Add a lightweight test runner with mocked Chrome APIs as part of the first backlog item that needs it. Prioritize pure tests around DNR parsing, settings normalization, network state transitions, cookie parsing, and site override sequencing before attempting full browser automation.
