# AdCheck Backlog

_ignore this for now_

## Console Error Monitoring

- Capture page warnings and errors in a Manifest V3-safe way without breaking site behavior.
- Define the first-pass heuristic for what counts as "ad-related" versus general page noise.
- Decide whether the safest implementation is a `MAIN` world bridge, a page-injected listener, or another messaging approach.
- Design the widget treatment for surfaced messages, including severity, plain-English guidance, and deduplication.
- Add testing notes for noisy pages, repeated errors, and cross-frame behavior.

---

- [x] make the open pannel button similar to how hide button is on hover it becomes fully visible.
- [x] fix the continuous updatation issue, it keeps on refreshing and looking for new changes from the dom even though it already found them, make it such that it checks in a periodic manner and if found don't check again until the refresh button is clicked.

---

- [x] add domain filtering logic where it will not work or ignore certain domains, you can add multiple domain as is, or a regex users choice (ReGex supported)
- [x] once all the cases pass show a green dot/check on the logo is a good idea.
- [x] add the source code link at the bottom just say source code and link to the github [repo](https://github.com/pantharshit007/AdCheck)
- [ ] fix the input box overlapping the the cross button in the popup ex: "Bundle or script names Tell AdCheck which ad scripts should load on the page." input box overlapps the cross button
- [ ] improve the widget enabled panel i think we can move it to the top right corner.
