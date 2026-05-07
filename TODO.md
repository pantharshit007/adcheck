# AdCheck Backlog

_ignore this for now_

## Console Error Monitoring

- Capture page warnings and errors in a Manifest V3-safe way without breaking site behavior.
- Define the first-pass heuristic for what counts as "ad-related" versus general page noise.
- Decide whether the safest implementation is a `MAIN` world bridge, a page-injected listener, or another messaging approach.
- Design the widget treatment for surfaced messages, including severity, plain-English guidance, and deduplication.
- Add testing notes for noisy pages, repeated errors, and cross-frame behavior.

---

- [x] current implementation of Hiding the pannel similar to accordion style is very bad, need to improve that. _(fade-up animation on editor reveal; chevron accordion on settings sections)_
- [x] currently if the user clicks on delete overide, it deletes it saves it and hide the details, it shouldn't move to hide detils phase yet. _(editor stays open after delete)_
- [x] Also, the implementaion of Enable Overide checkbox and the placement selector is wierd, improve that the checkbox shows native checked state and same for selector make it suit more to the ui and polished. _(custom toggle + styled select wrapper with chevron)_
- [x] we can also put the selected element info in a code block of sort i think this will make it more visible and understandable for the user. _(selection shown in monospace code block)_
- [x] since all other panels are multi input oriented they too can get huge in height alone if muliple cases are added, for ex lets say in the bundle panel if we have 5 bundles then the panel will be very long, so we can also implement the accordion style for all panels apart from import/export panel since it has its own implementation. One thing to note we dont need to add hide/show details ui for these a simple click to show details and click again to hide details will do the work, we can also add a small icon to indicate that the element is clickable and has more details to show. _(chevron accordion per section; count badge; starts expanded only when has values)_

- [ ] just random thought, try styling the button with crazy broder and shadows `adcheck-button`.
- [ ] There is a bug here. On normal sites it looks fine, but on some sites the font breaks, which causes other things like the loader and the side swap button to move up and down when the user clicks on it. Check into it. [summitpost.org](https://www.summitpost.org/)
- [ ] Fix styling for Dark Mode websites.
- [ ] add a CTA for feedback/issue -> github issue (also add a template .git)
- [ ] we can set individual refresh count for each of checks: bundles [10], page element [5], class name [4], cookie [4], attribute [3], localstorage [5], now if anyone of the checks here are still failing we will refresh internally that many times in a constant period to ensure we won't miss just because the action was delayed. For ex: some time the network call is delayed but by that time our first time refresh check is already complete and user had to manually refresh it to check again.
