---
category: Forms
---

Filesystem path field with directory autocompletion, used when picking where a session or project starts. Controlled via `value`/`onChange`; `onOpenChange` reports the suggestion list opening so a surrounding dialog can avoid stealing focus. Suggestions are fetched from the server as the user types.
