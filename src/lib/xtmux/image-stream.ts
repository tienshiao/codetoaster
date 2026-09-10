/**
 * Lift image sequences out of a PTY's output before anyone parses it.
 *
 * Every byte a PTY writes goes to two places: the headless terminal on the
 * server, which owns the grid, and every attached browser, which owns the
 * pixels. An image is the one thing neither can handle alone. The browser can
 * decode a sixel but would size it in rows from its own font, so two viewers
 * with different fonts would put the next prompt on different rows; the server
 * cannot decode it at all, and left as-is its cursor would never move. So the
 * server takes the sequence out of the stream here, hands it to whoever boxes
 * it into a fixed number of cells (`inline-images.ts`), and forwards two
 * different substitutes: the browsers get an iTerm inline-image sequence with
 * the cell box spelled out, and the headless terminal gets a private
 * placeholder that its handler turns into the same cursor movement the
 * browser's addon makes.
 *
 * This has to happen synchronously, in the output callback, because
 * `terminal.write` parses on a later tick: a handler on the headless parser
 * would see the image after the bytes following it had already been broadcast,
 * and the picture would arrive after the prompt that follows it.
 *
 * Only what is captured is held back — a sixel or an OSC 1337 from its
 * introducer to its terminator — and everything else passes through in the
 * chunks it arrived in. A DCS that is not a sixel (DECRQSS, XTGETTCAP) and an
 * OSC that is not an inline image (titles, clipboard) are copied out byte for
 * byte once their terminator shows, so an unrelated sequence split across two
 * chunks is still delivered whole. Both the 7-bit introducers (`ESC P`,
 * `ESC ]`) and the 8-bit C1 ones (U+0090, U+009D) start a sequence, because
 * xterm's parser enters DCS and OSC on either and the PTY is decoded as UTF-8,
 * so a program emitting the C1 bytes would otherwise be seen by the browser's
 * addon and not by us. Either terminator ends one: `ESC \` or the 8-bit ST
 * (U+009C), so a program using the latter cannot hold the stream open forever.
 */

export type Captured =
  | { kind: "sixel"; params: number[]; body: string }
  | { kind: "iip"; body: string };

export interface Substitute {
  /** What the headless terminal parses in the sequence's place. */
  headless: string;
  /** What every attached browser gets in its place. */
  clients: string;
}

/** A captured sequence larger than this is consumed and dropped. The image
 * addon's own `sixelSizeLimit`, so a program that works against a plain
 * xterm.js with the addon works here. */
export const SEQUENCE_SIZE_LIMIT = 25_000_000;

/** An image with more pixels than this is dropped — the image addon's own
 * `pixelLimit`, and what the browser's addon is loaded with
 * (`frontend/utils/terminal-queries.ts`) so the two cannot drift. */
export const PIXEL_LIMIT = 16_777_216;

/** An inline file larger than this, decoded, is dropped — the addon's own
 * `iipSizeLimit`, passed to the browser's addon for the same reason. */
export const IIP_SIZE_LIMIT = 20_000_000;

const ESC = "\x1b";
const CAN = "\x18";
const SUB = "\x1a";
// The 8-bit C1 introducers for DCS and OSC. xterm's parser enters those states
// on them from anywhere, so this scanner has to as well.
const C1_DCS = "\x90";
const C1_OSC = "\x9d";

// What starts a sequence in ordinary text: ESC, or either C1 introducer.
const TEXT_INTRO = /[\x1b\x90\x9d]/g;

// What can end, or abort, a string body: CAN, SUB, ESC (an ST, or an escape
// that abandons the string) and the 8-bit ST. OSC additionally ends on BEL.
const DCS_BODY_STOP = /[\x18\x1a\x1b\x9c]/g;
const OSC_BODY_STOP = /[\x07\x18\x1a\x1b\x9c]/g;

type State =
  | "text"
  | "esc" // after ESC, deciding what follows
  | "dcs-head" // after ESC P, collecting params and intermediates up to the final
  | "dcs-body" // inside a DCS payload
  | "dcs-esc" // ESC seen inside a DCS payload: ST, or an abort
  | "osc-body" // inside an OSC payload
  | "osc-esc"; // ESC seen inside an OSC payload

export class ImageStream {
  private state: State = "text";
  private head = "";
  private pieces: string[] = [];
  private held = 0;
  private overflow = false;
  private sixel = false;
  private multipart: { header: string; parts: string[]; held: number } | null = null;

  constructor(private readonly capture: (c: Captured) => Substitute | null) {}

