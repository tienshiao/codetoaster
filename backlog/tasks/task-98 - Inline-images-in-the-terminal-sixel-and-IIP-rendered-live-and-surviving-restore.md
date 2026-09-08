---
id: TASK-98
title: >-
  Inline images in the terminal: sixel and IIP, rendered live and surviving
  restore
status: Done
assignee:
  - '@claude'
created_date: '2026-09-07 23:41'
updated_date: '2026-09-08 01:18'
labels: []
dependencies: []
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A program that paints an image into the terminal (chafa, img2sixel, timg, an agent showing a screenshot) gets it drawn inline, in every attached browser, and the image is still there after a reload, a reattach, a second browser joining, or a suspend/resume from the scrollback snapshot on disk.

Why it is not just loading the addon: the server's headless terminal is the authority on the grid and answers the terminal's queries, while only a browser can decode and paint pixels. Left to itself each browser would compute an image's height in rows from its own font metrics, and the server would not move its cursor at all, so the next prompt would land on a different row on every viewer. The server therefore takes the image out of the byte stream, decodes it, fixes its size in cells against one canonical cell size, and hands every viewer the same image with that explicit cell box (as an iTerm inline-image sequence). It emulates the cursor movement the addon makes, records the image against a buffer marker, and splices it back into the serialized screen so restore and the on-disk snapshot carry it.

Out of scope, noted for follow-ups: kitty graphics protocol; non-scrolling sixel display mode (DECSET 80); HiDPI-aware canonical cell size; partial erase of an image by text written over it (the whole image comes back on restore).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A sixel image printed into a shell tab is drawn inline in the browser at the cursor, and text printed afterwards starts on the row below the image on both the browser and the server (the prompt does not overlap or float above the image)
- [x] #2 Programs that probe for sixel support detect it: Primary DA advertises sixel, XTSMGRAPHICS answers colour registers and sixel geometry, and XTWINOPS 14/16/18 report pixel and cell sizes consistent with the geometry images are laid out at
- [x] #3 A browser that attaches after the image was printed (reload, second client, reattach) sees the image in the same place, in scrollback or in the viewport, with surrounding text unchanged
- [x] #4 The scrollback snapshot written to disk carries the image, so a task restored from it shows the image
- [x] #5 An iTerm inline image (OSC 1337 File) from a program is handled the same way; an unrecognised payload is dropped rather than desynchronising the cursor
- [x] #6 Images are dropped when their rows scroll out of the buffer, on RIS/DECSTR, on ED 2/3 over their rows, and when the alternate buffer is left; per-PTY image memory is capped with FIFO eviction
- [x] #7 A viewer's xterm never answers the image-related queries itself (DA1, XTSMGRAPHICS): one PTY gets one reply
- [x] #8 Unit tests cover the stream scanner across chunk boundaries, cursor emulation, the restore splice, and eviction; the query tests are updated for the new DA1 reply
- [x] #9 Verified in a real browser: image renders live, survives reload, and a second tab shows it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Server, lib/xtmux/inline-images.ts: a synchronous stream scanner (ImageStream) that every PTY output chunk passes through before either the headless terminal or the clients see it. It tracks DCS/OSC state across chunk boundaries, passes everything else through byte for byte, and captures DCS q (sixel) and OSC 1337 File. A captured sixel is decoded with the sixel package's wasm Decoder; an IIP payload has its pixel size read from the PNG/GIF/JPEG header (anything else is dropped). The image is boxed to cols = ceil(w / CELL.width), rows = ceil(h / CELL.height) against a canonical CELL (10x20 px), padded to that box (sixel via a small PNG encoder over node:zlib deflate; IIP kept as-is), and stored as base64. The scanner yields two streams: the client stream gets an IIP sequence with width/height in cells and preserveAspectRatio=0; the headless stream gets a private placeholder DCS carrying the image id and its cell box.
2. Server, cursor and bookkeeping: a DCS handler on the headless terminal consumes the placeholder at the exact point in the parse where the addon would place the image, records { marker (registerMarker(0), or a fixed row on the alternate buffer), col, cols, rows, base64 }, and emulates the addon's IIP placement through the same internals it uses (lineFeed x (rows-1), x = min(col + cols, cols)). Eviction: marker dispose, RIS, DECSTR, ED 2/3 over the image's rows, leaving the alternate buffer, and a per-PTY byte cap with FIFO.
3. Server, restore: Pty.serialize() becomes a splice: serialize the normal buffer in row ranges around each image (excludeModes/excludeAltBuffer), emitting between chunks: SGR reset, \r\n to the image row, CHA to its column, the IIP, cursor up rows-1 and \r, then the next range; then alt buffer and modes as the addon's own serialize does. The harvester's snapshot uses the same call, so the on-disk .ans carries images for free.
4. Server, queries answered by the headless terminal: DA1 -> CSI ? 62;4;9;22 c (what the addon reports), XTSMGRAPHICS item 1 (registers) and 2 (geometry from CELL x size), XTWINOPS 14/16/18. Update pty-queries.test.ts expectations.
5. Client: load @xterm/addon-image 0.9.0 in Terminal.tsx with sixelSupport off, iipSupport on, a modest storageLimit, loaded before the query silencer so the silencer wins; add XTSMGRAPHICS (CSI ? ... S) to silenceTerminalQueries and its test.
6. Tests (bun test, no DOM): scanner splits, passthrough of DECRQSS/OSC 52/plain ESC, CAN abort and size cap; decode+box+PNG; placement and eviction against a bare headless Terminal; restore splice ordering; one Pty end-to-end (sixel printed by a script -> clients get IIP, serialize carries it, following text is on the row below).
7. Docs: a short inline-images paragraph in docs/v2-architecture.md by the restore protocol. Verify in a browser via the verify skill (live, reload, second tab); note the DECSET 80 / kitty / HiDPI follow-ups.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions: the client never sees a sixel; the server transcodes every image to an OSC 1337 with width/height in cells and preserveAspectRatio=0 against a canonical 10x20px cell (CELL in inline-images.ts), padding the sixel's PNG to the cell box so it is not distorted. Cursor emulation mirrors @xterm/addon-image 0.9.0 exactly: line feed per row after the first, then back to the origin column (VT340 placement, so text without a newline after an image lands on its last row — that is the addon's behaviour, and every image tool ends with a newline). xterm's public API silently gates custom CSI t handlers behind windowOptions, so InlineImages enables getWinSizePixels/getCellSizePixels/getWinSizeChars itself. SerializeAddon trims trailing empty rows of a range that starts within the last screenful; the splice hands it a buffer view one screen longer so every row is written and one newline reaches the image row. Eviction: marker dispose, RIS/DECSTR, ED 0-3 over the image's rows, alternate-buffer exit, 64MB base64 cap FIFO; drop() removes before disposing markers because disposal re-enters drop.

