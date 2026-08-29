---
category: Feedback
---

Session status indicator. Encodes connection state in a single dot: filled green when connected, red when exited, hollow when suspended (dormant but one click from running), with `isResuming` for the in-between and `hasNotification` for an unread badge. State is a set of booleans rather than one enum because they are independently sourced.
