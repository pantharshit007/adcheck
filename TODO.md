# AdCheck Backlog

_ignore this for now_

## Console Error Monitoring

- Capture page warnings and errors in a Manifest V3-safe way without breaking site behavior.
- Define the first-pass heuristic for what counts as "ad-related" versus general page noise.
- Decide whether the safest implementation is a `MAIN` world bridge, a page-injected listener, or another messaging approach.
- Design the widget treatment for surfaced messages, including severity, plain-English guidance, and deduplication.
- Add testing notes for noisy pages, repeated errors, and cross-frame behavior.

---

- [ ] just random thought, try styling the button with crazy broder and shadows `adcheck-button`.
- [x] There is a bug here. On normal sites it looks fine, but on some sites the font breaks, which causes other things like the loader and the side swap button to move up and down when the user clicks on it. Check into it. [summitpost.org](https://www.summitpost.org/)
- [ ] Fix styling for Dark Mode websites.
- [ ] we can set individual refresh count for each of checks: bundles [10], page element [5], class name [4], cookie [4], attribute [3], localstorage [5], now if anyone of the checks here are still failing we will refresh internally that many times in a constant period to ensure we won't miss just because the action was delayed. For ex: some time the network call is delayed but by that time our first time refresh check is already complete and user had to manually refresh it to check again.
- [ ] add a check that it should not only check for network if the call is made, also check the status returned what if the call failed/blocked.
- [ ] clean up the popup settings section HTML string rendering by moving the section markup out of the TS file or integrating it into a more maintainable template system.
- [ ] can introduced multi dependency on the window object, instead of only one.
- [ ] head override support was removed because script tags in that input freeze the page and do not recover cleanly on refresh; if revisited, document that it is HTML-only or split it into a strictly safe non-script path.
- [x] re-check the logic for showing an alert when allow user scripts setting is disabled, since currently it doesn't show it when my allow user scripts is disabled for the current site override setting.
- [x] Is there any way to add like a diagnal banner or something to tell the developer that this is a development build and not a production build?
- [ ] create a comprehensive documentation for the extension.
- [ ] add current version to the popup at the bottom or any other place.

---

- [ ] get an understanding of how the network blocking works.
