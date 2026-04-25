# AdCheck Agent Guide

This file gives coding agents the minimum context needed to work safely and effectively in this repo.

## Project Overview

AdCheck is a Manifest V3 Chrome extension for validating ad tag implementations on publisher websites.

Current stack:

- TypeScript
- Chrome Extensions Manifest V3
- Vanilla HTML/CSS/JS runtime
- `chrome-types` for typed Chrome APIs

## Important Files

- `manifest.json`: extension manifest and permissions
- `src/background.ts`: service worker, network request tracking, tab state
- `src/content.ts`: floating widget, page checks, DOM interactions
- `src/popup.ts`: toolbar popup and settings persistence
- `src/shared/defaults.ts`: default settings and shared helpers
- `src/shared/types.ts`: shared TypeScript types
- `styles.css`: popup and in-page widget styling
- `popup.html`: popup markup
- `TODO.md`: deferred work and backlog notes
- `dist/`: unpacked extension build output

## Build And Validation

Use these commands from the repo root:

- `npm run typecheck`
- `npm run build`
- `npm run generate:icons`

When making code changes, prefer running `npm run typecheck` and `npm run build` before finishing.

## Working Conventions

- Keep the extension lightweight and framework-free unless explicitly requested otherwise.
- Prefer TypeScript changes in `src/` and regenerate `dist/` with `npm run build`.
- Preserve Manifest V3 compatibility.
- Keep UI copy understandable for non-technical users.
- Fix the smallest correct surface area first when addressing bugs.

## Safety Rules

- Do not run delete commands such as `rm`, `rm -rf`, or similar without explicit user permission for the current session.
- Do not read sensitive or `.gitignored` files such as `.env`, `.env.local`, or other ignored secrets without explicit user permission.
- Never revert user changes unless the user explicitly asks for that.

## Notes For Future Work

- Console error monitoring is intentionally deferred; check `TODO.md` before implementing it.
- The extension should respect persisted user settings, especially the global enable/disable state and widget collapsed state.
- For widget bugs, review both `src/content.ts` and `styles.css` together since behavior depends on both DOM updates and CSS interaction rules.
