# AdCheck Engineering Backlog

All P0, P1, and P2 engineering reliability items from the September 27, 2026 static code review were implemented and merged into `main` via PR #5 (`fix/engineering-backlog`).

## Completed & Merged (PR #5)

- **Atomic network tracking:** Synchronous in-memory reducer, navigation-scoped pending requests, and ordered batched session persistence with URL redaction.
- **Accurate bundle checks:** Script-only matching with HTTP status validation (`2xx`/`3xx` pass, `4xx`/`5xx` and network errors fail), `filename:` / `url:` / `regex:` modes, live re-evaluation on edited names, and Resource Timing fallback.
- **Paused-state efficiency:** Short-circuited request tracking and session writes when paused, ignored, or when no bundle checks are configured.
- **Reversible site overrides:** Tracked injected nodes, reversible markup updates/teardown, cancelled pending script steps, and surfaced selector errors.
- **Blocked routes & DNR validation:** Session rules respecting pause and ignored domains, per-rule checkboxes, instant master toggle, migration from legacy dynamic rules, and `declarativeNetRequest.isRegexSupported` validation with per-rule UI status.
- **Window globals & cookie safety:** User-script capability preflighting, single-flight check runner with stale-result discarding, and defensive cookie decoding.
- **Privacy & test foundation:** Updated privacy docs, removed redundant `tabs` and `activeTab` permissions, and added automated behavior tests (`npm test`).

> **Decision note:** Site overrides intentionally remain device-local and excluded from settings JSON export/import.

## Remaining Open Items

- [ ] **Native Chrome integration verification:** Exercise live unpacked extension loading, DNR session-rule enforcement, and `userScripts` execution end-to-end in Chrome using the checklist in [tests/README.md](tests/README.md).
