# AdCheck Backlog

## Console Error Monitoring
- Capture page warnings and errors in a Manifest V3-safe way without breaking site behavior.
- Define the first-pass heuristic for what counts as "ad-related" versus general page noise.
- Decide whether the safest implementation is a `MAIN` world bridge, a page-injected listener, or another messaging approach.
- Design the widget treatment for surfaced messages, including severity, plain-English guidance, and deduplication.
- Add testing notes for noisy pages, repeated errors, and cross-frame behavior.
