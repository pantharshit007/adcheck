# AdCheck Backlog & Roadmap

Incremental roadmap ordered from quick wins to larger features, with **Shadow DOM isolation** prioritized first.

---

## Priority Next

- [ ] **#7 — Shadow DOM isolation for the widget + Dark Mode support** (`src/content.ts`, `styles.css`, `manifest.json`)
  - Mount the floating widget inside a Shadow DOM root with `all: initial` on the host so host-page CSS resets, fonts, and `!important` rules can no longer break widget layout or button alignment.
  - Add clean Light / Dark / Auto theme support for dark-mode websites once isolated.

---

## Tier 1 — Quick Wins

- [ ] **#1 — Popup version footer & unsaved-changes indicator** (`popup.html`, `src/popup.ts`)
  - Show the current extension version from `chrome.runtime.getManifest().version` at the bottom of the popup.
  - Highlight **Save settings** when form inputs have unsaved edits and add `Cmd/Ctrl+S` save support.
- [ ] **#2 — Active blocked-route banner in the widget** (`src/content.ts`)
  - Show a compact indicator (e.g., *"2 routes blocked"*) when route blocking is active so stale block rules don't cause confusion while debugging.
- [ ] **#3 — Duplicate bundle load warning** (`src/content.ts`)
  - Surface a badge (e.g., `Loaded 2×`) when a configured bundle script is requested more than once on the same page.
- [ ] **#4 — Expandable values & copy buttons in the widget** (`src/content.ts`)
  - Allow expanding truncated cookie values, localStorage values, and matched bundle URLs (reusing the Window Globals `<details>` pattern).
  - Add one-click copy buttons for values, paths, attribute chips, and URLs.
- [ ] **#5 — "Failed only" filter & collapsible groups in the widget** (`src/content.ts`)
  - Add an `All / Failed` filter pill in the widget header and collapsible result groups for faster triage.
- [ ] **#6 — Keyboard shortcut to toggle the widget** (`manifest.json`, `src/background.ts`, `src/content.ts`)
  - Add a Chrome `commands` shortcut (e.g., `Alt+Shift+A`) to expand/collapse the widget without using the mouse.
- [ ] **Docs & README polish** (`README.md`, `docs/`)
  - Add `target="_blank" rel="noopener noreferrer"` to the extension install button in docs and README.
  - Keep `docs/` updated as new features ship.

---

## Tier 2 — Medium Lift

- [ ] **#8 — One-click "Copy QA Report"** (`src/content.ts`)
  - Copy a clean Markdown/plain-text summary (page URL, timestamp, pass/fail breakdown, load times, active overrides/blocked routes) ready for Slack, Jira, or publisher emails.
- [ ] **#9 — Window globals reliability & multi-dependency upgrade** (`src/background.ts`, `src/content.ts`, `src/popup.ts`)
  - Batch all global path reads into a single `chrome.userScripts.execute` call instead of one per path.
  - Support bracket notation (`pbjs.adUnits[0].code`, `obj["a.b"]`) in addition to dot paths.
  - Support multiple bundle dependencies per window global (instead of only one).
  - Investigate and fix false negatives where a loaded player's window object still reports as not found (including friendly-iframe scanning and `null` vs `undefined` handling).
- [ ] **#10 — Jump-to-element for class names & attributes + SPA re-checks** (`src/content.ts`)
  - Add "Jump (1/N)" element cycling and highlighting for `classNames` and `attributes`.
  - Re-run checks automatically on SPA route transitions (`currententrychange`).
- [ ] **#11 — Manage all site overrides & editable CSS selectors** (`src/popup.ts`, `src/content.ts`)
  - Show an overview list of all saved site overrides across domains with quick toggle/delete controls.
  - Allow editing the picked CSS selector directly and supporting multiple overrides per hostname.
- [ ] **#12 — Configurable check timeouts / per-type retries** (`src/shared/defaults.ts`, `src/content.ts`)
  - Support individual refresh/retry counts per check type (e.g., bundles `[10]`, page elements `[5]`, class names `[4]`, cookies `[4]`, attributes `[3]`, localStorage `[5]`) so delayed/lazy-loaded requests don't require manual refreshes.

---

## Tier 3 — Larger / Flagship Features

- [ ] **#13 — Expected-value assertions & non-script network checks** (`src/shared/types.ts`, `src/background.ts`, `src/content.ts`, `src/popup.ts`)
  - Allow optional expected-value matching (exact, contains, regex) for attributes, cookies, localStorage, and window globals.
  - Allow network checks to match optional resource types (`script`, `xhr/fetch`, `image/pixel`, `any`) while keeping `script` as the default.
- [ ] **#14 — Named profiles / presets** (`src/shared/types.ts`, `src/popup.ts`, `src/content.ts`)
  - Save and switch between named check configurations (e.g., *GAM + Prebid*, *Video Player*, *Client A*) with optional domain auto-matching.
- [ ] **#15 — Ad-related console error & warning monitoring** (`src/background.ts`, `src/content.ts`)
  - Capture page warnings/errors in a Manifest V3-safe way (`MAIN` world bridge or listener) without breaking site behavior.
  - Define a first-pass heuristic for ad-related errors vs. general page noise.
  - Surface deduplicated messages in the widget with severity and plain-English guidance.
  - Test against noisy pages, repeated errors, and cross-frame behavior.
- [ ] **#16 — Visual ad-slot overlay mode** (`src/content.ts`)
  - Toggleable on-page overlay outlining all matched `domIds`, `classNames`, and `attributes` with live dimensions (`300×250` vs. collapsed `0×0`) and visibility state.
- [ ] **#17 — Ad-tech quick checks (optional toggles)** (`src/content.ts`, `src/popup.ts`)
  - Add `sessionStorage` key checks, CMP/consent detection (`__tcfapi`, `__uspapi`, `__gpp`), and an on-demand `/ads.txt` checker.
- [ ] **#18 — Popup HTML template cleanup** (`popup.html`, `src/popup.ts`)
  - Move popup section HTML string literals out of `src/popup.ts` into `<template>` elements or modular helpers.

---

## Notes & Ideas

- [ ] Experiment with bold border/shadow styling on `.adcheck-button`.
- [ ] Head override support was removed because script tags in that input freeze the page and do not recover cleanly on refresh; if revisited, keep it strictly HTML-only or split into a safe non-script path.
- [ ] Review DNR session-rule network blocking flow in `src/background.ts` and test natively in Chrome (`tests/README.md`).

---

## Completed

- [x] Fix host-page font breakage causing widget loader and side-swap button vertical jitter (tested on [summitpost.org](https://www.summitpost.org/)).
- [x] Check HTTP status codes and network failures for bundle requests instead of only checking whether the request was made.
- [x] Re-check alert logic when `Allow User Scripts` is disabled for site overrides and window globals.
- [x] Add a diagonal "Dev Build" ribbon to distinguish development builds from production builds.
- [x] Complete PR #5 (`fix/engineering-backlog`): atomic network tracking, paused-state short-circuiting, reversible site overrides, DNR session rules with regex validation, single-flight check runner, safe cookie decoding, privacy/permission cleanup, and automated tests.
