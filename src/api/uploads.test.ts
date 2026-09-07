import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { uploadsDir } from "../lib/uploads";
import { uploadRoutes } from "./uploads";

// Through a real Bun.serve, like the route tests beside it, so the status and
// the JSON body under test are the ones a client gets. What `saveUploads`
// itself does with a name is `lib/uploads.test.ts`.
let server: ReturnType<typeof Bun.serve>;
let base: string;
// Everything the route wrote. The root handed to the route is `uploadsDir()`,
// so what keeps this off the developer's own ~/.codetoaster/uploads is
// `test/uploads.ts` pinning CODETOASTER_UPLOADS_DIR at a temporary one before
// every test. Removed after each test anyway, so a long `bun test` does not
// accumulate them.
const written: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: uploadRoutes(uploadsDir()) as any,
    fetch: () => new Response("", { status: 404 }),
  });
  base = `http://localhost:${server.port}`;
});

afterEach(() => {
  while (written.length) fs.rmSync(written.pop()!, { recursive: true, force: true });
});

afterAll(() => server.stop(true));

async function post(form: FormData): Promise<Response> {
  const res = await fetch(`${base}/api/uploads`, { method: "POST", body: form });
  if (res.status === 200) {
    const { paths } = (await res.clone().json()) as { paths: string[] };
    for (const p of paths) written.push(path.dirname(p));
  }
  return res;
}

describe("POST /api/uploads", () => {
  test("writes the files and answers with their paths", async () => {
    const form = new FormData();
    form.append("files", new File(["png-bytes"], "shot.png"));
    form.append("files", new File(["lines"], "run.log"));
    const res = await post(form);

    expect(res.status).toBe(200);
    const { paths } = (await res.json()) as { paths: string[] };
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.startsWith(uploadsDir() + path.sep))).toBe(true);
    expect(paths.map((p) => path.basename(p))).toEqual(["shot.png", "run.log"]);
    expect(fs.readFileSync(paths[0]!, "utf8")).toBe("png-bytes");
    expect(fs.readFileSync(paths[1]!, "utf8")).toBe("lines");
  });

  test("a body with no file parts is a 400, not an empty success", async () => {
    const form = new FormData();
    form.append("files", "not-a-file");
    const res = await post(form);
    expect(res.status).toBe(400);
  });
});