  push(chunk: string): Substitute {
    let headless = "";
    let clients = "";
    const both = (s: string) => {
      headless += s;
      clients += s;
    };
    let i = 0;
    const n = chunk.length;
    while (i < n) {
      switch (this.state) {
        case "text": {
          TEXT_INTRO.lastIndex = i;
          const m = TEXT_INTRO.exec(chunk);
          if (!m) {
            both(chunk.slice(i));
            i = n;
            break;
          }
          both(chunk.slice(i, m.index));
          i = m.index + 1;
          const c = chunk[m.index]!;
          if (c === ESC) this.state = "esc";
          else if (c === C1_DCS) this.begin("dcs-head");
          else if (c === C1_OSC) this.begin("osc-body");
          break;
        }
        case "esc": {
          const c = chunk[i]!;
          if (c === "P") {
            this.begin("dcs-head");
            i++;
          } else if (c === "]") {
            this.begin("osc-body");
            i++;
          } else if (c === ESC) {
            // ESC ESC: the first was nothing; the second starts over.
            both(ESC);
            i++;
          } else {
            both(ESC + c);
            i++;
            this.state = "text";
          }
          break;
        }
        case "dcs-head": {
          const c = chunk[i]!;
          const code = c.charCodeAt(0);
          if (code >= 0x40 && code <= 0x7e) {
            // The final byte. A sixel is DCS with parameters only and `q`;
            // `$ q` (DECRQSS) and `+ q` (XTGETTCAP) carry an intermediate.
            this.sixel = c === "q" && /^[0-9;]*$/.test(this.head);
            this.head += c;
            this.state = "dcs-body";
            i++;
          } else if (c === ESC) {
            this.state = "dcs-esc";
            i++;
          } else if (c === CAN || c === SUB) {
            both(this.abort() + c);
            i++;
          } else {
            // Params and intermediates before the final. The body is capped by
            // `hold`, but this header is not, so a DCS whose final never comes
            // (a flood of `;`) would grow it without bound: cap it the same
            // way, and let `overflow` drop the sequence when it does terminate.
            if (this.head.length > SEQUENCE_SIZE_LIMIT) this.overflow = true;
            else this.head += c;
            i++;
          }
          break;
        }
        case "dcs-body":
        case "osc-body": {
          const stop = this.state === "dcs-body" ? DCS_BODY_STOP : OSC_BODY_STOP;
          stop.lastIndex = i;
          const m = stop.exec(chunk);
          const at = m ? m.index : n;
          this.hold(chunk.slice(i, at));
          i = at;
          if (!m) break;
          const c = chunk[at]!;
          i++;
          if (c === ESC) {
            this.state = this.state === "dcs-body" ? "dcs-esc" : "osc-esc";
          } else if (c === CAN || c === SUB) {
            both(this.abort() + c);
          } else {
            // BEL or the 8-bit ST: the sequence is complete.
            const sub = this.end(c);
            headless += sub.headless;
            clients += sub.clients;
          }
          break;
        }
        case "dcs-esc":
        case "osc-esc": {
          const c = chunk[i]!;
          i++;
          if (c === "\\") {
            const sub = this.end(ESC + "\\");
            headless += sub.headless;
            clients += sub.clients;
          } else {
            // Not an ST: xterm abandons the string and reads this as a fresh
            // escape. Replay the ESC into the escape state so the sequence it
            // starts is seen whole.
            both(this.abort());
            this.state = "esc";
            i--;
          }
          break;
        }
      }
    }
    return { headless, clients };
  }

  private begin(state: "dcs-head" | "osc-body"): void {
    this.state = state;
    this.head = "";
    this.pieces = [];
    this.held = 0;
    this.overflow = false;
    this.sixel = false;
  }

  private hold(s: string): void {
    if (!s) return;
    this.held += s.length;
    if (this.held > SEQUENCE_SIZE_LIMIT) {
      // Keep consuming to the terminator, but stop remembering: this
      // sequence is going nowhere.
      this.overflow = true;
      this.pieces = [];
      return;
    }
    this.pieces.push(s);
  }

  /** The introducer a sequence that has to be handed on is rebuilt with. Always
   * the 7-bit form, even for one that arrived with an 8-bit C1 introducer: the
   * two are the same sequence to every parser downstream. */
  private intro(wasOsc: boolean): string {
    return wasOsc ? ESC + "]" : ESC + "P" + this.head;
  }

  private abort(): string {
    const wasOsc = this.state === "osc-body" || this.state === "osc-esc";
    const dropped = this.overflow || this.sixel;
    const pieces = this.pieces;
    this.state = "text";
    this.pieces = [];
    // Nothing to hand on for an image or an overflowed sequence, so its body is
    // never joined back together.
    return dropped ? "" : this.intro(wasOsc) + pieces.join("");
  }

  private end(terminator: string): Substitute {
    const wasOsc = this.state === "osc-body" || this.state === "osc-esc";
    const overflow = this.overflow;
    const pieces = this.pieces;
    this.state = "text";
    this.pieces = [];
    if (overflow) return { headless: "", clients: "" };

    const body = pieces.join("");
    let captured: Captured | null = null;
    if (wasOsc) {
      if (body.startsWith("1337;File=")) {
        captured = { kind: "iip", body: body.slice("1337;".length) };
      } else if (body.startsWith("1337;MultipartFile=")) {
        // iTerm2's own imgcat sends this form unless asked for the legacy
        // one: the header alone, the base64 in 200-byte parts, then an end.
        // Neither the addon nor anything else here reads it, so the parts are
        // gathered up and handed on as the single sequence they stand for.
        this.multipart = { header: body.slice("1337;MultipartFile=".length), parts: [], held: 0 };
        return { headless: "", clients: "" };
      } else if (body.startsWith("1337;FilePart=") && this.multipart) {
        const part = body.slice("1337;FilePart=".length);
        this.multipart.held += part.length;
        if (this.multipart.held > SEQUENCE_SIZE_LIMIT) this.multipart = null;
        else this.multipart.parts.push(part);
        return { headless: "", clients: "" };
      } else if (body === "1337;FileEnd" && this.multipart) {
        const { header, parts } = this.multipart;
        this.multipart = null;
        captured = { kind: "iip", body: `File=${header}:${parts.join("")}` };
      }
    } else if (this.sixel) {
      captured = { kind: "sixel", params: this.head.slice(0, -1).split(";").map((p) => (p === "" ? 0 : Number(p))), body };
    }
    if (!captured) {
      const raw = this.intro(wasOsc) + body + terminator;
      return { headless: raw, clients: raw };
    }
    // An image nobody could decode is dropped from both sides rather than
    // passed on: a browser that drew it would move its cursor and the server
    // would not.
    return this.capture(captured) ?? { headless: "", clients: "" };
  }
}
