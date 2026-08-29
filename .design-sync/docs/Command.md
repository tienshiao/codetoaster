---
category: Overlays
---

Command palette primitive (cmdk). `Command` wraps `CommandInput`, then `CommandList` containing `CommandGroup`s of `CommandItem`s, with `CommandEmpty` for no matches and `CommandShortcut` for key hints. `CommandDialog` is the same list inside a modal — the usual way to present it.
