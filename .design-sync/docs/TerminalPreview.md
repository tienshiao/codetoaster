---
category: Terminal
---

Hover preview of a session's terminal. Wraps a trigger in `children` and, on hover, renders recent scrollback fetched through the `fetchPreview`/`getPreview` pair — passed in rather than read from context so the component stays testable and the caller controls caching.
