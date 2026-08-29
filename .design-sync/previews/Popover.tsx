import type { ReactNode } from "react";
import {
  Button,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "codetoaster";
import { Check, GitBranch, Info } from "lucide-react";

const noop = () => {};

/** Reserves the room the portalled panel occupies so a card cell frames it.
 * Inline style, not a utility class — see the batch learnings note on Tailwind
 * classes that only exist in a preview. */
const Stage = ({ children }: { children: ReactNode }) => (
  <div className="w-full" style={{ minHeight: 320 }}>
    {children}
  </div>
);

/** The symbol lookup popover from the diff/file views (SymbolPopover): a
 * scrollable, sectioned result list with its own header. */
export const SymbolLookup = () => (
  <Stage>
    <Popover open onOpenChange={noop} modal={false}>
      <PopoverTrigger asChild>
        <button className="hover:bg-accent rounded-sm px-1 font-mono text-sm underline underline-offset-4">
          resolveSession
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-96 overflow-auto p-0"
        style={{ maxHeight: 320 }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="border-border border-b px-3 py-2">
          <span className="font-mono text-xs font-semibold">resolveSession</span>
        </div>
        <div className="py-1">
          <div className="text-muted-foreground px-3 py-1 text-[10px] tracking-wide uppercase">
            Definitions (1)
          </div>
          <div className="hover:bg-accent flex flex-col gap-0.5 px-3 py-1.5">
            <span className="text-foreground font-mono text-[11px]">
              src/lib/xtmux/manager.ts:214
              <span className="text-muted-foreground ml-2">function</span>
            </span>
            <span className="text-muted-foreground truncate font-mono text-[10px]">
              export function resolveSession(id: string): PtySession | null
            </span>
          </div>
        </div>
        <div className="py-1">
          <div className="text-muted-foreground px-3 py-1 text-[10px] tracking-wide uppercase">
            References (3)
          </div>
          {[
            { path: "src/server.ts:88", ctx: "const session = resolveSession(msg.id);" },
            { path: "src/api/tasks.ts:143", ctx: "if (!resolveSession(taskId)) return 404;" },
            { path: "src/lib/xtmux/pty.ts:57", ctx: "resolveSession(this.id)?.detach(client);" },
          ].map((r) => (
            <div key={r.path} className="hover:bg-accent flex flex-col gap-0.5 px-3 py-1.5">
              <span className="text-foreground font-mono text-[11px]">{r.path}</span>
              <span className="text-muted-foreground truncate font-mono text-[10px]">
                {r.ctx}
              </span>
            </div>
          ))}
        </div>
        <div className="text-muted-foreground border-border border-t px-3 py-1.5 text-[10px]">
          Index partial — some results may be missing
        </div>
      </PopoverContent>
    </Popover>
  </Stage>
);

/** Interactive content is what separates Popover from Tooltip: a branch list
 * hung off the git toolbar's branch button. */
export const BranchSwitcher = () => (
  <Stage>
    <Popover open onOpenChange={noop} modal={false}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <GitBranch />v2
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
          Switch branch
        </div>
        {[
          { name: "v2", ahead: "current", active: true },
          { name: "main", ahead: "12 behind", active: false },
          { name: "feat/idle-harvester", ahead: "3 ahead", active: false },
          { name: "fix/origin-guard", ahead: "1 ahead", active: false },
        ].map((b) => (
          <button
            key={b.name}
            className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
          >
            <Check className={b.active ? "size-3.5 shrink-0" : "size-3.5 shrink-0 opacity-0"} />
            <span className="truncate font-mono text-xs">{b.name}</span>
            <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
              {b.ahead}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  </Stage>
);

/** `PopoverAnchor` positions against something other than the trigger — here a
 * token inside a diff hunk, the way the diff view opens it under the cursor. */
export const AnchoredToCode = () => (
  <Stage>
    <Popover open onOpenChange={noop} modal={false}>
      <div className="bg-muted/50 border-border w-96 rounded-md border p-3 font-mono text-xs">
        {[
          { n: "139", body: "resize(cols: number, rows: number) {" },
          { n: "140", body: "  if (!this.headless) return;" },
          { n: "141", body: "  const [c, r] = smallestWins(this.clients);" },
        ].map((l) => (
          <div key={l.n} className="text-muted-foreground flex gap-3">
            <span className="w-7 shrink-0 text-right">{l.n}</span>
            <span className="whitespace-pre">{l.body}</span>
          </div>
        ))}
        <div className="flex gap-3">
          <span className="text-muted-foreground w-7 shrink-0 text-right">142</span>
          <span className="whitespace-pre">
            {"  this.headless."}
            <PopoverAnchor asChild>
              <span className="bg-accent rounded-sm">resize</span>
            </PopoverAnchor>
            {"(c, r);"}
          </span>
        </div>
      </div>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-72 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-start gap-2">
          <Info className="text-muted-foreground size-4 shrink-0" />
          <div className="grid gap-1">
            <div className="font-mono text-xs font-semibold">Terminal.resize</div>
            <p className="text-muted-foreground text-xs">
              Smallest-wins: the size sent to the PTY is the minimum across every
              attached client, not this client's own size.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </Stage>
);
