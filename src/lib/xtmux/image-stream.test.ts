import { describe, expect, test } from "bun:test";
import { ImageStream, SEQUENCE_SIZE_LIMIT, type Captured } from "./image-stream";

// A stream whose captures are replaced by markers, so a test can see where
// in the output an image was and which side got what.
function capturing() {
  const captured: Captured[] = [];
  const stream = new ImageStream((c) => {
    captured.push(c);
    return { headless: `<H${captured.length}>`, clients: `<C${captured.length}>` };
  });
  return { stream, captured };
}

function pushAll(stream: ImageStream, chunks: string[]) {
  let headless = "";
  let clients = "";
  for (const chunk of chunks) {
    const out = stream.push(chunk);
    headless += out.headless;
    clients += out.clients;
  }
  return { headless, clients };
}

const SIXEL = '\x1bP0;1;0q"1;1;2;2#0;2;100;0;0#0~~$-\x1b\\';
const IIP = "\x1b]1337;File=inline=1;size=3:AAAA\x07";

describe("ImageStream", () => {
  test("text and ordinary escapes reach both sides untouched", () => {
    const { stream, captured } = capturing();
    const input = "hi\x1b[31mred\x1b[0m\x1b(B\x1b7\x1b[?2004h\x1b[2J";
    expect(stream.push(input)).toEqual({ headless: input, clients: input });
    expect(captured).toEqual([]);
  });

  test("a sixel is captured with its parameters and body, and each side gets its substitute", () => {
    const { stream, captured } = capturing();
    expect(stream.push("A" + SIXEL + "B")).toEqual({ headless: "A<H1>B", clients: "A<C1>B" });
    expect(captured).toEqual([{ kind: "sixel", params: [0, 1, 0], body: '"1;1;2;2#0;2;100;0;0#0~~$-' }]);
  });

  test("a sixel with no parameters is still a sixel", () => {
    const { stream, captured } = capturing();
    stream.push("\x1bPq#0~\x1b\\");
    expect(captured).toEqual([{ kind: "sixel", params: [0], body: "#0~" }]);
  });

  test("an OSC 1337 inline file is captured; other OSC 1337 commands pass", () => {
    const { stream, captured } = capturing();
    const other = "\x1b]1337;SetUserVar=a=Yg==\x07";
    expect(stream.push(IIP + other)).toEqual({ headless: "<H1>" + other, clients: "<C1>" + other });
    expect(captured).toEqual([{ kind: "iip", body: "File=inline=1;size=3:AAAA" }]);
  });

  // What iTerm2's imgcat sends by default: the header, the base64 in parts,
  // and an end, each its own OSC. It comes out as the one-shot form.
  const MULTIPART =
    "\x1b]1337;MultipartFile=inline=1;size=3;name=YQ==\x07" +
    "\x1b]1337;FilePart=AA\x07" +
    "\x1b]1337;FilePart=AA\x07" +
    "\x1b]1337;FileEnd\x07";

  test("a multipart inline file is gathered into one capture, and nothing of it is passed on", () => {
    const { stream, captured } = capturing();
    expect(stream.push("x" + MULTIPART + "y")).toEqual({ headless: "x<H1>y", clients: "x<C1>y" });
    expect(captured).toEqual([{ kind: "iip", body: "File=inline=1;size=3;name=YQ==:AAAA" }]);
  });

  test("a multipart file split at any point is still one capture", () => {
    const full = "x" + MULTIPART + "y";
    const expected = capturing().stream.push(full);
    for (let i = 1; i < full.length; i++) {
      const { stream, captured } = capturing();
      expect(pushAll(stream, [full.slice(0, i), full.slice(i)])).toEqual(expected);
      expect(captured).toHaveLength(1);
    }
  });

  test("a part or an end with no file open passes through like any other OSC", () => {
    const { stream, captured } = capturing();
    const stray = "\x1b]1337;FilePart=AA\x07\x1b]1337;FileEnd\x07";
    expect(stream.push(stray)).toEqual({ headless: stray, clients: stray });
    expect(captured).toEqual([]);
  });

  test("a new multipart header abandons an unfinished one", () => {
    const { stream, captured } = capturing();
    stream.push("\x1b]1337;MultipartFile=inline=1;size=9\x07\x1b]1337;FilePart=ZZ\x07");
    stream.push(MULTIPART);
    expect(captured).toEqual([{ kind: "iip", body: "File=inline=1;size=3;name=YQ==:AAAA" }]);
  });

  // The whole point of the scanner: a PTY hands output over in arbitrary
  // pieces, and a sequence cut anywhere must still come out whole.
  test.each(["sixel", "iip"])("a %s split at any point is captured once and output once", (kind) => {
    const full = "pre" + (kind === "sixel" ? SIXEL : IIP) + "post";
    const whole = capturing();
    const expected = whole.stream.push(full);
    for (let i = 1; i < full.length; i++) {
      const { stream, captured } = capturing();
      expect(pushAll(stream, [full.slice(0, i), full.slice(i)])).toEqual(expected);
      expect(captured).toHaveLength(1);
    }
  });

  test.each([
    ["DECRQSS", "\x1bP$qm\x1b\\"],
    ["XTGETTCAP", "\x1bP+q544e\x1b\\"],
    ["a DCS with an unexpected final", "\x1bP1;2|abc\x1b\\"],
    ["a window title", "\x1b]0;title with ; and q\x07"],
    ["a clipboard write", "\x1b]52;c;aGVsbG8=\x1b\\"],
  ])("%s passes through whole, however it is split", (_name, sequence) => {
    const full = "x" + sequence + "y";
    for (let i = 1; i < full.length; i++) {
      const { stream, captured } = capturing();
      expect(pushAll(stream, [full.slice(0, i), full.slice(i)])).toEqual({ headless: full, clients: full });
      expect(captured).toEqual([]);
    }
  });

  test("nothing of a held sequence is emitted until its terminator arrives", () => {
    const { stream } = capturing();
    expect(stream.push("A" + SIXEL.slice(0, 10))).toEqual({ headless: "A", clients: "A" });
    expect(stream.push(SIXEL.slice(10) + "B")).toEqual({ headless: "<H1>B", clients: "<C1>B" });
  });

  test("the 8-bit ST terminates a string too", () => {
    const { stream, captured } = capturing();
    expect(stream.push("\x1bP0q#0~\x9cZ")).toEqual({ headless: "<H1>Z", clients: "<C1>Z" });
    expect(captured).toHaveLength(1);
  });

  // xterm's parser enters DCS on U+0090 and OSC on U+009D, and the PTY is
  // decoded as UTF-8, so a program emitting the C1 bytes must be seen here too
  // — otherwise the browser's addon draws an image the server never boxed.
  test("an 8-bit OSC introduces an inline file", () => {
    const { stream, captured } = capturing();
    expect(stream.push("\x9d1337;File=inline=1;size=3:AAAA\x9c")).toEqual({ headless: "<H1>", clients: "<C1>" });
    expect(captured).toEqual([{ kind: "iip", body: "File=inline=1;size=3:AAAA" }]);
  });

  test("an 8-bit DCS introduces a sixel", () => {
    const { stream, captured } = capturing();
    const body = '"1;1;2;2#0;2;100;0;0#0~~$-';
    expect(stream.push("\x900;1;0q" + body + "\x9c")).toEqual({ headless: "<H1>", clients: "<C1>" });
    expect(captured).toEqual([{ kind: "sixel", params: [0, 1, 0], body }]);
  });

  test("an 8-bit OSC that is not an image passes through with the 7-bit introducer", () => {
    const { stream, captured } = capturing();
    const out = "\x1b]0;title\x9c";
    expect(stream.push("\x9d0;title\x9c")).toEqual({ headless: out, clients: out });
    expect(captured).toEqual([]);
  });

  test("CAN abandons a sixel; the text after it goes on", () => {
    const { stream, captured } = capturing();
    expect(stream.push("\x1bP0q#0~~\x18text")).toEqual({ headless: "\x18text", clients: "\x18text" });
    expect(captured).toEqual([]);
  });

  test("CAN inside an ordinary DCS lets what was held through", () => {
    const { stream } = capturing();
    expect(stream.push("\x1bP$qm\x18")).toEqual({ headless: "\x1bP$qm\x18", clients: "\x1bP$qm\x18" });
  });

  test("an escape that is not ST abandons the string and is read as itself", () => {
    const { stream, captured } = capturing();
    expect(stream.push("\x1bP0q#0~~\x1b[31mX")).toEqual({ headless: "\x1b[31mX", clients: "\x1b[31mX" });
    expect(captured).toEqual([]);
  });

  test("ESC ESC is two escapes, the second of which counts", () => {
    const { stream } = capturing();
    expect(stream.push("\x1b\x1b[0m")).toEqual({ headless: "\x1b\x1b[0m", clients: "\x1b\x1b[0m" });
  });

  test("an image nobody could box vanishes from both sides", () => {
    const stream = new ImageStream(() => null);
    expect(stream.push("A" + SIXEL + "B" + IIP + "C")).toEqual({ headless: "ABC", clients: "ABC" });
  });

  test("a sequence over the size limit is consumed and dropped", () => {
    const { stream, captured } = capturing();
    const piece = "~".repeat(1024 * 1024);
    const chunks = ["\x1bP0q"];
    for (let held = 0; held <= SEQUENCE_SIZE_LIMIT; held += piece.length) chunks.push(piece);
    chunks.push("\x1b\\after");
    expect(pushAll(stream, chunks)).toEqual({ headless: "after", clients: "after" });
    expect(captured).toEqual([]);
  });
});