Validation: bun test src/lib/xtmux (image-stream 16, inline-images 30, image-codec 7, pty-images 1, pty-queries updated) all pass; bun run test:unit 1465 pass with 2 pre-existing failures in src/cli/hook.test.ts that fail identically on the base commit bd2ca36 (stashed and re-run to confirm); bun run test:render 324 pass; tsc clean. Browser (verify skill, isolated server on 4599, shell task): cat of a 200x100 sixel renders inline in Chrome, the prompt follows below; reload restores it in place; a second tab shows it; after seq 1 45 pushes it into scrollback a reload still restores it there (Shift+PageUp to see it). No img2sixel/chafa on this machine, so DA-driven detection was exercised only by the unit tests.

Follow-up from testing with iTerm2's imgcat: it sends the multipart form by default (OSC 1337 MultipartFile header, 200-byte FilePart sequences, FileEnd), which neither the scanner nor the addon read, so only 'imgcat -l' drew anything. ImageStream now gathers the parts into the one-shot File= sequence before boxing; four scanner tests added. magick's sixel output worked as-is.

Code review (/code-review --fix) applied fixes, all in the worktree: the image addon's default enableSizeReports made every browser answer XTWINOPS 14/16/18 alongside the server, now off via shared IMAGE_ADDON_OPTIONS and pinned by tests; the pixel guard now checks the padded box with the addon's comparison and the 20MB iipSizeLimit is enforced server-side, so the server never line-feeds for an image the viewer will refuse; RIS/DECSTR clear display mode; the normal buffer's cursor is placed before ?1049h on restore; images taller than the screen step down over their rows instead of a clamped CUU; ED 0/1 respect the cursor column; N%/Npx/auto IIP sizes are honoured; C1 introducers (U+0090/U+009D) start sequences; serialize falls back to the addon if its private internals vanish. Left as design-level follow-ups: alternate-buffer rows are frozen (no markers there); EL/IL/DL/SU/SD and text overwrite do not invalidate records, so a restore can re-splice an image the live viewer already erased; sixel decode and deflate run synchronously in the PTY callback; snapshots can carry up to 64MB of base64. Suite after review: 1482 pass, the same two pre-existing hook.test.ts failures.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Inline images (sixel and iTerm OSC 1337) render in every attached browser and survive reload, reattach, a second viewer, and the scrollback snapshot. New: lib/xtmux/image-stream.ts (synchronous scanner lifting image sequences out of PTY output across chunk boundaries), lib/xtmux/inline-images.ts (decode via the sixel wasm decoder, box into cells against a canonical cell, per-PTY store on buffer markers, cursor emulation matching the addon, restore splice, DA1/XTSMGRAPHICS/XTWINOPS answers), lib/xtmux/image-codec.ts (PNG encoder, PNG/GIF/JPEG header sniff). pty.ts routes output through the scanner and serializes through the splice; Terminal.tsx loads @xterm/addon-image with sixel off; terminal-queries silences XTSMGRAPHICS. Verified with 54 new unit tests and in Chrome. Follow-ups not started: kitty graphics protocol; HiDPI-aware canonical cell; partial erase of an image by text written over it (the whole image comes back on restore); an OSC 1337 ReportCellSize query is still answered per viewer.
<!-- SECTION:FINAL_SUMMARY:END -->
